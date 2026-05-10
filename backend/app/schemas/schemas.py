from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime


# Document Schemas
class DocumentCreate(BaseModel):
    filename: str
    doc_type: str


class DocumentResponse(BaseModel):
    id: str
    filename: str
    doc_type: str
    status: str
    doc_description: Optional[str] = None
    page_count: Optional[int] = None
    line_count: Optional[int] = None
    structure: Optional[List[Dict[str, Any]]] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    folder_id: Optional[str] = None

    class Config:
        from_attributes = True


class DocumentListResponse(BaseModel):
    id: str
    filename: str
    doc_type: str
    status: str
    doc_description: Optional[str] = None
    page_count: Optional[int] = None
    created_at: datetime
    folder_id: Optional[str] = None

    class Config:
        from_attributes = True


# Folder Schemas
class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[str] = None


class FolderUpdate(BaseModel):
    name: str


class FolderResponse(BaseModel):
    id: str
    name: str
    parent_id: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime] = None
    children: Optional[List["FolderResponse"]] = []
    documents: Optional[List[DocumentListResponse]] = []

    class Config:
        from_attributes = True


# Tree Structure Schema
class TreeNode(BaseModel):
    title: str
    node_id: Optional[str] = None
    start_index: Optional[int] = None
    end_index: Optional[int] = None
    summary: Optional[str] = None
    nodes: Optional[List["TreeNode"]] = None


# Chat Schemas
class ChatSessionCreate(BaseModel):
    title: Optional[str] = "New Chat"


class ChatSessionResponse(BaseModel):
    id: str
    document_id: str
    title: str
    created_at: datetime

    class Config:
        from_attributes = True


class ChatMessageCreate(BaseModel):
    content: str


class ChatSessionUpdate(BaseModel):
    title: str


class MessageDeleteRequest(BaseModel):
    message_ids: List[str]


class Citation(BaseModel):
    page: int
    text: str
    node_title: Optional[str] = None


class ChatMessageResponse(BaseModel):
    id: str
    role: str
    content: str
    citations: Optional[List[Citation]] = None
    created_at: datetime

    class Config:
        from_attributes = True
