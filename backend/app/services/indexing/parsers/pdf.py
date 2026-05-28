"""
PDF 解析器
从 PDF 文件中提取页面内容和 token 信息
"""

import os
from io import BytesIO
from typing import List, Tuple, Union

import PyPDF2

try:
    import pymupdf
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False


def get_page_tokens(
    pdf_path: Union[str, BytesIO],
    model: str = None,
    pdf_parser: str = "PyPDF2"
) -> List[Tuple[str, int]]:
    """
    获取 PDF 每页的文本内容和 token 数量
    
    Args:
        pdf_path: PDF 文件路径或 BytesIO 对象
        model: LLM 模型名称（用于计算 token）
        pdf_parser: PDF 解析器选择 ("PyPDF2" 或 "PyMuPDF")
        
    Returns:
        [(page_text, token_count), ...] 每页的文本和 token 数
    """
    from ...utils.llm import count_tokens
    
    if pdf_parser == "PyPDF2":
        pdf_reader = PyPDF2.PdfReader(pdf_path)
        page_list = []
        for page_num in range(len(pdf_reader.pages)):
            page = pdf_reader.pages[page_num]
            page_text = page.extract_text() or ""
            token_length = count_tokens(page_text, model=model)
            page_list.append((page_text, token_length))
        return page_list
    
    elif pdf_parser == "PyMuPDF":
        if not HAS_PYMUPDF:
            raise ImportError("PyMuPDF is required for PyMuPDF parser")
        
        if isinstance(pdf_path, BytesIO):
            pdf_stream = pdf_path
            doc = pymupdf.open(stream=pdf_stream, filetype="pdf")
        elif isinstance(pdf_path, str) and os.path.isfile(pdf_path) and pdf_path.lower().endswith(".pdf"):
            doc = pymupdf.open(pdf_path)
        else:
            raise ValueError(f"Invalid PDF path: {pdf_path}")
        
        page_list = []
        for page in doc:
            page_text = page.get_text() or ""
            token_length = count_tokens(page_text, model=model)
            page_list.append((page_text, token_length))
        return page_list
    
    else:
        raise ValueError(f"Unsupported PDF parser: {pdf_parser}")


def extract_text_from_pdf(pdf_path: Union[str, BytesIO]) -> str:
    """
    提取 PDF 所有页面的文本内容（合并为一个字符串）
    
    Args:
        pdf_path: PDF 文件路径
        
    Returns:
        合并后的文本内容
    """
    pdf_reader = PyPDF2.PdfReader(pdf_path)
    text = ""
    for page_num in range(len(pdf_reader.pages)):
        page = pdf_reader.pages[page_num]
        text += page.extract_text() or ""
    return text


def get_pdf_title(pdf_path: Union[str, BytesIO]) -> str:
    """
    获取 PDF 文档标题
    
    Args:
        pdf_path: PDF 文件路径
        
    Returns:
        文档标题
    """
    pdf_reader = PyPDF2.PdfReader(pdf_path)
    meta = pdf_reader.metadata
    title = meta.title if meta and meta.title else 'Untitled'
    return title


def get_pdf_name(pdf_path: Union[str, BytesIO]) -> str:
    """
    获取 PDF 文件名
    
    Args:
        pdf_path: PDF 文件路径或 BytesIO 对象
        
    Returns:
        文件名
    """
    if isinstance(pdf_path, str):
        return os.path.basename(pdf_path)
    elif isinstance(pdf_path, BytesIO):
        return get_pdf_title(pdf_path)
    return "Untitled"


def get_text_of_pages(
    pdf_path: Union[str, BytesIO],
    start_page: int,
    end_page: int,
    tag: bool = True
) -> str:
    """
    获取指定页面范围的文本内容
    
    Args:
        pdf_path: PDF 文件路径
        start_page: 起始页码（从1开始）
        end_page: 结束页码
        tag: 是否添加页码标签
        
    Returns:
        指定范围的文本内容
    """
    pdf_reader = PyPDF2.PdfReader(pdf_path)
    text = ""
    for page_num in range(start_page - 1, end_page):
        page = pdf_reader.pages[page_num]
        page_text = page.extract_text() or ""
        if tag:
            text += f"<start_index_{page_num + 1}>\n{page_text}\n<end_index_{page_num + 1}>\n"
        else:
            text += page_text
    return text


def get_text_of_pdf_pages(pdf_pages: List[Tuple[str, int]], start_page: int, end_page: int) -> str:
    """
    从预加载的页面列表中获取指定范围的文本
    
    Args:
        pdf_pages: 预加载的页面列表 [(text, token_count), ...]
        start_page: 起始页码（从1开始）
        end_page: 结束页码
        
    Returns:
        指定范围的文本内容
    """
    text = ""
    for page_num in range(start_page - 1, end_page):
        if page_num < len(pdf_pages):
            text += pdf_pages[page_num][0]
    return text


def get_text_of_pdf_pages_with_labels(
    pdf_pages: List[Tuple[str, int]],
    start_page: int,
    end_page: int
) -> str:
    """
    从预加载的页面列表中获取指定范围的文本（带页码标签）
    
    Args:
        pdf_pages: 预加载的页面列表 [(text, token_count), ...]
        start_page: 起始页码（从1开始）
        end_page: 结束页码
        
    Returns:
        带页码标签的文本内容
    """
    text = ""
    for page_num in range(start_page - 1, end_page):
        if page_num < len(pdf_pages):
            text += f"<physical_index_{page_num + 1}>\n{pdf_pages[page_num][0]}\n<physical_index_{page_num + 1}>\n"
    return text


def get_number_of_pages(pdf_path: Union[str, BytesIO]) -> int:
    """
    获取 PDF 页数
    
    Args:
        pdf_path: PDF 文件路径
        
    Returns:
        页数
    """
    pdf_reader = PyPDF2.PdfReader(pdf_path)
    return len(pdf_reader.pages)


def sanitize_filename(filename: str, replacement: str = '-') -> str:
    """
    清理文件名中的非法字符
    
    Args:
        filename: 原始文件名
        replacement: 替换字符
        
    Returns:
        清理后的文件名
    """
    return filename.replace('/', replacement)


# 便捷函数
if __name__ == "__main__":
    # 测试
    import sys
    
    if len(sys.argv) > 1:
        pdf_path = sys.argv[1]
        print(f"PDF: {pdf_path}")
        print(f"Title: {get_pdf_title(pdf_path)}")
        print(f"Pages: {get_number_of_pages(pdf_path)}")
        
        pages = get_page_tokens(pdf_path)
        print(f"Page tokens: {len(pages)} pages loaded")
        for i, (text, tokens) in enumerate(pages[:3]):
            print(f"  Page {i+1}: {tokens} tokens, {len(text)} chars")
    else:
        print("Usage: python pdf.py <pdf_path>")
