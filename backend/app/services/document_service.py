import sys
import os
import asyncio
import logging
import re
from typing import Dict, Any, Optional, List
import json

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker
from litellm import acompletion

from app.models.database import Document, get_db, engine
from app.core.config import get_settings
from app.services.prompt_service import get_active_prompt
from app.services.system_config_service import get_config_int
from app.services.agent_service import create_agent, run_agent_with_guardrails, create_model

settings = get_settings()

# LAZY import pageindex - will be imported after environment variables are set
def _get_pageindex_client_class():
    from pageindex import PageIndexClient
    return PageIndexClient


class DocumentService:
    """Service for document indexing and retrieval."""
    
    def __init__(self):
        # Use DASHSCOPE_API_KEY if available, otherwise fallback to OPENAI_API_KEY
        api_key = settings.DASHSCOPE_API_KEY or settings.OPENAI_API_KEY
        model = settings.DEFAULT_MODEL
        
        # LiteLLM 直接使用 DASHSCOPE_API_KEY 环境变量
        if settings.DASHSCOPE_API_KEY:
            os.environ["DASHSCOPE_API_KEY"] = settings.DASHSCOPE_API_KEY
        elif settings.OPENAI_API_KEY:
            os.environ["OPENAI_API_KEY"] = settings.OPENAI_API_KEY
            if settings.OPENAI_BASE_URL:
                os.environ["OPENAI_BASE_URL"] = settings.OPENAI_BASE_URL
        
        # LAZY import pageindex after environment variables are set
        PageIndexClient = _get_pageindex_client_class()
        
        # Now create the client - it will read the env vars we just set
        self.client = PageIndexClient(
            api_key=api_key,
            model=model,
        )
    
    async def index_document(self, doc_id: str, file_path: str, doc_type: str) -> None:
        """Index a document in the background."""
        # Create a new session for background task
        AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        
        async with AsyncSessionLocal() as db:
            try:
                # Update status to processing
                result = await db.execute(select(Document).where(Document.id == doc_id))
                doc = result.scalar_one_or_none()
                
                if not doc:
                    return
                
                doc.status = "processing"
                await db.commit()
                
                # Index the document
                # Note: PageIndexClient.index is synchronous, run in thread
                loop = asyncio.get_event_loop()
                indexed_doc_id = await loop.run_in_executor(
                    None, 
                    self.client.index, 
                    file_path, 
                    doc_type
                )
                
                # Get document structure
                structure_str = self.client.get_document_structure(indexed_doc_id)
                structure = eval(structure_str) if isinstance(structure_str, str) else structure_str
                
                # Get document metadata
                doc_info_str = self.client.get_document(indexed_doc_id)
                doc_info = eval(doc_info_str) if isinstance(doc_info_str, str) else doc_info_str
                
                # Update document record
                doc.status = "completed"
                doc.structure = structure
                doc.doc_description = doc_info.get("doc_description", "")
                doc.page_count = doc_info.get("page_count")
                doc.line_count = doc_info.get("line_count")
                
                # 保存原始页面文本用于调试和验证
                # PageIndexClient 会将 pages 存储在 client.documents 中
                indexed_doc = self.client.documents.get(indexed_doc_id)
                if indexed_doc and "pages" in indexed_doc:
                    doc.pages = indexed_doc["pages"]

                # Map DB doc_id to PageIndexClient so Agent tools can find the document
                if indexed_doc_id != doc.id:
                    self.client.documents[doc.id] = self.client.documents[indexed_doc_id]

                # 建立向量索引（用于自动文档匹配）
                try:
                    from app.services.vector_service import index_document as vs_index
                    vs_index(doc.id, doc.doc_description or "")
                except Exception as ve:
                    logging.warning(f"Vector indexing failed for doc {doc.id}: {ve}")

                await db.commit()
                
            except Exception as e:
                # Update status to error
                result = await db.execute(select(Document).where(Document.id == doc_id))
                doc = result.scalar_one_or_none()
                if doc:
                    doc.status = "error"
                    doc.error_message = str(e)
                    await db.commit()
    
    def get_content_from_structure(
        self, 
        structure: Any, 
        start_page: int, 
        end_page: int
    ) -> str:
        """Extract content from structure for a page range."""
        if not structure:
            return ""
        
        content_parts = []
        
        def traverse(nodes):
            for node in nodes:
                node_start = node.get("start_index", 0)
                node_end = node.get("end_index", 0)
                
                # Check if node overlaps with requested range
                if node_start <= end_page and node_end >= start_page:
                    if "text" in node and node["text"]:
                        content_parts.append(node["text"])
                    
                    # Recurse into child nodes
                    if "nodes" in node and node["nodes"]:
                        traverse(node["nodes"])
        
        if isinstance(structure, list):
            traverse(structure)
        elif isinstance(structure, dict):
            traverse([structure])
        
        return "\n\n".join(content_parts)


    async def _ensure_doc_in_client(self, document: Document) -> bool:
        """Ensure document is loaded in PageIndexClient memory.
        
        If document is not in client.documents, load from database.
        """
        # Check if document is already in client memory
        if document.id in self.client.documents:
            # Document exists in memory, ensure it has structure loaded
            doc_in_mem = self.client.documents[document.id]
            if doc_in_mem.get('structure') is not None:
                return True
        
        # Document not in memory or incomplete - load from DB
        try:
            # Reconstruct document info from database
            doc_info = {
                'id': document.id,
                'type': document.doc_type,
                'path': os.path.join(settings.UPLOAD_DIR, document.filename),
                'doc_name': document.original_name,
                'doc_description': document.doc_description or '',
                'structure': document.structure,
            }
            
            if document.doc_type == 'pdf':
                doc_info['page_count'] = document.page_count or 0
                doc_info['pages'] = document.pages or []
            else:  # markdown
                doc_info['line_count'] = document.line_count or 0
            
            # Add to client memory
            self.client.documents[document.id] = doc_info
            
            # Verify structure is present
            if document.structure:
                return True
            
            return False
            
        except Exception as e:
            logging.error(f"Failed to load document {document.id} into client: {e}")
            return False


class ChatService:
    """Service for document-based chat using agentic reasoning-based retrieval."""

    def __init__(self, doc_service: DocumentService):
        self.doc_service = doc_service

    async def query_document(
        self,
        document: Document,
        query: str,
        chat_history: list = None,
    ) -> tuple[str, list]:
        """
        Query a document using Agent SDK.

        Returns: (answer, citations)
        """
        doc_structure = document.structure
        if not doc_structure:
            return "Document structure not available. Please reindex the document.", []

        # Ensure document is loaded in PageIndexClient memory
        await self.doc_service._ensure_doc_in_client(document)

        # Build Agent system prompt from DB prompts
        agent_prompt = await get_active_prompt("agent_system")
        rag_template = await get_active_prompt("rag_template")
        if rag_template:
            agent_prompt = f"{agent_prompt}\n\n{rag_template}"

        # Add document context to prompt
        agent_prompt += f"\n\nDocument: {document.original_name}"
        if document.doc_description:
            agent_prompt += f"\nDescription: {document.doc_description}"
        if document.page_count:
            agent_prompt += f"\nPages: {document.page_count}"

        # Add chat history context
        if chat_history:
            history_text = "\n".join(
                f"{msg.get('role', 'user')}: {msg.get('content', '')}"
                for msg in chat_history[-5:]
            )
            agent_prompt += f"\n\nChat history:\n{history_text}"

        # Get agent guardrail params from DB
        max_turns = await get_config_int("agent_max_turns", 5)
        timeout_seconds = await get_config_int("agent_timeout_seconds", 60)

        # Create and run agent
        model = create_model()
        agent, tracked_client = create_agent(
            doc_client=self.doc_service.client,
            doc_id=document.id,
            system_prompt=agent_prompt,
            model=model,
        )

        answer, is_fallback, accessed_pages = await run_agent_with_guardrails(
            agent=agent,
            tracked_client=tracked_client,
            query=query,
            max_turns=max_turns,
            timeout_seconds=timeout_seconds,
        )

        # Fallback: use structure summary + direct LLM call
        if is_fallback or not answer:
            answer = await self._fallback_query(document, query, agent_prompt)

        # Post-processing
        answer = self._cleanup_tool_references(answer)
        answer = self._remove_latex_equation_labels(answer)
        answer = self._convert_latex_brackets(answer)
         
        citations = self._extract_citations(document, answer, accessed_pages)

        return answer, citations

    async def query_documents(
        self,
        documents: list,
        query: str,
        chat_history: list = None,
    ) -> tuple[str, list]:
        """
        Query multiple documents with merged context via a single LLM call.
        Returns: (answer, citations)
        """
        # Ensure all documents are loaded in client memory
        for doc in documents:
            await self.doc_service._ensure_doc_in_client(doc)

        # Build system prompt
        agent_prompt = await get_active_prompt("agent_system")
        rag_template = await get_active_prompt("rag_template")
        if rag_template:
            agent_prompt = f"{agent_prompt}\n\n{rag_template}"

        # Build combined document context
        doc_sections = []
        for doc in documents:
            section = f"Document: {doc.original_name}"
            if doc.doc_description:
                section += f"\nDescription: {doc.doc_description}"
            if doc.page_count:
                section += f"\nPages: {doc.page_count}"

            structure_summary = self._extract_structure_summary(doc.structure)
            if structure_summary and structure_summary != "No structure available":
                section += f"\nStructure:\n{structure_summary}"

            doc_sections.append(section)

        agent_prompt += "\n\n=== Available Documents ===\n\n"
        agent_prompt += "\n\n---\n\n".join(doc_sections)

        # Add chat history
        if chat_history:
            history_text = "\n".join(
                f"{msg.get('role', 'user')}: {msg.get('content', '')}"
                for msg in chat_history[-5:]
            )
            agent_prompt += f"\n\nChat history:\n{history_text}"

        # Single LLM call with all document context
        model = os.environ.get("DEFAULT_MODEL", settings.DEFAULT_MODEL)
        if os.environ.get("DASHSCOPE_API_KEY"):
            os.environ["OPENAI_API_KEY"] = os.environ.get("DASHSCOPE_API_KEY")

        try:
            response = await acompletion(
                model=model,
                messages=[
                    {"role": "system", "content": agent_prompt},
                    {"role": "user", "content": query},
                ],
                temperature=0.7,
                max_tokens=2000,
            )
            answer = response.choices[0].message.content
        except Exception as e:
            return f"Error processing question: {str(e)}", []

        answer = self._cleanup_tool_references(answer)
        answer = self._convert_latex_brackets(answer)

        # Extract citations from all documents
        all_citations = []
        for doc in documents:
            pages = doc.pages if hasattr(doc, 'pages') else []
            if pages:
                # Use first 3 pages as context citations
                for pd in pages[:3]:
                    if isinstance(pd, dict):
                        all_citations.append({
                            "page": pd.get("page", 0),
                            "text": pd.get("content", "")[:2000],
                            "node_title": f"{doc.original_name} - Page {pd.get('page', 0)}",
                            "document_id": doc.id,
                        })

        return answer, all_citations[:5]

    async def _fallback_query(self, document: Document, query: str, system_prompt: str) -> str:
        """Fallback using structure summary + direct litellm call."""
        structure_summary = self._extract_structure_summary(document.structure)

        # Append instruction to prevent tool name leakage
        fallback_user_msg = (
            f"Document Structure:\n{structure_summary}\n\nQuestion: {query}\n\n"
            "IMPORTANT: Answer directly based on the document structure above. "
            "Do NOT mention tool names or describe your analysis process."
        )

        model = os.environ.get("DEFAULT_MODEL", settings.DEFAULT_MODEL)
        if os.environ.get("DASHSCOPE_API_KEY"):
            os.environ["OPENAI_API_KEY"] = os.environ.get("DASHSCOPE_API_KEY")

        try:
            response = await acompletion(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": fallback_user_msg}
                ],
                temperature=0.7,
                max_tokens=2000,
            )
            answer = response.choices[0].message.content
            return self._cleanup_tool_references(answer)
        except Exception as e:
            return f"Error processing question: {str(e)}"

    async def query_document_fast(
        self,
        document: Document,
        query: str,
        chat_history: list = None,
    ) -> tuple[str, list]:
        """
        使用简单 RAG（无 Agent）查询文档。

        流程：树搜索 -> 内容提取 -> 回答生成 -> 引用生成
        """
        import json
        from pageindex.utils import remove_fields, create_node_mapping

        doc_structure = document.structure
        if not doc_structure:
            return "Document structure not available. Please reindex the document.", []

        # 阶段 1: 树结构搜索
        relevant_node_ids = await self._tree_search_fast(query, doc_structure)

        # 阶段 2: 内容提取
        context = self._extract_node_content_fast(doc_structure, relevant_node_ids)

        # 阶段 3: 生成回答
        answer = await self._generate_answer_fast(
            query=query,
            context=context,
            document=document,
            chat_history=chat_history,
        )

        # 阶段 4: 生成引用
        citations = self._generate_citations_fast(
            tree=doc_structure,
            node_ids=relevant_node_ids,
            doc_id=document.id,
        )

        return answer, citations


    async def _tree_search_fast(self, query: str, tree) -> list:
        """使用 LLM 在树结构中搜索相关节点"""
        import json
        from litellm import acompletion
        from pageindex.utils import remove_fields

        # 移除 text 字段，仅保留 title 和 summary
        tree_without_text = remove_fields(
            tree if isinstance(tree, list) else [tree],
            fields=['text']
        )

        # 构造搜索提示词
        search_prompt = f"""You are given a question and a tree structure of a document.
Each node contains a node id, node title, and a corresponding summary.
Your task is to find all nodes that are likely to contain the answer to the question.

Question: {query}

Document tree structure:
{json.dumps(tree_without_text, indent=2)}

Please reply in the following JSON format:
{{
    "thinking": "<Your thinking process on which nodes are relevant to the question>",
    "node_list": ["node_id_1", "node_id_2", ...]
}}
Directly return the final JSON structure. Do not output anything else."""

        model = os.environ.get("DEFAULT_MODEL", settings.DEFAULT_MODEL)
        if os.environ.get("DASHSCOPE_API_KEY"):
            os.environ["OPENAI_API_KEY"] = os.environ.get("DASHSCOPE_API_KEY")

        response = await acompletion(
            model=model,
            messages=[{"role": "user", "content": search_prompt}],
            temperature=0,
        )

        result = json.loads(response.choices[0].message.content)
        return result.get("node_list", [])


    def _extract_node_content_fast(self, tree, node_ids: list) -> str:
        """从相关节点提取全文内容"""
        from pageindex.utils import create_node_mapping

        if isinstance(tree, list):
            all_nodes = tree
        else:
            all_nodes = [tree]

        node_map = create_node_mapping(all_nodes)

        content_parts = []
        for node_id in node_ids:
            if node_id in node_map:
                node = node_map[node_id]
                text = node.get("text", "")
                if text:
                    content_parts.append(text)

        return "\n\n".join(content_parts)


    async def _generate_answer_fast(
        self,
        query: str,
        context: str,
        document: Document,
        chat_history: list = None,
    ) -> str:
        """基于上下文生成回答"""
        from litellm import acompletion

        # 获取系统提示词
        agent_prompt = await get_active_prompt("agent_system")
        rag_template = await get_active_prompt("rag_template")
        if rag_template:
            agent_prompt = f"{agent_prompt}\n\n{rag_template}"

        # 添加文档上下文
        agent_prompt += f"\n\nDocument: {document.original_name}"
        if document.doc_description:
            agent_prompt += f"\nDescription: {document.doc_description}"
        if document.page_count:
            agent_prompt += f"\nPages: {document.page_count}"

        # 添加聊天历史
        if chat_history:
            history_text = "\n".join(
                f"{msg.get('role', 'user')}: {msg.get('content', '')}"
                for msg in chat_history[-5:]
            )
            agent_prompt += f"\n\nChat history:\n{history_text}"

        # 构造用户消息
        user_message = f"""Answer the question based on the context:

Question: {query}

Context:
{context}

Provide a clear, concise answer based only on the context provided."""

        model = os.environ.get("DEFAULT_MODEL", settings.DEFAULT_MODEL)
        if os.environ.get("DASHSCOPE_API_KEY"):
            os.environ["OPENAI_API_KEY"] = os.environ.get("DASHSCOPE_API_KEY")

        response = await acompletion(
            model=model,
            messages=[
                {"role": "system", "content": agent_prompt},
                {"role": "user", "content": user_message},
            ],
            temperature=0.7,
            max_tokens=2000,
        )

        answer = response.choices[0].message.content
        answer = self._cleanup_tool_references(answer)
        answer = self._convert_latex_brackets(answer)

        return answer


    def _generate_citations_fast(
        self,
        tree,
        node_ids: list,
        doc_id: str,
    ) -> list:
        """从节点 ID 生成引用"""
        from pageindex.utils import create_node_mapping

        if isinstance(tree, list):
            all_nodes = tree
        else:
            all_nodes = [tree]

        node_map = create_node_mapping(all_nodes)
        citations = []

        for node_id in node_ids:
            if node_id in node_map:
                node = node_map[node_id]
                citations.append({
                    "page": node.get("page_index", 0),
                    "text": node.get("text", "")[:2000],
                    "node_title": node.get("title", ""),
                    "document_id": doc_id,
                })

        return citations[:5]  # 限制最多 5 条引用

    def _extract_structure_summary(self, structure, max_depth=2):
        """Extract a readable summary from document structure."""
        if not structure:
            return "No structure available"

        summary_lines = []

        def traverse(nodes, depth=0):
            if depth >= max_depth:
                return
            for node in nodes:
                title = node.get("title", "Untitled")
                node_type = node.get("type", "section")
                start = node.get("start_index", 0)
                end = node.get("end_index", 0)
                indent = "  " * depth
                summary_lines.append(f"{indent}- {title} ({node_type}, pages {start}-{end})")
                summary = node.get("summary", "")
                if summary and depth < max_depth - 1:
                    summary_lines.append(f"{indent}  Summary: {summary[:200]}...")
                if "nodes" in node and node["nodes"]:
                    traverse(node["nodes"], depth + 1)

        if isinstance(structure, list):
            traverse(structure)
        elif isinstance(structure, dict):
            traverse([structure])

        return "\n".join(summary_lines)

    def _remove_latex_equation_labels(self, answer: str) -> str:
        r"""Remove LaTeX equation labels like (1), (2.1) etc. at the end of display math blocks.

        These come from PDF page text where the original document has equation numbers
        at the end of display formulas. They get extracted as part of the text content
        and confuse KaTeX rendering.

        Example:
            $$\text{Attention}(Q,K,V) = \text{softmax}(\frac{QK^T}{\sqrt{d_k}})V \tag{1}$$
            becomes
            $$\text{Attention}(Q,K,V) = \text{softmax}(\frac{QK^T}{\sqrt{d_k}})V$$
        """
        # Remove \tag{N} from inside $$ blocks
        answer = re.sub(r'(\$\$[\s\S]*?)\\tag\{[^}]+\}(\$\$)', r'\1\2', answer)
        # Remove standalone \tag{N} that might not be inside $$ yet
        answer = re.sub(r'\\tag\{[^}]+\}', '', answer)
        return answer

    def _convert_latex_brackets(self, answer):
        """Convert [ ... ] and \\[ ... \\] to $$ ... $$ for KaTeX rendering."""
        pattern1 = r'\\\[(.*?)\\\]'
        pattern2 = r'\[(\s*\\[a-zA-Z].*?)\]'

        def replace_bracket(match):
            content = match.group(1).strip()
            if re.match(r'^\d+$', content):
                return match.group(0)
            if content.startswith('第'):
                return match.group(0)
            if any(latex_cmd in content for latex_cmd in ['\\text', '\\frac', '\\sqrt', '\\sum', '\\int', '\\prod', '\\alpha', '\\beta', '\\gamma', '\\delta', '\\epsilon', '\\theta', '\\lambda', '\\mu', '\\pi', '\\sigma', '\\omega', '\\phi', '\\psi', '\\chi', '\\rho', '\\tau', '\\nu', '\\xi', '\\zeta', '\\eta', '\\kappa', '\\iota', '\\upsilon', '\\left', '\\right', '\\top', '\\softmax']):
                return f'$${content}$$'
            if re.search(r'\\[a-zA-Z]+', content) and ('=' in content or '(' in content):
                return f'$${content}$$'
            return match.group(0)

        answer = re.sub(pattern1, lambda m: f'$${m.group(1)}$$', answer)
        answer = re.sub(pattern2, replace_bracket, answer)
        return answer

    def _cleanup_tool_references(self, answer: str) -> str:
        """Remove tool call references like get_document() from AI response."""
        # 1. Remove ```tool_code``` code blocks entirely
        answer = re.sub(r'```tool_code\s*\n[\s\S]*?```', '', answer)

        # 2. Remove ```tool_name``` or other tool code blocks
        answer = re.sub(r'```\s*tool_\w+\s*\n[\s\S]*?```', '', answer)

        # 3. Remove patterns like "Calling get_document()...", "I called get_document()..."
        answer = re.sub(r"[Cc]alling\s+get_document\(\)[^.]*\.\s*", "", answer)
        answer = re.sub(r"[Ii]\s+(called|will call|need to call|should call)\s+get_document\(\)[^.]*\.\s*", "", answer)

        # 4. Remove patterns like "I need to get document info first"
        answer = re.sub(r"I\s+(need to|will|should)\s+(get|check|verify)\s+(the\s+)?document[^.]*\.\s*", "", answer)

        # 5. Remove tool name mentions at start of sentences
        answer = re.sub(r"^(get_document\(\)|get_document_structure\(\)|get_page_content\(\))\s*", "", answer, flags=re.MULTILINE)

        # 6. Remove standalone tool function calls as text (e.g. get_document() or get_page_content(pages="..."))
        answer = re.sub(r'get_document\(\)[\s\n]*', '', answer)
        answer = re.sub(r'get_document_structure\(\)[\s\n]*', '', answer)
        answer = re.sub(r'get_page_content\([^)]*\)[\s\n]*', '', answer)

        # 7. Remove Chinese thinking/planning text about tool usage
        answer = re.sub(r'[，,]?\s*首先调用[^。]*。?\s*', '', answer)
        answer = re.sub(r'[，,]?\s*先确认[^。]*。?\s*', '', answer)
        answer = re.sub(r'[，,]?\s*再检查[^。]*。?\s*', '', answer)
        answer = re.sub(r'[，,]?\s*再[查看读取][^。]*。?\s*', '', answer)
        # Remove "我需要...调用..." spanning multiple sentences
        answer = re.sub(r'我需要[\s\S]*?(?:调用|工具)[\s\S]*?(?:。|\n\n)', '', answer)
        answer = re.sub(r'我将[\s\S]*?(?:调用|工具)[\s\S]*?(?:。|\n\n)', '', answer)
        answer = re.sub(r'获取[^。]*信息[^。]*。?\s*$', '', answer, flags=re.MULTILINE)

        # 8. Remove "q:" and "a:" prefixes/separators that some models output
        answer = re.sub(r'[,，]\s*a:\s*$', '', answer, flags=re.MULTILINE)
        answer = re.sub(r'^q:\s*', '', answer, flags=re.MULTILINE)
        answer = re.sub(r'^a:\s*', '', answer, flags=re.MULTILINE)

        # 9. Clean up any leftover "Now let me..." or "Let me..." that followed tool calls
        answer = re.sub(r"Now\s+let\s+me[^.]*\.\s*", "", answer)
        answer = re.sub(r"Let\s+me[^.]*\.\s*", "", answer)

        # 9. Clean up consecutive empty lines and extra spaces
        answer = re.sub(r"\n{3,}", "\n\n", answer)
        answer = re.sub(r"[ \t]+\n", "\n", answer)

        return answer.strip()


    def _extract_citations(self, document, answer="", accessed_pages=None):
        """Extract citation information from accessed pages.
        
        Args:
            document: Document object
            answer: AI answer with [1], [2] markers
            accessed_pages: List of page numbers that were actually accessed
        
        Returns:
            List of citation objects for frontend display
        """
        import re
        citations = []
        
        # Get pages from document
        pages = document.pages if hasattr(document, 'pages') else []
        if not pages:
            return citations
        
        # Build a mapping: page_num -> page_content
        page_map = {}
        for pd in pages:
            if isinstance(pd, dict):
                page_num = pd.get('page', 0)
                page_map[page_num] = pd
        
        # If we have accessed_pages from tool tracking, use them directly
        if accessed_pages:
            # Create citation mapping: index -> page_num
            citation_pages = accessed_pages[:5]  # Max 5 citations
            
            for i, page_num in enumerate(citation_pages):
                if page_num in page_map:
                    pd = page_map[page_num]
                    text = pd.get("content", "")[:2000]
                    citations.append({
                        "page": page_num,
                        "text": text,
                        "node_title": f"Page {page_num}",
                        "document_id": document.id
                    })
            
            return citations
        
        # Fallback: parse [N] markers from answer and try to match pages
        bracket_citations = re.findall(r'\[(\d+)\]', answer)
        if not bracket_citations:
            return citations
        
        seen_pages = set()
        for idx_str in bracket_citations[:5]:
            try:
                idx = int(idx_str)
                if idx in page_map and idx not in seen_pages:
                    pd = page_map[idx]
                    text = pd.get("content", "")[:2000]
                    citations.append({
                        "page": idx,
                        "text": text,
                        "node_title": f"Page {idx}",
                        "document_id": document.id
                    })
                    seen_pages.add(idx)
            except ValueError:
                continue

        return citations

    async def match_documents_to_query(self, query: str, db: AsyncSession, limit: int = 5) -> list[Document]:
        """通过向量搜索匹配与 query 相关的文档"""
        from app.services.vector_service import search_similar

        matches = search_similar(query, top_k=limit, threshold=0.3)
        if not matches:
            return []

        documents = []
        for match in matches:
            doc_id = match["document_id"]
            result = await db.execute(
                select(Document).where(Document.id == doc_id, Document.status == "completed")
            )
            doc = result.scalar_one_or_none()
            if doc:
                documents.append(doc)

        return documents

    async def query_general(self, query: str, chat_history: list = None) -> tuple[str, list]:
        """无文档上下文的通用聊天"""
        agent_prompt = await get_active_prompt("agent_system") or "你是一个有帮助的助手。"

        if chat_history:
            history_text = "\n".join(
                f"{msg.get('role', 'user')}: {msg.get('content', '')}"
                for msg in chat_history[-10:]
            )
            agent_prompt += f"\n\nChat history:\n{history_text}"

        messages = [
            {"role": "system", "content": agent_prompt},
            {"role": "user", "content": query},
        ]

        response = await acompletion(
            model=settings.DEFAULT_MODEL,
            messages=messages,
        )
        return response.choices[0].message.content, []


# Global service instances
doc_service = DocumentService()
chat_service = ChatService(doc_service)
