from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
import uuid
import os
import shutil
import json

# Set environment variables BEFORE importing pageindex (it uses load_dotenv on import)
from app.core.config import get_settings
settings = get_settings()

# LiteLLM 直接使用 DASHSCOPE_API_KEY 环境变量
if settings.DASHSCOPE_API_KEY:
    os.environ["DASHSCOPE_API_KEY"] = settings.DASHSCOPE_API_KEY
elif settings.OPENAI_API_KEY:
    os.environ["OPENAI_API_KEY"] = settings.OPENAI_API_KEY
    if settings.OPENAI_BASE_URL:
        os.environ["OPENAI_BASE_URL"] = settings.OPENAI_BASE_URL

from app.models.database import get_db, Document, ChatSession, ChatMessage, init_db
from app.services.document_service import doc_service, chat_service
from app.schemas.schemas import (
    DocumentResponse, 
    DocumentListResponse,
    DocumentCreate,
    ChatSessionCreate,
    ChatSessionResponse,
    ChatMessageCreate,
    ChatMessageResponse,
    TreeNode,
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


@app.on_event("startup")
async def startup():
    """Initialize database on startup."""
    await init_db()
    # Ensure upload directory exists
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)


# ========== Document Endpoints ==========

@app.post("/api/documents/upload")
async def upload_documents(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db)
):
    """Upload multiple documents (PDF or Markdown) and start indexing."""
    allowed_extensions = {'.pdf', '.md', '.markdown'}
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
        
        doc_type = "pdf" if file_ext == ".pdf" else "md"
        doc = Document(
            id=doc_id,
            filename=safe_filename,
            original_name=file.filename,
            doc_type=doc_type,
            status="pending",
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
            }
            for doc in results
        ],
        "errors": errors if errors else None,
        "total_uploaded": len(results),
        "total_errors": len(errors),
    }


@app.get("/api/documents", response_model=List[DocumentListResponse])
async def list_documents(db: AsyncSession = Depends(get_db)):
    """List all documents."""
    from sqlalchemy import select
    result = await db.execute(select(Document).order_by(Document.created_at.desc()))
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
    
    # Remove text fields to save bandwidth (frontend can fetch pages on demand)
    def clean_structure(nodes):
        if isinstance(nodes, list):
            return [clean_structure(node) for node in nodes]
        if isinstance(nodes, dict):
            cleaned = {k: v for k, v in nodes.items() if k != "text"}
            if "nodes" in cleaned:
                cleaned["nodes"] = clean_structure(cleaned["nodes"])
            return cleaned
        return nodes
    
    return {"structure": clean_structure(doc.structure)}


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
    """Create a new chat session for a document."""
    from sqlalchemy import select
    
    # Verify document exists
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    if doc.status != "completed":
        raise HTTPException(status_code=400, detail="Document not fully processed yet")
    
    session = ChatSession(
        document_id=doc_id,
        title=chat_data.title or "New Chat",
    )
    db.add(session)
    await db.commit()
    
    return ChatSessionResponse(
        id=session.id,
        document_id=doc_id,
        title=session.title,
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
            document_id=doc_id,
            title=s.title,
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
    
    return [
        ChatMessageResponse(
            id=m.id,
            role=m.role,
            content=m.content,
            citations=m.citations,
            created_at=m.created_at,
        )
        for m in messages
    ]


@app.post("/api/chat/{session_id}/message", response_model=ChatMessageResponse)
async def send_message(
    session_id: str,
    message_data: ChatMessageCreate,
    db: AsyncSession = Depends(get_db)
):
    """Send a message and get AI response using PageIndex reasoning-based retrieval."""
    from sqlalchemy import select
    
    # Get session
    result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    
    # Get document
    result = await db.execute(select(Document).where(Document.id == session.document_id))
    document = result.scalar_one_or_none()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    if document.status != "completed":
        raise HTTPException(status_code=400, detail="Document not fully processed yet")
    
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
    
    # Query AI with PageIndex reasoning-based retrieval
    try:
        answer, citations = await chat_service.query_document(
            document=document,
            query=message_data.content,
            chat_history=[
                {"role": msg.role, "content": msg.content}
                for msg in history[-10:]  # Include last 10 messages for context
            ]
        )
    except Exception as e:
        # Log error and return fallback response
        import logging
        logging.error(f"Error querying document: {e}")
        answer = f"I'm sorry, I encountered an error processing your question. Error: {str(e)}"
        citations = []
    
    # Save AI response
    ai_message = ChatMessage(
        session_id=session_id,
        role="assistant",
        content=answer,
        citations=citations if citations else None,
    )
    db.add(ai_message)
    await db.commit()
    
    return ChatMessageResponse(
        id=ai_message.id,
        role=ai_message.role,
        content=ai_message.content,
        citations=ai_message.citations,
        created_at=ai_message.created_at,
    )


# ========== Health Check ==========

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": settings.APP_NAME}
