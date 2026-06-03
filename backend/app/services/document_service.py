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
from app.services.system_config_service import get_config_int, get_llm_config
from app.services.agent_service import create_agent, run_agent_with_guardrails, create_model

settings = get_settings()

# 辅助函数：从数据库获取 LLM 环境变量
async def _get_llm_env():
    """从数据库获取当前 LLM 配置并设置环境变量"""
    llm_config = await get_llm_config()
    api_key = llm_config["dashscope_key"] or llm_config["openai_key"]
    if api_key:
        os.environ["OPENAI_API_KEY"] = api_key
    if llm_config["api_base_url"]:
        os.environ["OPENAI_BASE_URL"] = llm_config["api_base_url"]
    return llm_config

# LAZY import indexing - will be imported after environment variables are set
def _get_pageindex_client_class():
    from app.services.indexing import PageIndexClient
    return PageIndexClient


def _extract_structure_summary(structure, max_depth=2):
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


class DocumentService:
    """Service for document indexing and retrieval."""
    
    def __init__(self):
        # Initial setup using .env values (will be overridden by database config)
        api_key = settings.DASHSCOPE_API_KEY or settings.OPENAI_API_KEY
        model = settings.DEFAULT_MODEL
        
        # Set initial env vars for LiteLLM
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
    
    async def _refresh_llm_config(self):
        """从数据库刷新 LLM 配置并更新环境变量"""
        llm_config = await get_llm_config()
        api_key = llm_config["dashscope_key"] or llm_config["openai_key"]
        if api_key:
            os.environ["OPENAI_API_KEY"] = api_key
        if llm_config["api_base_url"]:
            os.environ["OPENAI_BASE_URL"] = llm_config["api_base_url"]
        return llm_config
    
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
                # 注意：不能使用 get_document_structure()，因为它会移除 text 字段，
                # 导致 Office 文件（xlsx/docx/pptx）的内容丢失。
                # 直接从 client.documents 获取完整结构（含 text）。
                indexed_doc = self.client.documents.get(indexed_doc_id, {})
                structure = indexed_doc.get('structure', [])
                
                # Get document metadata
                doc_info_str = self.client.get_document(indexed_doc_id)
                doc_info = eval(doc_info_str) if isinstance(doc_info_str, str) else doc_info_str
                
                # Update document record
                doc.status = "completed"
                doc.structure = structure
                doc.structure_summary = _extract_structure_summary(structure)
                doc.doc_description = doc_info.get("doc_description", "")
                doc.page_count = doc_info.get("page_count")
                doc.line_count = doc_info.get("line_count")
                
                # 保存原始页面文本用于调试和验证
                # PageIndexClient 会将 pages 存储在 client.documents 中
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
                    # Collect node content if available
                    title = node.get("title", "")
                    summary = node.get("summary", "")
                    content = node.get("content", "")
                    
                    # Build node text
                    node_text_parts = []
                    if title:
                        node_text_parts.append(f"## {title}")
                    if summary:
                        node_text_parts.append(summary)
                    if content:
                        node_text_parts.append(content)
                    
                    if node_text_parts:
                        content_parts.append("\n".join(node_text_parts))
                    
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
            elif document.doc_type in ('docx', 'xlsx', 'pptx'):
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
        
        # Inject pre-computed structure summary to skip get_document + get_document_structure tool calls
        if document.structure_summary:
            agent_prompt += f"\n\nDocument Structure:\n{document.structure_summary}"
            # Override tool instructions: only get_page_content and analyze_page_images are available
            agent_prompt += (
                "\n\nIMPORTANT: Document metadata and structure are already provided above. "
                "You have access to the following tools:\n"
                "1. get_page_content(pages) - to read text content of specific pages\n"
                "2. analyze_page_images(pages) - to analyze visual content (charts, diagrams, formulas) on pages\n"
                "Do NOT attempt to call get_document() or get_document_structure() — they are not available."
            )

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

        # 从数据库获取 LLM 配置
        llm_config = await self._refresh_llm_config()
        
        # Create and run agent
        model = await create_model()
        # When structure_summary is injected, skip get_document/get_document_structure tools
        include_metadata_tools = not document.structure_summary
        
        # Check if vision is enabled from database config
        vision_enabled = llm_config["vision_enabled"]
        
        # Add vision instructions to prompt if vision is enabled
        if vision_enabled:
            visual_prompt = await get_active_prompt("visual_mode")
            if visual_prompt:
                agent_prompt += "\n\n" + visual_prompt
        
        agent, tracked_client = await create_agent(
            doc_client=self.doc_service.client,
            doc_id=document.id,
            system_prompt=agent_prompt,
            model=model,
            include_metadata_tools=include_metadata_tools,
            include_vision_tools=vision_enabled,
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

            structure_summary = _extract_structure_summary(doc.structure)
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

        # Single LLM call with all document context - 从数据库读取配置
        llm_config = await self._refresh_llm_config()
        model = llm_config["default_model"]

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
        structure_summary = _extract_structure_summary(document.structure)

        # Append instruction to prevent tool name leakage
        fallback_user_msg = (
            f"Document Structure:\n{structure_summary}\n\nQuestion: {query}\n\n"
            "IMPORTANT: Answer directly based on the document structure above. "
            "Do NOT mention tool names or describe your analysis process."
        )

        # 从数据库读取配置
        llm_config = await self._refresh_llm_config()
        model = llm_config["default_model"]

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
            answer: AI answer with citation://page/N links
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
                        "document_id": document.id,
                        "index": i + 1  # Citation index (1-based)
                    })
            
            return citations
        
        # Fallback: parse #citation-page-N links from answer
        citation_links = re.findall(r'\[([^\]]*)\]\(#citation-page-(\d+)\)', answer)
        
        seen_pages = set()
        if citation_links:
            for display_text, page_str in citation_links[:5]:
                try:
                    page_num = int(page_str)
                    if page_num in page_map and page_num not in seen_pages:
                        pd = page_map[page_num]
                        text = pd.get("content", "")[:2000]
                        citations.append({
                            "page": page_num,
                            "text": text,
                            "node_title": display_text if display_text else f"Page {page_num}",
                            "document_id": document.id,
                            "index": len(citations) + 1
                        })
                        seen_pages.add(page_num)
                except ValueError:
                    continue

        return citations

    async def match_documents_to_query(self, query: str, db: AsyncSession, limit: int = 5) -> list[Document]:
        """基于向量相似度匹配 query 与文档的 doc_description。

        策略：
        1. 用 DashScope embedding 将 query 编码为向量
        2. 在 Milvus 中做余弦相似度搜索
        3. 根据匹配的 document_id 从数据库加载文档对象
        4. 如果无匹配，回退为按时间倒序返回
        """
        from sqlalchemy import select as sa_select

        try:
            from app.services.vector_service import search_similar
            matches = search_similar(query, top_k=limit, threshold=0.5)
        except Exception as e:
            logging.warning(f"Vector search failed, falling back to recent docs: {e}")
            return await self._get_recent_documents(db, limit)

        if not matches:
            return await self._get_recent_documents(db, limit)

        doc_ids = [m["document_id"] for m in matches]
        result = await db.execute(
            sa_select(Document).where(Document.id.in_(doc_ids))
        )
        docs = {doc.id: doc for doc in result.scalars().all()}

        # 按向量搜索的相似度排序
        ordered = []
        for m in matches:
            doc = docs.get(m["document_id"])
            if doc:
                ordered.append(doc)
        return ordered

    async def _get_recent_documents(self, db: AsyncSession, limit: int) -> list[Document]:
        """获取最新的已完成索引文档。"""
        from sqlalchemy import select as sa_select
        result = await db.execute(
            sa_select(Document)
            .where(Document.status == "completed")
            .order_by(Document.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def query_general(self, query: str, chat_history: list = None, db=None) -> tuple[str, list]:
        """无文档上下文的通用聊天"""
        agent_prompt = "你是一个有帮助的助手，可以回答各种问题。"

        # 如果有 db 连接，注入文档列表信息以便回答系统级问题
        if db is not None:
            from sqlalchemy import select as sa_select
            result = await db.execute(
                sa_select(Document).where(Document.status == "completed").order_by(Document.created_at.desc())
            )
            docs = result.scalars().all()
            if docs:
                doc_lines = []
                for d in docs:
                    desc = f" - {d.doc_description[:100]}" if d.doc_description else ""
                    pages = f" ({d.page_count}页)" if d.page_count else ""
                    doc_lines.append(f"- {d.original_name}{pages}{desc}")
                agent_prompt += f"\n\n当前系统中已索引的文档（共 {len(docs)} 个）：\n" + "\n".join(doc_lines)
            else:
                agent_prompt += "\n\n当前系统中没有已索引的文档。"

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

        # 从数据库读取配置
        llm_config = await self._refresh_llm_config()
        
        response = await acompletion(
            model=llm_config["default_model"],
            messages=messages,
        )
        return response.choices[0].message.content, []


# Global service instances
doc_service = DocumentService()
chat_service = ChatService(doc_service)
