import sys
import os
import asyncio
from typing import Dict, Any, Optional, List
import json

from sqlalchemy.ext.asyncio import AsyncSession
from app.models.database import Document, get_db
from app.core.config import get_settings

settings = get_settings()


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
        from pageindex import PageIndexClient
        
        # Now create the client - it will read the env vars we just set
        self.client = PageIndexClient(
            api_key=api_key,
            model=model,
        )
    
    async def index_document(self, doc_id: str, file_path: str, doc_type: str) -> None:
        """Index a document in the background."""
        from sqlalchemy import select
        from app.models.database import engine
        from sqlalchemy.orm import sessionmaker
        
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
        from app.services.prompt_service import get_active_prompt
        from app.services.system_config_service import get_config_int
        from app.services.agent_service import create_agent, run_agent_with_guardrails, create_model
        from litellm import completion as litellm_completion

        doc_structure = document.structure
        if not doc_structure:
            return "Document structure not available. Please reindex the document.", []

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
        agent = create_agent(
            doc_client=self.doc_service.client,
            doc_id=document.id,
            system_prompt=agent_prompt,
            model=model,
        )

        answer, is_fallback = await run_agent_with_guardrails(
            agent=agent,
            query=query,
            max_turns=max_turns,
            timeout_seconds=timeout_seconds,
        )

        # Fallback: use structure summary + direct LLM call
        if is_fallback or not answer:
            answer = await self._fallback_query(document, query, agent_prompt)

        # Post-processing
        answer = self._convert_latex_brackets(answer)
        answer = self._add_citation_markers(answer, document)
        citations = self._extract_citations(document, answer)

        return answer, citations

    async def _fallback_query(self, document: Document, query: str, system_prompt: str) -> str:
        """Fallback using structure summary + direct litellm call."""
        from litellm import completion as litellm_completion

        structure_summary = self._extract_structure_summary(document.structure)

        model = os.environ.get("DEFAULT_MODEL", settings.DEFAULT_MODEL)
        if os.environ.get("DASHSCOPE_API_KEY"):
            os.environ["OPENAI_API_KEY"] = os.environ.get("DASHSCOPE_API_KEY")

        try:
            response = litellm_completion(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Document Structure:\n{structure_summary}\n\nQuestion: {query}"}
                ],
                temperature=0.7,
                max_tokens=2000,
            )
            return response.choices[0].message.content
        except Exception as e:
            return f"Error processing question: {str(e)}"

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

    def _convert_latex_brackets(self, answer):
        """Convert [ ... ] and \\[ ... \\] to $$ ... $$ for KaTeX rendering."""
        import re

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

    def _add_citation_markers(self, answer, document):
        """Add [1], [2] citation markers to answer if not present."""
        import re
        if re.search(r'\[\d+\]', answer):
            return answer
        return answer

    def _extract_citations(self, document, answer=""):
        """Extract citation information from document pages."""
        import re
        citations = []
        if not document.pages:
            return citations

        bracket_citations = re.findall(r'\[(\d+)\]', answer)

        if bracket_citations:
            for idx_str in bracket_citations[:3]:
                idx = int(idx_str) - 1
                if 0 <= idx < len(document.pages):
                    pd = document.pages[idx]
                    text = pd.get("content", "")[:2000]
                    citations.append({
                        "page": pd.get("page", idx + 1),
                        "text": text,
                        "node_title": f"Page {pd.get('page', idx + 1)}"
                    })
        elif document.pages:
            for pd in document.pages[:3]:
                text = pd.get("content", "")[:2000]
                citations.append({
                    "page": pd.get("page", 0),
                    "text": text,
                    "node_title": f"Page {pd.get('page', 0)}"
                })

        return citations


# Global service instances
doc_service = DocumentService()
chat_service = ChatService(doc_service)
