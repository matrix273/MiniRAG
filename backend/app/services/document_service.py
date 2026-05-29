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
        self._init_agent_tools()
    
    def _init_agent_tools(self):
        """Initialize agent tools for document querying."""
        from agents import Agent, function_tool
        from agents.model_settings import ModelSettings
        
        self.Agent = Agent
        self.function_tool = function_tool
        self.ModelSettings = ModelSettings
    
    async def query_document(
        self, 
        document: Document, 
        query: str, 
        chat_history: List[Dict[str, Any]] = None
    ) -> tuple[str, List[Dict]]:
        """
        Query a document using agentic reasoning-based retrieval.
        
        Returns: (answer, citations)
        """
        import concurrent.futures
        import asyncio
        
        # Build context from document structure
        doc_structure = document.structure
        if not doc_structure:
            return "Document structure not available. Please reindex the document.", []
        
        # Extract relevant content from structure
        # Use a simplified approach: get summary from structure
        structure_summary = self._extract_structure_summary(doc_structure)
        
        # Build system prompt for reasoning
        system_prompt = f"""You are a helpful AI assistant answering questions about a document.
Document: {document.original_name}
Description: {document.doc_description or 'N/A'}
Pages: {document.page_count or 'N/A'}

Document Structure:
{structure_summary}

Based on this document structure, answer the user's question.
If the question can be answered from the structure summary, do so.
If you need more specific content, indicate which pages might contain the answer.
Be concise and accurate."""

        # Build messages including chat history
        messages = [{"role": "system", "content": system_prompt}]
        
        if chat_history:
            for msg in chat_history[-5:]:  # Keep last 5 messages for context
                messages.append({
                    "role": msg.get("role", "user"),
                    "content": msg.get("content", "")
                })
        
        messages.append({"role": "user", "content": query})
        
        # Get content from document structure for this query
        # Extract relevant pages based on query keywords
        relevant_content, page_numbers = self._extract_relevant_content(document, query)
        
        # Build final prompt with context
        final_prompt = f"""{system_prompt}

Additional Content from Document:
{relevant_content}

Question: {query}

Answer the question based on the document structure and content above. 
If citing specific information, mention the page or section.
Provide a clear, concise answer."""

        # Call LLM using LiteLLM-compatible interface
        try:
            import os
            from litellm import completion
            
            model = os.environ.get("DEFAULT_MODEL", settings.DEFAULT_MODEL)
            
            # Determine which API key to use
            if os.environ.get("DASHSCOPE_API_KEY"):
                os.environ["OPENAI_API_KEY"] = os.environ.get("DASHSCOPE_API_KEY")
            
            response = completion(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Document Content:\n{relevant_content}\n\nQuestion: {query}"}
                ],
                temperature=0.7,
                max_tokens=2000,
            )
            
            answer = response.choices[0].message.content
            
            # Extract citations from the content we used
            citations = self._extract_citations(relevant_content)
            
            return answer, citations
            
        except Exception as e:
            # Fallback: use the structure directly
            return f"Based on the document structure:\n{structure_summary}\n\nQuestion: {query}\n\n(Note: Full content retrieval encountered an error: {str(e)})", []
    
    def _extract_structure_summary(self, structure: Any, max_depth: int = 2) -> str:
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
                
                # Include summary if available
                summary = node.get("summary", "")
                if summary and depth < max_depth - 1:
                    summary_lines.append(f"{indent}  Summary: {summary[:200]}...")
                
                # Recurse
                if "nodes" in node and node["nodes"]:
                    traverse(node["nodes"], depth + 1)
        
        if isinstance(structure, list):
            traverse(structure)
        elif isinstance(structure, dict):
            traverse([structure])
        
        return "\n".join(summary_lines)
    
    def _extract_relevant_content(self, document: Document, query: str) -> tuple[str, List[int]]:
        """Extract content relevant to the query from original pages."""
        # 首先使用原始页面文本（如果有的话）
        if document.pages:
            query_keywords = [kw.lower() for kw in query.split() if len(kw) > 1]
            relevant_pages = []
            
            for page_data in document.pages:
                page_num = page_data.get("page", 0)
                content = page_data.get("content", "")
                content_lower = content.lower()
                
                # 计算关键词匹配数
                match_count = sum(1 for kw in query_keywords if kw in content_lower)
                
                # 如果有任何关键词匹配，加入相关页面
                if match_count > 0:
                    relevant_pages.append((page_num, content, match_count))
            
            # 按匹配度排序，取前 3 页
            relevant_pages.sort(key=lambda x: x[2], reverse=True)
            top_pages = relevant_pages[:5]  # 最多 5 页
            
            # 按页码排序
            top_pages.sort(key=lambda x: x[0])
            
            content_parts = []
            page_numbers = []
            for page_num, content, _ in top_pages:
                content_parts.append(f"## Page {page_num}\n{content}")
                page_numbers.append(page_num)
            
            if content_parts:
                return "\n\n---\n\n".join(content_parts), page_numbers
        
        # 如果没有 pages 或没找到匹配，使用 structure 中的 text 作为后备
        if document.structure:
            query_keywords = query.lower().split()
            relevant_parts = []
            
            def traverse(nodes):
                for node in nodes:
                    title = node.get("title", "").lower()
                    text = node.get("text", "").lower()
                    summary = node.get("summary", "").lower()
                    
                    # Check relevance
                    is_relevant = any(
                        keyword in title or keyword in text or keyword in summary
                        for keyword in query_keywords
                    )
                    
                    if is_relevant:
                        content_parts = []
                        if node.get("title"):
                            content_parts.append(f"## {node['title']}")
                        if node.get("summary"):
                            content_parts.append(f"Summary: {node['summary']}")
                        if node.get("text"):
                            # Truncate long text
                            text_content = node["text"][:1000]
                            if len(node["text"]) > 1000:
                                text_content += "..."
                            content_parts.append(f"Content: {text_content}")
                        
                        if content_parts:
                            relevant_parts.append("\n".join(content_parts))
                    
                    # Recurse
                    if "nodes" in node and node["nodes"]:
                        traverse(node["nodes"])
            
            if isinstance(document.structure, list):
                traverse(document.structure)
            elif isinstance(document.structure, dict):
                traverse([document.structure])
            
            # If no relevant content found, return first few sections
            if not relevant_parts:
                def get_first_nodes(nodes, count=3):
                    result = []
                    for node in nodes[:count]:
                        parts = []
                        if node.get("title"):
                            parts.append(f"## {node['title']}")
                        if node.get("summary"):
                            parts.append(f"Summary: {node['summary']}")
                        if node.get("text"):
                            text = node["text"][:500] + "..." if len(node["text"]) > 500 else node["text"]
                            parts.append(f"Content: {text}")
                        result.append("\n".join(parts))
                    return result
                
                if isinstance(document.structure, list):
                    relevant_parts = get_first_nodes(document.structure)
            
                return "\n\n---\n\n".join(relevant_parts[:5]), []  # 没有具体页码信息
        
        return "No document content available.", []
    
    def _extract_citations(self, content: str) -> List[Dict]:
        """Extract citation information from content."""
        citations = []
        # Simple citation extraction - look for page references
        import re
        page_matches = re.findall(r'[Pp]age[s]?\s+(\d+)(?:-(\d+))?', content)
        for match in page_matches:
            start_page = int(match[0])
            end_page = int(match[1]) if match[1] else start_page
            citations.append({
                "page": start_page,
                "text": f"Page {start_page}" + (f"-{end_page}" if end_page != start_page else "")
            })
        return citations


# Global service instances
doc_service = DocumentService()
chat_service = ChatService(doc_service)
