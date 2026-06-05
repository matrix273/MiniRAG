from .client import PageIndexClient
from .indexer import (
    MarkdownIndexer, PDFIndexer, 
    index_document, create_indexer,
    md_to_tree, page_index  # 向后兼容
)
from .parsers.office_to_tree import docx_to_tree, xlsx_to_tree, pptx_to_tree
from .retrieval import get_document, get_document_structure, get_page_content, get_page_images_info
from .vision import pdf_pages_to_images, pdf_pages_to_base64

__all__ = [
    # 核心类
    "PageIndexClient",
    "MarkdownIndexer",
    "PDFIndexer",
    
    # 便捷函数
    "index_document",
    "create_indexer",
    
    # 向后兼容
    "page_index",
    "md_to_tree",
    
    # Office 解析器
    "docx_to_tree",
    "xlsx_to_tree",
    "pptx_to_tree",
    
    # 检索
    "get_document",
    "get_document_structure",
    "get_page_content",
    "get_page_images_info",
    
    # 视觉
    "pdf_pages_to_images",
    "pdf_pages_to_base64",
]