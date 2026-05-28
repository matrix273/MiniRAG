"""Office 文件 → 树结构的入口函数，与 md_to_tree 接口对齐。"""
import os
from pathlib import Path

from .docx import parse_docx
from .xlsx import parse_xlsx
from .pptx import parse_pptx
from .tree_builder import build_tree_from_sections


def _generate_doc_description(structure, model=None):
    """生成文档描述（复用 pageindex.utils 的工具）。"""
    try:
        from ...utils.llm import create_clean_structure_for_description, generate_doc_description
        clean = create_clean_structure_for_description(structure)
        return generate_doc_description(clean, model=model)
    except Exception:
        if structure:
            return structure[0].get("title", "Document")
        return "Document"


def docx_to_tree(
    docx_path,
    if_add_node_summary="no",
    model=None,
    if_add_doc_description="no",
    if_add_node_id="yes",
    **kwargs,
):
    result = parse_docx(Path(docx_path))
    tree = build_tree_from_sections(result.sections)

    if if_add_doc_description == "yes":
        desc = _generate_doc_description(tree, model=model)
    else:
        desc = ""

    return {
        "doc_name": os.path.splitext(os.path.basename(docx_path))[0],
        "doc_description": desc,
        "structure": tree,
        "metadata": result.metadata,
    }


def xlsx_to_tree(
    xlsx_path,
    if_add_node_summary="no",
    model=None,
    if_add_doc_description="no",
    if_add_node_id="yes",
    **kwargs,
):
    result = parse_xlsx(Path(xlsx_path))
    tree = build_tree_from_sections(result.sections)

    if if_add_doc_description == "yes":
        desc = _generate_doc_description(tree, model=model)
    else:
        desc = ""

    return {
        "doc_name": os.path.splitext(os.path.basename(xlsx_path))[0],
        "doc_description": desc,
        "structure": tree,
        "metadata": result.metadata,
    }


def pptx_to_tree(
    pptx_path,
    if_add_node_summary="no",
    model=None,
    if_add_doc_description="no",
    if_add_node_id="yes",
    **kwargs,
):
    result = parse_pptx(Path(pptx_path))
    tree = build_tree_from_sections(result.sections)

    if if_add_doc_description == "yes":
        desc = _generate_doc_description(tree, model=model)
    else:
        desc = ""

    return {
        "doc_name": os.path.splitext(os.path.basename(pptx_path))[0],
        "doc_description": desc,
        "structure": tree,
        "metadata": result.metadata,
    }