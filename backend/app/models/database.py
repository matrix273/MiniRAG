import uuid
from datetime import datetime
from typing import List, Optional, Dict, Any

from sqlalchemy import String, DateTime, Text, JSON, Integer, ForeignKey, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import Mapped, mapped_column, relationship, sessionmaker
from sqlalchemy.sql import func
import logging

from app.models.base import Base

# Import auth models so Base.metadata.create_all picks them up
from app.models.user import User, Role, Permission, UserRole, RolePermission, RefreshToken  # noqa: F401

from app.core.config import get_settings

settings = get_settings()

# Database engine - disable echo in production
engine = create_async_engine(
    settings.DATABASE_URL, 
    echo=settings.DEBUG,  # Only echo SQL when DEBUG=True
    # Hide SQL parameter logging for cleaner output
    hide_parameters=True,
)

# Set SQLAlchemy log level to WARNING to reduce noise
logging.getLogger('sqlalchemy.engine').setLevel(logging.WARNING)
logging.getLogger('sqlalchemy.pool').setLevel(logging.WARNING)

# Session factory for database operations
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Document(Base):
    """Document model for storing uploaded documents."""
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    doc_type: Mapped[str] = mapped_column(String(10), nullable=False)  # pdf, md
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending, processing, completed, error
    doc_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    page_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    line_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    structure: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    structure_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # 预计算的结构摘要，用于加速 Agent 查询
    pages: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSON, nullable=True)  # 原始页面文本，用于调试和精确检索
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())
    folder_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("folders.id", ondelete="SET NULL"), nullable=True)

    # Relationships
    chat_sessions: Mapped[List["ChatSession"]] = relationship(back_populates="document", lazy="selectin")
    folder: Mapped[Optional["Folder"]] = relationship(back_populates="documents")


class ChatSession(Base):
    """Chat session for document conversations."""
    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=True)  # 主文档 ID（auto 模式下可为空）
    document_ids: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)  # 多文档 ID 列表
    title: Mapped[str] = mapped_column(String(255), default="New Chat")
    is_auto: Mapped[bool] = mapped_column(default=False)  # 自动推断模式
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    document: Mapped["Document"] = relationship(back_populates="chat_sessions")
    messages: Mapped[List["ChatMessage"]] = relationship(back_populates="session", lazy="selectin", order_by="ChatMessage.created_at")


class ChatMessage(Base):
    """Chat message in a session."""
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("chat_sessions.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user, assistant, system
    content: Mapped[str] = mapped_column(Text, nullable=False)
    citations: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSON, nullable=True)  # Page/section references
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    session: Mapped["ChatSession"] = relationship(back_populates="messages")


class Folder(Base):
    """Folder model for organizing documents."""
    __tablename__ = "folders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    parent_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("folders.id", ondelete="CASCADE"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    # Relationships
    children: Mapped[List["Folder"]] = relationship(back_populates="parent", lazy="selectin")
    parent: Mapped[Optional["Folder"]] = relationship(back_populates="children", remote_side="Folder.id")
    documents: Mapped[List["Document"]] = relationship(back_populates="folder", lazy="selectin")


class PromptConfig(Base):
    """Prompt configuration with version management."""
    __tablename__ = "prompt_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    category: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(default=False)
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SystemConfig(Base):
    """System configuration key-value store."""
    __tablename__ = "system_configs"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=func.now(), onupdate=func.now(), server_default=func.now())


async def init_db():
    """Initialize database tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncSession:
    """Get database session."""
    from sqlalchemy.orm import sessionmaker
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
