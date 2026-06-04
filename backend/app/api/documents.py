from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid
import os
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from app.models.database import get_db, Document
from app.core.config import get_settings
from app.services.document_service import doc_service
from app.schemas.schemas import SaveContentRequest, CreateMarkdownRequest, DocumentResponse

logger = logging.getLogger(__name__)

router = APIRouter()
settings = get_settings()


@router.put("/api/documents/{doc_id}/content")
async def save_document_content(
    doc_id: str,
    request: SaveContentRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """保存 Markdown 文档内容并重新索引"""
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    if doc.doc_type != "md":
        raise HTTPException(status_code=400, detail="只能编辑 Markdown 文档")

    # 保存文件（路径穿越防护）
    upload_dir = os.path.abspath(settings.UPLOAD_DIR)
    file_path = os.path.join(upload_dir, doc.filename)
    if not file_path.startswith(upload_dir + os.sep) and file_path != upload_dir:
        raise HTTPException(status_code=400, detail="非法文件路径")

    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(request.content)
    except OSError as e:
        logger.error("文件写入失败: %s", e)
        raise HTTPException(status_code=500, detail="文件保存失败")

    # 更新数据库
    line_count = len(request.content.split('\n'))
    doc.line_count = line_count
    doc.status = "processing"
    doc.updated_at = datetime.now(ZoneInfo("Asia/Shanghai"))
    await db.commit()

    # 触发重新索引
    background_tasks.add_task(doc_service.index_document, doc_id, file_path, "md")

    return {
        "success": True,
        "message": "Document saved and re-indexed",
        "line_count": line_count,
        "status": "processing",
        "updated_at": doc.updated_at.isoformat()
    }


@router.put("/api/documents/{doc_id}/draft")
async def save_document_draft(
    doc_id: str,
    request: SaveContentRequest,
    db: AsyncSession = Depends(get_db)
):
    """Save Markdown document draft without triggering re-index"""
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.doc_type != "md":
        raise HTTPException(status_code=400, detail="Only Markdown documents can be edited")

    # Save file (path traversal protection)
    upload_dir = os.path.abspath(settings.UPLOAD_DIR)
    file_path = os.path.join(upload_dir, doc.filename)
    if not file_path.startswith(upload_dir + os.sep) and file_path != upload_dir:
        raise HTTPException(status_code=400, detail="Invalid file path")

    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(request.content)
    except OSError as e:
        logger.error("File write failed: %s", e)
        raise HTTPException(status_code=500, detail="File save failed")

    # Update DB only, no re-index
    line_count = len(request.content.split('\n'))
    doc.line_count = line_count
    doc.updated_at = datetime.now(ZoneInfo("Asia/Shanghai"))
    await db.commit()

    return {
        "success": True,
        "message": "Draft saved (not indexed)",
        "line_count": line_count,
        "status": doc.status,
        "updated_at": doc.updated_at.isoformat()
    }


@router.get("/api/documents/{doc_id}/raw")
async def get_document_raw(
    doc_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get raw file content directly from disk (for editing)."""
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Read raw file from disk
    upload_dir = os.path.abspath(settings.UPLOAD_DIR)
    file_path = os.path.join(upload_dir, doc.filename)
    if not file_path.startswith(upload_dir + os.sep) and file_path != upload_dir:
        raise HTTPException(status_code=400, detail="Invalid file path")

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except OSError as e:
        logger.error("File read failed: %s", e)
        raise HTTPException(status_code=500, detail="File read failed")

    return {"content": content, "filename": doc.filename, "doc_type": doc.doc_type}


@router.post("/api/documents/create-md", response_model=DocumentResponse)
async def create_markdown_document(
    request: CreateMarkdownRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """创建新的 Markdown 文档"""
    # 生成文件名
    doc_id = str(uuid.uuid4())
    original_name = request.filename or "untitled.md"
    if not original_name.endswith('.md'):
        original_name += '.md'
    safe_filename = f"{doc_id}.md"

    # 保存文件
    upload_dir = os.path.abspath(settings.UPLOAD_DIR)
    file_path = os.path.join(upload_dir, safe_filename)
    if not file_path.startswith(upload_dir + os.sep) and file_path != upload_dir:
        raise HTTPException(status_code=400, detail="非法文件路径")

    content = request.content or f"# {original_name.replace('.md', '')}\n\n"
    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
    except OSError as e:
        logger.error("文件写入失败: %s", e)
        raise HTTPException(status_code=500, detail="文件创建失败")

    # 创建数据库记录
    doc = Document(
        id=doc_id,
        filename=safe_filename,
        original_name=original_name,
        doc_type="md",
        status="processing",
        line_count=len(content.split('\n')),
        folder_id=request.folder_id
    )
    db.add(doc)
    await db.commit()

    # 触发索引
    background_tasks.add_task(doc_service.index_document, doc_id, file_path, "md")

    return doc
