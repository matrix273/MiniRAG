from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
import asyncio
import uuid
import os
import shutil
import json

# Set environment variables BEFORE importing pageindex (it uses load_dotenv on import)
from app.core.config import get_settings
settings = get_settings()

# 配置性能日志
import logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logging.getLogger("perf").setLevel(logging.INFO)
# 抑制 LiteLLM 远程模型定价获取失败的 WARNING
logging.getLogger("LiteLLM").setLevel(logging.ERROR)

# LiteLLM 直接使用 DASHSCOPE_API_KEY 环境变量
if settings.DASHSCOPE_API_KEY:
    os.environ["DASHSCOPE_API_KEY"] = settings.DASHSCOPE_API_KEY
elif settings.OPENAI_API_KEY:
    os.environ["OPENAI_API_KEY"] = settings.OPENAI_API_KEY
    if settings.OPENAI_BASE_URL:
        os.environ["OPENAI_BASE_URL"] = settings.OPENAI_BASE_URL

from app.models.database import get_db, Document, ChatSession, ChatMessage, Folder, init_db, async_session
from app.services.document_service import doc_service, chat_service
from app.schemas.schemas import (
    DocumentResponse,
    DocumentListResponse,
    DocumentCreate,
    ChatSessionCreate,
    ChatSessionResponse,
    ChatSessionUpdate,
    ChatMessageCreate,
    ChatMessageResponse,
    MessageDeleteRequest,
    TreeNode,
    FolderCreate,
    FolderUpdate,
    FolderResponse,
    PromptConfigCreate,
    SystemConfigUpdate,
)

app = FastAPI(
    title=settings.APP_NAME,
    description="PageIndex Web API - Vectorless, Reasoning-based RAG",
    version="0.1.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Document service
# Use the global instance from document_service module
from app.services.document_service import doc_service
from app.api.auth import router as auth_router
from app.api.admin import router as admin_router

# Include auth router
app.include_router(auth_router)
# Include admin router
app.include_router(admin_router)
# Include markdown documents router
from app.api.documents import router as documents_router
app.include_router(documents_router)


@app.on_event("startup")
async def startup():
    """Initialize database on startup."""
    await init_db()
    # Ensure upload directory exists
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    from app.services.system_config_service import init_default_configs
    await init_default_configs()
    # Initialize default prompts in DB
    from app.services.prompt_service import init_default_prompts
    await init_default_prompts()
    # Seed roles and permissions
    from app.services.auth_service import seed_roles_and_permissions
    async with async_session() as seed_db:
        await seed_roles_and_permissions(seed_db)
    
    # 从数据库加载 LLM 配置并设置环境变量
    from app.services.system_config_service import get_llm_config
    llm_config = await get_llm_config()
    api_key = llm_config["dashscope_key"] or llm_config["openai_key"]
    if api_key:
        os.environ["OPENAI_API_KEY"] = api_key
    if llm_config["api_base_url"]:
        os.environ["OPENAI_BASE_URL"] = llm_config["api_base_url"]
    logging.info(f"Loaded LLM config: model={llm_config['default_model']}, vision_enabled={llm_config['vision_enabled']}")
    
    # 处理中断的任务：将 processing 状态的文档重置为 error
    from sqlalchemy import select, update
    async with async_session() as db:
        result = await db.execute(
            update(Document)
            .where(Document.status == "processing")
            .values(
                status="error",
                error_message="服务重启导致任务中断，请点击重新索引重试"
            )
        )
        if result.rowcount > 0:
            logging.warning(f"Reset {result.rowcount} documents from 'processing' to 'error' due to server restart")
            await db.commit()


# ========== Document Endpoints ==========

@app.post("/api/documents/upload")
async def upload_documents(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    folder_id: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db)
):
    """Upload multiple documents (PDF or Markdown) and start indexing."""
    allowed_extensions = {'.pdf', '.md', '.markdown', '.docx', '.xlsx', '.pptx'}
    results = []
    errors = []

    for file in files:
        file_ext = os.path.splitext(file.filename.lower())[1]

        if file_ext not in allowed_extensions:
            errors.append(f"{file.filename}: Unsupported file type {file_ext}")
            continue

        doc_id = str(uuid.uuid4())
        safe_filename = f"{doc_id}{file_ext}"
        file_path = os.path.join(settings.UPLOAD_DIR, safe_filename)

        try:
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
        except Exception as e:
            errors.append(f"{file.filename}: Failed to save file - {str(e)}")
            continue
        finally:
            await file.close()

        doc_type_map = {
            '.pdf': 'pdf', '.md': 'md', '.markdown': 'md',
            '.docx': 'docx', '.xlsx': 'xlsx', '.pptx': 'pptx',
        }
        doc_type = doc_type_map[file_ext]
        doc = Document(
            id=doc_id,
            filename=safe_filename,
            original_name=file.filename,
            doc_type=doc_type,
            status="pending",
            folder_id=folder_id,
        )
        db.add(doc)
        results.append(doc)

        # Start background indexing for each document
        background_tasks.add_task(doc_service.index_document, doc_id, file_path, doc_type)

    await db.commit()

    return {
        "uploaded": [
            {
                "id": doc.id,
                "filename": doc.original_name,
                "doc_type": doc.doc_type,
                "status": doc.status,
                "created_at": doc.created_at,
                "folder_id": doc.folder_id,
            }
            for doc in results
        ],
        "errors": errors if errors else None,
        "total_uploaded": len(results),
        "total_errors": len(errors),
    }


@app.get("/api/documents", response_model=List[DocumentListResponse])
async def list_documents(folder_id: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    """List all documents, optionally filtered by folder_id."""
    from sqlalchemy import select
    query = select(Document).order_by(Document.created_at.desc())
    if folder_id is not None:
        query = query.where(Document.folder_id == folder_id)
    result = await db.execute(query)
    documents = result.scalars().all()

    return [
        DocumentListResponse(
            id=doc.id,
            filename=doc.original_name,
            doc_type=doc.doc_type,
            status=doc.status,
            doc_description=doc.doc_description,
            page_count=doc.page_count,
            created_at=doc.created_at,
            folder_id=doc.folder_id,
        )
        for doc in documents
    ]


@app.get("/api/documents/{doc_id}", response_model=DocumentResponse)
async def get_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    """Get document details."""
    from sqlalchemy import select
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    return DocumentResponse(
        id=doc.id,
        filename=doc.original_name,
        doc_type=doc.doc_type,
        status=doc.status,
        doc_description=doc.doc_description,
        page_count=doc.page_count,
        line_count=doc.line_count,
        structure=doc.structure,
        error_message=doc.error_message,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
        folder_id=doc.folder_id,
    )


@app.get("/api/documents/{doc_id}/structure")
async def get_document_structure(doc_id: str, db: AsyncSession = Depends(get_db)):
    """Get document tree structure."""
    from sqlalchemy import select
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    if doc.status != "completed":
        raise HTTPException(status_code=400, detail="Document not fully processed yet")
    
    if not doc.structure:
        return {"structure": []}
    
    return {"structure": doc.structure}


@app.get("/api/documents/{doc_id}/content")
async def get_document_content(
    doc_id: str, 
    start_page: int, 
    end_page: int,
    db: AsyncSession = Depends(get_db)
):
    """Get document content for specific page range."""
    from sqlalchemy import select
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Get content from structure
    content = doc_service.get_content_from_structure(doc.structure, start_page, end_page)
    
    return {"content": content}


@app.get("/api/documents/{doc_id}/page/{page_num}")
async def get_document_page_content(
    doc_id: str,
    page_num: int,
    db: AsyncSession = Depends(get_db)
):
    """Get original content for a specific page."""
    from sqlalchemy import select
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # 优先从 pages 数据中获取内容
    content = ""
    if doc.pages:
        for page_data in doc.pages:
            if isinstance(page_data, dict) and page_data.get("page") == page_num:
                content = page_data.get("content", "")
                break
    
    # 回退到 structure 提取
    if not content:
        content = doc_service.get_content_from_structure(doc.structure, page_num, page_num)
    
    return {"page": page_num, "content": content, "doc_type": doc.doc_type}


@app.get("/api/documents/{doc_id}/file")
async def get_document_file(
    doc_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Stream the original document file for PDF preview."""
    from sqlalchemy import select
    from fastapi.responses import FileResponse
    import hashlib
    import os
    
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # File is stored in UPLOAD_DIR with original filename
    file_path = os.path.join(settings.UPLOAD_DIR, doc.filename)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    # Determine content type
    content_type_map = {
        'pdf': 'application/pdf',
        'md': 'text/markdown',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }
    content_type = content_type_map.get(doc.doc_type, 'application/octet-stream')
    
    # Generate ETag based on file modification time
    mtime = os.path.getmtime(file_path)
    etag = hashlib.md5(f"{doc_id}-{mtime}".encode()).hexdigest()
    
    # Handle If-None-Match: return 304 Not Modified if ETag matches
    if_none_match = request.headers.get("if-none-match")
    if if_none_match and if_none_match.strip('"') == etag:
        return JSONResponse(status_code=304, content=None, headers={
            "ETag": f'"{etag}"',
            "Cache-Control": "public, max-age=3600",
        })
    
    # Use FileResponse for faster delivery (with caching)
    return FileResponse(
        file_path,
        media_type=content_type,
        filename=doc.filename,
        headers={
            "Cache-Control": "public, max-age=3600",
            "Content-Disposition": f"inline; filename={doc.filename}",
            "ETag": f'"{etag}"',
            "Last-Modified": str(mtime)
        }
    )


@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a document and its associated data."""
    from sqlalchemy import select, delete
    
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Delete file
    file_path = os.path.join(settings.UPLOAD_DIR, doc.filename)
    if os.path.exists(file_path):
        os.remove(file_path)
    
    # Delete from database (cascade will handle related records)
    await db.execute(delete(Document).where(Document.id == doc_id))
    await db.commit()

    # 清理向量索引
    try:
        from app.services.vector_service import remove_document as vs_remove
        vs_remove(doc_id)
    except Exception:
        pass

    return {"message": "Document deleted successfully"}


@app.post("/api/documents/{doc_id}/reindex")
async def reindex_document(
    doc_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """Reindex an existing document (useful when processing failed or model changed)."""
    from sqlalchemy import select
    
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Check if file exists
    file_path = os.path.join(settings.UPLOAD_DIR, doc.filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Document file not found")
    
    # Reset status and clear previous results
    doc.status = "pending"
    doc.structure = None
    doc.doc_description = None
    doc.page_count = None
    doc.line_count = None
    doc.error_message = None
    await db.commit()
    
    # Start background reindexing
    background_tasks.add_task(doc_service.index_document, doc_id, file_path, doc.doc_type)
    
    return {
        "message": "Document reindexing started",
        "doc_id": doc_id,
        "status": "pending"
    }


# ========== Chat Endpoints ==========

@app.post("/api/documents/{doc_id}/chat", response_model=ChatSessionResponse)
async def create_chat_session(
    doc_id: str,
    chat_data: ChatSessionCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new chat session for a document (supports multiple documents)."""
    from sqlalchemy import select

    # Verify primary document exists
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if doc.status != "completed":
        raise HTTPException(status_code=400, detail="Document not fully processed yet")

    # Build document_ids list: include primary doc + any additional docs
    document_ids = chat_data.document_ids or []
    if doc_id not in document_ids:
        document_ids.insert(0, doc_id)

    session = ChatSession(
        document_id=doc_id,
        document_ids=document_ids if len(document_ids) > 1 else None,
        title=chat_data.title or "New Chat",
    )
    db.add(session)
    await db.commit()

    return ChatSessionResponse(
        id=session.id,
        document_id=doc_id,
        document_ids=session.document_ids,
        title=session.title,
        is_auto=session.is_auto,
        created_at=session.created_at,
    )


@app.get("/api/chat/sessions", response_model=List[ChatSessionResponse])
async def list_all_chat_sessions(db: AsyncSession = Depends(get_db)):
    """List all chat sessions across all documents."""
    from sqlalchemy import select

    result = await db.execute(
        select(ChatSession)
        .order_by(ChatSession.created_at.desc())
    )
    sessions = result.scalars().all()

    return [
        ChatSessionResponse(
            id=s.id,
            document_id=s.document_id,
            document_ids=s.document_ids,
            title=s.title,
            is_auto=s.is_auto,
            created_at=s.created_at,
        )
        for s in sessions
    ]


@app.post("/api/chat/auto", response_model=ChatSessionResponse)
async def create_auto_chat_session(
    title: str = "New Chat",
    db: AsyncSession = Depends(get_db)
):
    """创建无需选择文档的自动推断会话"""
    session = ChatSession(
        document_id=None,
        is_auto=True,
        title=title,
    )
    db.add(session)
    await db.commit()

    return ChatSessionResponse(
        id=session.id,
        document_id=session.document_id,
        document_ids=session.document_ids,
        title=session.title,
        is_auto=session.is_auto,
        created_at=session.created_at,
    )


@app.get("/api/documents/{doc_id}/chat", response_model=List[ChatSessionResponse])
async def list_chat_sessions(doc_id: str, db: AsyncSession = Depends(get_db)):
    """List all chat sessions for a document."""
    from sqlalchemy import select

    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.document_id == doc_id)
        .order_by(ChatSession.created_at.desc())
    )
    sessions = result.scalars().all()

    return [
        ChatSessionResponse(
            id=s.id,
            document_id=s.document_id,
            document_ids=s.document_ids,
            title=s.title,
            is_auto=s.is_auto,
            created_at=s.created_at,
        )
        for s in sessions
    ]


@app.get("/api/chat/{session_id}/messages", response_model=List[ChatMessageResponse])
async def get_chat_messages(session_id: str, db: AsyncSession = Depends(get_db)):
    """Get all messages in a chat session."""
    from sqlalchemy import select
    
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)
    )
    messages = result.scalars().all()
    
    normalized = []
    for m in messages:
        # Normalize citations: old format may be list of ints (page numbers)
        citations = m.citations
        if citations and isinstance(citations, list) and citations and isinstance(citations[0], int):
            # Old format: list of page numbers -> convert to None (invalid)
            citations = None
        normalized.append(
            ChatMessageResponse(
                id=m.id,
                role=m.role,
                content=m.content,
                citations=citations,
                created_at=m.created_at,
            )
        )
    return normalized


@app.post("/api/chat/{session_id}/message/stream")
async def send_message_stream(
    session_id: str,
    message_data: ChatMessageCreate,
    db: AsyncSession = Depends(get_db)
):
    """Send a message and get AI response using streaming SSE."""
    import json
    import time as _time
    from fastapi.responses import StreamingResponse
    from sqlalchemy import select

    # Get session
    result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")

    # Get document
    if session.is_auto:
        # 自动推断模式：基于 query 向量匹配文档
        import re as _re
        _system_patterns = [
            r'有哪些.{0,4}(文档|文件|资料|内容)',
            r'当前.{0,6}(文档|文件|资料)',
            r'列出.{0,4}(文档|文件)',
            r'总共.{0,4}(文档|文件)',
            r'几.{0,2}(个|份).{0,4}(文档|文件)',
            r'有什么.{0,4}(文档|文件)',
            r'(文档|文件).{0,4}列表',
            r'(文档|文件).{0,4}数量',
            r'帮我.{0,4}(整理|总结|归纳).{0,4}(全部|所有|所有)',
        ]
        is_system_query = any(_re.search(p, message_data.content) for p in _system_patterns)
        if is_system_query:
            documents = []
        else:
            from app.services.document_service import chat_service as _cs
            documents = await _cs.match_documents_to_query(message_data.content, db)
    else:
        doc_ids = session.document_ids or (session.document_id and [session.document_id]) or []
        documents = []
        for did in doc_ids:
            result = await db.execute(select(Document).where(Document.id == did))
            doc = result.scalar_one_or_none()
            if doc:
                documents.append(doc)

    # Save user message
    user_message = ChatMessage(
        session_id=session_id,
        role="user",
        content=message_data.content,
    )
    db.add(user_message)
    await db.commit()

    # Get chat history
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)
    )
    history = result.scalars().all()
    chat_history = [{"role": msg.role, "content": msg.content} for msg in history[-10:]]

    # Import streaming agent
    from app.services.agent_service import (
        create_agent, run_agent_streaming, TrackedPageIndexClient
    )
    from app.services.document_service import doc_service

    async def generate():
        full_text = ""
        citations = []
        from app.services.document_service import chat_service
        from app.services.prompt_service import get_active_prompt
        from app.services.system_config_service import get_llm_config
        try:
            if documents:
                # 确保所有文档都加载到 client 内存中
                for doc in documents:
                    await doc_service._ensure_doc_in_client(doc)
                doc_client = doc_service.client

                agent_prompt = await get_active_prompt("agent_system")
                rag_template = await get_active_prompt("rag_template")
                if rag_template:
                    agent_prompt = f"{agent_prompt}\n\n{rag_template}"

                # 从数据库获取 LLM 配置
                llm_config = await get_llm_config()
                
                # 更新环境变量供 LiteLLM 使用
                api_key = llm_config["dashscope_key"] or llm_config["openai_key"]
                if api_key:
                    os.environ["OPENAI_API_KEY"] = api_key
                if llm_config["api_base_url"]:
                    os.environ["OPENAI_BASE_URL"] = llm_config["api_base_url"]

                if len(documents) == 1:
                    # 单文档：使用 Agent 流式（支持 get_page_content 等工具）
                    document = documents[0]

                    # 添加文档上下文信息
                    agent_prompt += f"\n\nDocument: {document.original_name}"
                    if document.doc_description:
                        agent_prompt += f"\nDescription: {document.doc_description}"
                    if document.page_count:
                        agent_prompt += f"\nPages: {document.page_count}"
                    
                    # 注入预计算的结构摘要
                    if document.structure_summary:
                        agent_prompt += f"\n\nDocument Structure:\n{document.structure_summary}"
                        agent_prompt += (
                            "\n\nIMPORTANT: Document metadata and structure are already provided above. "
                            "You ONLY have access to the get_page_content() tool. "
                            "Call get_page_content(pages=\"5-7\") with tight page ranges to read specific content. "
                            "Do NOT attempt to call get_document() or get_document_structure() — they are not available."
                        )

                    # 添加聊天历史
                    if chat_history:
                        history_text = "\n".join(
                            f"{msg.get('role', 'user')}: {msg.get('content', '')}"
                            for msg in chat_history[-5:]
                        )
                        agent_prompt += f"\n\nChat history:\n{history_text}"
                    
                    # 检查是否启用视觉功能
                    vision_enabled = llm_config["vision_enabled"]
                    if vision_enabled:
                        agent_prompt += (
                            "\n\nVISUAL MODE: This system supports visual analysis of PDF pages. "
                            "When you need to analyze charts, diagrams, formulas, or visual layouts, "
                            "use the get_page_images() or get_page_images_base64() tools to get page images. "
                            "Then analyze the images to answer visual questions."
                        )

                    include_metadata_tools = not document.structure_summary
                    agent, tracked = await create_agent(
                        doc_client=doc_client,
                        doc_id=document.id,
                        system_prompt=agent_prompt,
                        include_metadata_tools=include_metadata_tools,
                        include_vision_tools=vision_enabled,
                    )

                    async for event in run_agent_streaming(agent, tracked, message_data.content):
                        if event["type"] == "text_delta":
                            full_text += str(event["content"])
                            yield f"data: {json.dumps({'type': 'delta', 'content': event['content']})}\n\n"
                        elif event["type"] == "tool_call":
                            yield f"data: {json.dumps({'type': 'tool_call', 'tool': event['tool']})}\n\n"
                        elif event["type"] == "done":
                            citations = event.get("citations", [])
                            full_text = str(event.get("full_text", full_text))
                            formatted_citations_for_sse = None
                            if citations and documents:
                                document = documents[0]
                                raw_cits = chat_service._extract_citations(
                                    document, str(full_text), citations
                                )
                                formatted_citations_for_sse = [
                                    {k: v for k, v in c.items() if k != 'index'}
                                    for c in raw_cits
                                ] if raw_cits else None
                            yield f"data: {json.dumps({'type': 'done', 'citations': formatted_citations_for_sse or []})}\n\n"
                        elif event["type"] == "error":
                            full_text = f"Error: {event['message']}"
                            yield f"data: {json.dumps({'type': 'error', 'message': event['message']})}\n\n"
                else:
                    # 多文档：合并所有文档上下文，使用直接流式 LLM 调用
                    from app.services.document_service import _extract_structure_summary

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

                    # 添加聊天历史
                    if chat_history:
                        history_text = "\n".join(
                            f"{msg.get('role', 'user')}: {msg.get('content', '')}"
                            for msg in chat_history[-5:]
                        )
                        agent_prompt += f"\n\nChat history:\n{history_text}"

                    model = llm_config["default_model"]

                    from litellm import acompletion
                    response = await acompletion(
                        model=model,
                        messages=[
                            {"role": "system", "content": agent_prompt},
                            {"role": "user", "content": message_data.content},
                        ],
                        temperature=0.7,
                        max_tokens=2000,
                        stream=True,
                    )

                    async for chunk in response:
                        if chunk.choices[0].delta.content:
                            delta = chunk.choices[0].delta.content
                            full_text += delta
                            yield f"data: {json.dumps({'type': 'delta', 'content': delta})}\n\n"

                    # 构建多文档 citations
                    multi_citations = []
                    for doc in documents:
                        pages = doc.pages if hasattr(doc, 'pages') and doc.pages else []
                        if pages:
                            for pd in pages[:3]:
                                if isinstance(pd, dict):
                                    multi_citations.append({
                                        "page": pd.get("page", 0),
                                        "text": pd.get("content", "")[:2000],
                                        "node_title": f"{doc.original_name} - Page {pd.get('page', 0)}",
                                        "document_id": doc.id,
                                    })
                    citations = [c["page"] for c in multi_citations]
                    yield f"data: {json.dumps({'type': 'done', 'citations': multi_citations[:5]})}\n\n"
            else:
                # 系统查询模式：注入实际文档列表，让 AI 能准确回答
                from sqlalchemy import select as sa_select
                result = await db.execute(
                    sa_select(Document).where(Document.status == "completed").order_by(Document.created_at.desc())
                )
                all_docs = result.scalars().all()
                system_prompt = "你是一个有帮助的助手，可以回答各种问题。"
                if all_docs:
                    doc_lines = []
                    for d in all_docs:
                        desc = f" - {d.doc_description[:100]}" if d.doc_description else ""
                        pages = f" ({d.page_count}页)" if d.page_count else ""
                        doc_lines.append(f"- {d.original_name}{pages}{desc}")
                    system_prompt += "\n\n当前系统中已索引的文档列表（用户询问文档/文件相关问题时，如实列出以下文档，不要虚构不存在的文档）：\n" + "\n".join(doc_lines)
                else:
                    system_prompt += "\n\n当前系统中没有已索引的文档。"

                agent, tracked = await create_agent(
                    doc_client=None,
                    doc_id="",
                    system_prompt=system_prompt,
                )

                async for event in run_agent_streaming(agent, tracked, message_data.content):
                    if event["type"] == "text_delta":
                        full_text += str(event["content"])
                        yield f"data: {json.dumps({'type': 'delta', 'content': event['content']})}\n\n"
                    elif event["type"] == "tool_call":
                        yield f"data: {json.dumps({'type': 'tool_call', 'tool': event['tool']})}\n\n"
                    elif event["type"] == "done":
                        yield f"data: {json.dumps({'type': 'done', 'citations': []})}\n\n"
                    elif event["type"] == "error":
                        full_text = f"Error: {event['message']}"
                        yield f"data: {json.dumps({'type': 'error', 'message': event['message']})}\n\n"
        except asyncio.CancelledError:
            pass
        except Exception as e:
            full_text = f"Error: {str(e)}"
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            # Save AI response to DB
            if full_text:
                try:
                    formatted_citations = None
                    if documents:
                        if len(documents) == 1 and citations:
                            document = documents[0]
                            raw_citations = chat_service._extract_citations(
                                document, str(full_text), citations
                            )
                            formatted_citations = [
                                {k: v for k, v in c.items() if k != 'index'}
                                for c in raw_citations
                            ] if raw_citations else None
                        elif len(documents) > 1:
                            # 多文档：重新构建 citations 用于 DB 保存
                            from app.services.document_service import _extract_structure_summary
                            all_citations = []
                            for doc in documents:
                                pages = doc.pages if hasattr(doc, 'pages') and doc.pages else []
                                if pages:
                                    for pd in pages[:3]:
                                        if isinstance(pd, dict):
                                            all_citations.append({
                                                "page": pd.get("page", 0),
                                                "text": pd.get("content", "")[:2000],
                                                "node_title": f"{doc.original_name} - Page {pd.get('page', 0)}",
                                                "document_id": doc.id,
                                            })
                            formatted_citations = all_citations[:5] if all_citations else None

                    async with async_session() as save_db:
                        ai_message = ChatMessage(
                            session_id=session_id,
                            role="assistant",
                            content=full_text,
                            citations=formatted_citations,
                        )
                        save_db.add(ai_message)
                        await save_db.commit()
                except Exception:
                    pass

            try:
                yield "data: [DONE]\n\n"
            except Exception:
                pass

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.put("/api/chat/{session_id}", response_model=ChatSessionResponse)
async def update_chat_session(
    session_id: str,
    update_data: ChatSessionUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update chat session title."""
    from sqlalchemy import select
    
    result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    
    session.title = update_data.title
    await db.commit()
    
    return ChatSessionResponse(
        id=session.id,
        document_id=session.document_id,
        document_ids=session.document_ids,
        title=session.title,
        is_auto=session.is_auto,
        created_at=session.created_at,
    )


@app.delete("/api/chat/{session_id}")
async def delete_chat_session(session_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a chat session and all its messages."""
    from sqlalchemy import select, delete
    
    # Delete all messages in the session
    await db.execute(delete(ChatMessage).where(ChatMessage.session_id == session_id))
    
    # Delete the session
    result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    
    await db.delete(session)
    await db.commit()
    
    return {"message": "Chat session deleted"}


@app.delete("/api/chat/{session_id}/messages")
async def delete_messages(
    session_id: str,
    delete_data: MessageDeleteRequest,
    db: AsyncSession = Depends(get_db)
):
    """Delete specific messages."""
    from sqlalchemy import delete
    
    await db.execute(
        delete(ChatMessage).where(
            ChatMessage.id.in_(delete_data.message_ids),
            ChatMessage.session_id == session_id
        )
    )
    await db.commit()

    return {"message": "Messages deleted"}


# ========== Folder Endpoints ==========

def build_folder_tree(folders: List[Folder], root_docs: List[Document]) -> List[FolderResponse]:
    """Build folder tree from flat list."""
    folder_map = {f.id: f for f in folders}
    doc_map = {d.id: d for d in root_docs}

    def build_tree(parent_id: Optional[str]) -> List[FolderResponse]:
        children = [folder_map[f.id] for f in folders if f.parent_id == parent_id]
        return [
            FolderResponse(
                id=f.id,
                name=f.name,
                description=f.description,
                parent_id=f.parent_id,
                created_at=f.created_at,
                updated_at=f.updated_at,
                children=build_tree(f.id),
                documents=[
                    DocumentListResponse(
                        id=d.id,
                        filename=d.original_name,
                        doc_type=d.doc_type,
                        status=d.status,
                        doc_description=d.doc_description,
                        page_count=d.page_count,
                        created_at=d.created_at,
                        folder_id=d.folder_id,
                    )
                    for d in root_docs if d.folder_id == f.id
                ],
            )
            for f in children
        ]

    return build_tree(None)


@app.get("/api/folders", response_model=List[FolderResponse])
async def list_folders(db: AsyncSession = Depends(get_db)):
    """Get all folders as a tree structure."""
    from sqlalchemy import select
    result = await db.execute(select(Folder).order_by(Folder.created_at))
    folders = result.scalars().all()

    doc_result = await db.execute(select(Document).where(Document.folder_id.isnot(None)))
    docs = doc_result.scalars().all()

    return build_folder_tree(list(folders), list(docs))


@app.post("/api/folders", response_model=FolderResponse)
async def create_folder(data: FolderCreate, db: AsyncSession = Depends(get_db)):
    """Create a new folder."""
    from sqlalchemy import select

    if data.parent_id:
        parent = await db.execute(select(Folder).where(Folder.id == data.parent_id))
        if not parent.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Parent folder not found")

    folder = Folder(
        name=data.name,
        description=data.description,
        parent_id=data.parent_id,
    )
    db.add(folder)
    await db.commit()

    return FolderResponse(
        id=folder.id,
        name=folder.name,
        description=folder.description,
        parent_id=folder.parent_id,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
        children=[],
        documents=[],
    )


@app.put("/api/folders/{folder_id}", response_model=FolderResponse)
async def update_folder(folder_id: str, data: FolderUpdate, db: AsyncSession = Depends(get_db)):
    """Rename a folder."""
    from sqlalchemy import select

    result = await db.execute(select(Folder).where(Folder.id == folder_id))
    folder = result.scalar_one_or_none()

    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    folder.name = data.name
    if data.description is not None:
        folder.description = data.description
    await db.commit()

    return FolderResponse(
        id=folder.id,
        name=folder.name,
        description=folder.description,
        parent_id=folder.parent_id,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
        children=[],
        documents=[],
    )


@app.delete("/api/folders/{folder_id}")
async def delete_folder(folder_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a folder and all its children and documents."""
    from sqlalchemy import select, delete

    # Recursively get all child folder IDs
    async def get_all_folder_ids(parent_id: str) -> List[str]:
        result = await db.execute(select(Folder).where(Folder.parent_id == parent_id))
        children = result.scalars().all()
        ids = [parent_id]
        for child in children:
            ids.extend(await get_all_folder_ids(child.id))
        return ids

    folder_ids = await get_all_folder_ids(folder_id)

    # Move documents in these folders to root
    await db.execute(
        Document.__table__.update()
        .where(Document.folder_id.in_(folder_ids))
        .values(folder_id=None)
    )

    # Delete all folders
    await db.execute(delete(Folder).where(Folder.id.in_(folder_ids)))
    await db.commit()

    return {"message": "Folder deleted successfully"}


@app.put("/api/folders/{folder_id}/move")
async def move_folder(folder_id: str, data: FolderUpdate, db: AsyncSession = Depends(get_db)):
    """Move a folder to another parent."""
    from sqlalchemy import select

    result = await db.execute(select(Folder).where(Folder.id == folder_id))
    folder = result.scalar_one_or_none()

    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    new_parent_id = data.name  # data.name is used as parent_id in this case

    if new_parent_id == folder_id:
        raise HTTPException(status_code=400, detail="Cannot move folder to itself")

    if new_parent_id:
        parent = await db.execute(select(Folder).where(Folder.id == new_parent_id))
        if not parent.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Target folder not found")

    folder.parent_id = new_parent_id
    await db.commit()

    return {"message": "Folder moved successfully"}


@app.put("/api/documents/{doc_id}/move")
async def move_document(doc_id: str, data: FolderCreate, db: AsyncSession = Depends(get_db)):
    """Move a document to a folder."""
    from sqlalchemy import select

    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if data.parent_id:
        folder = await db.execute(select(Folder).where(Folder.id == data.parent_id))
        if not folder.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Folder not found")

    doc.folder_id = data.parent_id
    await db.commit()

    return {"message": "Document moved successfully"}


# ========== Prompt Endpoints ==========

@app.get("/api/prompts")
async def list_all_prompts():
    from app.services.prompt_service import get_all_active_prompts
    prompts = await get_all_active_prompts()
    return prompts


@app.get("/api/prompts/{category}")
async def get_prompt(category: str):
    from app.services.prompt_service import get_active_prompt
    content = await get_active_prompt(category)
    if not content:
        raise HTTPException(status_code=404, detail=f"No active prompt for category: {category}")
    return {"category": category, "content": content}


@app.get("/api/prompts/{category}/versions")
async def list_prompt_versions(category: str):
    from app.services.prompt_service import list_versions
    versions = await list_versions(category)
    return [
        {
            "id": v.id,
            "category": v.category,
            "name": v.name,
            "content": v.content,
            "version": v.version,
            "is_active": v.is_active,
            "description": v.description,
            "created_at": v.created_at,
        }
        for v in versions
    ]


@app.post("/api/prompts/{category}")
async def create_prompt_version(category: str, data: PromptConfigCreate):
    from app.services.prompt_service import create_prompt
    prompt = await create_prompt(category, data.name, data.content, data.description)
    return {
        "id": prompt.id,
        "category": prompt.category,
        "name": prompt.name,
        "content": prompt.content,
        "version": prompt.version,
        "is_active": prompt.is_active,
        "description": prompt.description,
        "created_at": prompt.created_at,
    }


@app.put("/api/prompts/{category}/active/{prompt_id}")
async def activate_prompt_version(category: str, prompt_id: str):
    from app.services.prompt_service import activate_prompt
    prompt = await activate_prompt(category, prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"message": f"Activated version {prompt.version} for {category}"}


@app.delete("/api/prompts/{category}/versions/{prompt_id}")
async def delete_prompt_version(category: str, prompt_id: str):
    from app.services.prompt_service import delete_prompt
    success = await delete_prompt(prompt_id)
    if not success:
        raise HTTPException(status_code=400, detail="Cannot delete active prompt or prompt not found")
    return {"message": "Prompt version deleted"}


# ========== SystemConfig Endpoints ==========

@app.get("/api/system-configs")
async def list_system_configs():
    from app.services.system_config_service import list_configs
    configs = await list_configs()
    return [
        {
            "key": c.key,
            "value": c.value,
            "description": c.description,
            "updated_at": c.updated_at,
        }
        for c in configs
    ]


@app.put("/api/system-configs/{key}")
async def update_system_config(key: str, data: SystemConfigUpdate):
    from app.services.system_config_service import update_config
    config = await update_config(key, data.value)
    return {
        "key": config.key,
        "value": config.value,
        "description": config.description,
        "updated_at": config.updated_at,
    }


# ========== Debug: Vector DB Inspector ==========

@app.get("/api/vector-db/status")
async def vector_db_status():
    """检查向量数据库是否有数据"""
    from app.services.vector_service import _get_milvus_client, ensure_collection, COLLECTION_NAME
    try:
        ensure_collection()
        client = _get_milvus_client()
        client.load_collection(COLLECTION_NAME)
        stats = client.get_collection_stats(COLLECTION_NAME)
        row_count = int(stats.get("row_count", 0))
        return {"row_count": row_count, "has_data": row_count > 0}
    except Exception:
        return {"row_count": 0, "has_data": False}


@app.get("/api/debug/vector-db")
async def inspect_vector_db():
    """临时调试端点：查看向量数据库中的所有数据"""
    from app.services.vector_service import _get_milvus_client, ensure_collection, COLLECTION_NAME
    ensure_collection()
    client = _get_milvus_client()
    client.load_collection(COLLECTION_NAME)
    stats = client.get_collection_stats(COLLECTION_NAME)
    row_count = int(stats.get("row_count", 0))
    if row_count == 0:
        return {"row_count": 0, "records": []}
    # 查询所有记录（不包含 embedding 向量，太大）
    results = client.query(
        collection_name=COLLECTION_NAME,
        filter="",
        output_fields=["document_id", "description"],
        limit=row_count,
    )
    return {"row_count": row_count, "records": results}


# ========== Vision Endpoints ==========

@app.get("/api/documents/{doc_id}/page-images")
async def get_page_images(
    doc_id: str,
    pages: str,
    dpi: int = 150,
    db: AsyncSession = Depends(get_db)
):
    """Get page images for visual analysis."""
    from sqlalchemy import select
    from backend.pageindex.vision import pdf_pages_to_images
    
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    if doc.doc_type != "pdf":
        raise HTTPException(status_code=400, detail="Page images are only supported for PDF documents")
    
    try:
        # Parse pages string
        page_nums = []
        for part in pages.split(','):
            part = part.strip()
            if '-' in part:
                start, end = int(part.split('-', 1)[0]), int(part.split('-', 1)[1])
                page_nums.extend(range(start, end + 1))
            else:
                page_nums.append(int(part))
        
        if not page_nums:
            raise HTTPException(status_code=400, detail="Invalid pages format")
        
        # Get page images
        images = pdf_pages_to_images(
            pdf_path=os.path.join(settings.UPLOAD_DIR, doc.filename),
            start_page=min(page_nums),
            end_page=max(page_nums),
            dpi=dpi,
        )
        
        return {"images": images}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract page images: {str(e)}")


@app.get("/api/documents/{doc_id}/page-images-base64")
async def get_page_images_base64(
    doc_id: str,
    pages: str,
    dpi: int = 150,
    db: AsyncSession = Depends(get_db)
):
    """Get page images as base64 encoded strings for visual analysis."""
    from sqlalchemy import select
    from app.services.indexing.vision import pdf_pages_to_base64
    
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    if doc.doc_type != "pdf":
        raise HTTPException(status_code=400, detail="Page images are only supported for PDF documents")
    
    try:
        # Parse pages string
        page_nums = []
        for part in pages.split(','):
            part = part.strip()
            if '-' in part:
                start, end = int(part.split('-', 1)[0]), int(part.split('-', 1)[1])
                page_nums.extend(range(start, end + 1))
            else:
                page_nums.append(int(part))
        
        if not page_nums:
            raise HTTPException(status_code=400, detail="Invalid pages format")
        
        # Get page images as base64
        images = pdf_pages_to_base64(
            pdf_path=os.path.join(settings.UPLOAD_DIR, doc.filename),
            start_page=min(page_nums),
            end_page=max(page_nums),
            dpi=dpi,
        )
        
        return {"images": images}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract page images: {str(e)}")


# ========== Health Check ==========

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": settings.APP_NAME}
