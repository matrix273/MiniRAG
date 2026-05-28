"""
统一索引器
提供 Markdown 和 PDF 文档的统一索引接口
"""

import os
import asyncio
from pathlib import Path
from typing import Dict, Any, Optional, Union
from io import BytesIO

from .utils import (
    ConfigLoader, format_structure, get_pdf_name, 
    JsonLogger, structure_to_list, remove_fields
)
from .parsers.markdown import (
    parse_markdown_file, build_markdown_tree, 
    extract_nodes_from_markdown, extract_node_text_content
)
from .parsers.pdf import get_page_tokens, get_pdf_name as get_pdf_name_from_parser
from ...utils.llm import (
    llm_completion, llm_acompletion, count_tokens,
    generate_summaries_for_structure, generate_doc_description,
    create_clean_structure_for_description
)


class MarkdownIndexer:
    """
    Markdown 文档索引器
    """
    
    def __init__(self, model: str = None):
        self.model = model
    
    async def index(
        self,
        file_path: str,
        if_thinning: bool = False,
        min_token_threshold: int = None,
        if_add_node_summary: str = 'no',
        summary_token_threshold: int = None,
        if_add_doc_description: str = 'no',
        if_add_node_text: str = 'no',
        if_add_node_id: str = 'yes'
    ) -> Dict[str, Any]:
        """
        索引 Markdown 文件
        
        Args:
            file_path: Markdown 文件路径
            if_thinning: 是否进行树瘦身
            min_token_threshold: 瘦身的 token 阈值
            if_add_node_summary: 是否添加节点摘要
            summary_token_threshold: 摘要 token 阈值
            if_add_doc_description: 是否添加文档描述
            if_add_node_text: 是否保留节点文本
            if_add_node_id: 是否添加节点 ID
            
        Returns:
            索引结果字典
        """
        # 解析 Markdown 文件
        nodes, line_count = parse_markdown_file(file_path)
        
        # 构建树结构
        tree_structure = build_markdown_tree(
            nodes,
            if_thinning=if_thinning,
            min_token_threshold=min_token_threshold,
            if_add_node_id=if_add_node_id,
            model=self.model
        )
        
        # 格式化
        if if_add_node_summary == 'yes':
            tree_structure = format_structure(
                tree_structure, 
                order=['title', 'node_id', 'line_num', 'summary', 'prefix_summary', 'text', 'nodes']
            )
            
            # 生成摘要
            print("Generating summaries...")
            tree_structure = await self._generate_summaries_md(
                tree_structure, 
                summary_token_threshold=summary_token_threshold
            )
            
            if if_add_node_text == 'no':
                tree_structure = format_structure(
                    tree_structure, 
                    order=['title', 'node_id', 'line_num', 'summary', 'prefix_summary', 'nodes']
                )
            
            if if_add_doc_description == 'yes':
                print("Generating document description...")
                clean_structure = create_clean_structure_for_description(tree_structure)
                doc_description = generate_doc_description(clean_structure, model=self.model)
                return {
                    'doc_name': os.path.splitext(os.path.basename(file_path))[0],
                    'doc_description': doc_description,
                    'line_count': line_count,
                    'structure': tree_structure,
                }
        else:
            if if_add_node_text == 'yes':
                tree_structure = format_structure(
                    tree_structure, 
                    order=['title', 'node_id', 'line_num', 'summary', 'prefix_summary', 'text', 'nodes']
                )
            else:
                tree_structure = format_structure(
                    tree_structure, 
                    order=['title', 'node_id', 'line_num', 'summary', 'prefix_summary', 'nodes']
                )
        
        return {
            'doc_name': os.path.splitext(os.path.basename(file_path))[0],
            'line_count': line_count,
            'structure': tree_structure,
        }
    
    async def _generate_summaries_md(
        self, 
        structure, 
        summary_token_threshold: int = 200
    ):
        """为 Markdown 结构生成摘要"""
        from .md_indexer import get_node_summary, generate_summaries_for_structure_md
        
        return await generate_summaries_for_structure_md(
            structure, 
            summary_token_threshold=summary_token_threshold, 
            model=self.model
        )


class PDFIndexer:
    """
    PDF 文档索引器
    """
    
    def __init__(self, model: str = None, config: Any = None):
        self.model = model
        self.config = config or ConfigLoader().load()
    
    def index(
        self,
        doc: Union[str, BytesIO],
        if_add_node_id: str = 'yes',
        if_add_node_summary: str = 'yes',
        if_add_doc_description: str = 'no',
        if_add_node_text: str = 'no'
    ) -> Dict[str, Any]:
        """
        索引 PDF 文件
        
        Args:
            doc: PDF 文件路径或 BytesIO 对象
            if_add_node_id: 是否添加节点 ID
            if_add_node_summary: 是否添加节点摘要
            if_add_doc_description: 是否添加文档描述
            if_add_node_text: 是否添加节点文本
            
        Returns:
            索引结果字典
        """
        from .pdf_indexer import page_index
        
        return page_index(
            doc=doc,
            model=self.model,
            toc_check_page_num=self.config.toc_check_page_num,
            max_page_num_each_node=self.config.max_page_num_each_node,
            max_token_num_each_node=self.config.max_token_num_each_node,
            if_add_node_id=if_add_node_id,
            if_add_node_summary=if_add_node_summary,
            if_add_doc_description=if_add_doc_description,
            if_add_node_text=if_add_node_text
        )


def create_indexer(file_path: str, model: str = None, **kwargs):
    """
    根据文件类型创建相应的索引器
    
    Args:
        file_path: 文件路径
        model: LLM 模型
        **kwargs: 额外参数
        
    Returns:
        (indexer, file_type): 索引器实例和文件类型
    """
    ext = os.path.splitext(file_path)[1].lower()
    
    if ext in ['.md', '.markdown']:
        return MarkdownIndexer(model=model), 'markdown'
    elif ext == '.pdf':
        return PDFIndexer(model=model), 'pdf'
    else:
        raise ValueError(f"Unsupported file format: {ext}")


# 便捷函数
async def index_document(
    file_path: str,
    model: str = None,
    **kwargs
) -> Dict[str, Any]:
    """
    索引文档的便捷函数
    
    Args:
        file_path: 文件路径
        model: LLM 模型
        **kwargs: 额外参数
        
    Returns:
        索引结果
    """
    indexer, file_type = create_indexer(file_path, model)
    
    if file_type == 'markdown':
        return await indexer.index(file_path, **kwargs)
    elif file_type == 'pdf':
        return indexer.index(file_path, **kwargs)
    else:
        raise ValueError(f"Unsupported file type: {file_type}")


# 向后兼容的函数
def md_to_tree(
    md_path: str,
    if_thinning: bool = False,
    min_token_threshold: int = None,
    if_add_node_summary: str = 'no',
    summary_token_threshold: int = None,
    model: str = None,
    if_add_doc_description: str = 'no',
    if_add_node_text: str = 'no',
    if_add_node_id: str = 'yes'
) -> Dict[str, Any]:
    """
    Markdown 转树结构（向后兼容）
    """
    indexer = MarkdownIndexer(model=model)
    return asyncio.run(indexer.index(
        md_path,
        if_thinning=if_thinning,
        min_token_threshold=min_token_threshold,
        if_add_node_summary=if_add_node_summary,
        summary_token_threshold=summary_token_threshold,
        if_add_doc_description=if_add_doc_description,
        if_add_node_text=if_add_node_text,
        if_add_node_id=if_add_node_id
    ))


def page_index(
    doc: Union[str, BytesIO],
    model: str = None,
    toc_check_page_num: int = None,
    max_page_num_each_node: int = None,
    max_token_num_each_node: int = None,
    if_add_node_id: str = None,
    if_add_node_summary: str = None,
    if_add_doc_description: str = None,
    if_add_node_text: str = None
) -> Dict[str, Any]:
    """
    PDF 页面索引（向后兼容）
    """
    from .pdf_indexer import page_index as pdf_page_index
    
    # 构建用户选项
    user_opt = {}
    if toc_check_page_num is not None:
        user_opt['toc_check_page_num'] = toc_check_page_num
    if max_page_num_each_node is not None:
        user_opt['max_page_num_each_node'] = max_page_num_each_node
    if max_token_num_each_node is not None:
        user_opt['max_token_num_each_node'] = max_token_num_each_node
    if if_add_node_id is not None:
        user_opt['if_add_node_id'] = if_add_node_id
    if if_add_node_summary is not None:
        user_opt['if_add_node_summary'] = if_add_node_summary
    if if_add_doc_description is not None:
        user_opt['if_add_doc_description'] = if_add_doc_description
    if if_add_node_text is not None:
        user_opt['if_add_node_text'] = if_add_node_text
    
    return pdf_page_index(
        doc=doc,
        model=model,
        **user_opt
    )
