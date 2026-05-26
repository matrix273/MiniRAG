"""Word (.docx) 文件解析器。"""
from pathlib import Path

from docx import Document as DocxDocument
from docx.text.paragraph import Paragraph
from docx.table import Table as DocxTable

from . import ParseResult

# python-docx 标题样式名映射
_HEADING_STYLES = {
    "Heading 1": 1, "Heading 2": 2, "Heading 3": 3,
    "Heading 4": 4, "Heading 5": 5, "Heading 6": 6,
}


def _table_to_markdown(table) -> str:
    """将 python-docx Table 转为 Markdown 表格。"""
    rows = []
    for row in table.rows:
        cells = [cell.text.replace("\n", " ").strip() for cell in row.cells]
        rows.append(cells)
    if not rows:
        return ""
    header = "| " + " | ".join(rows[0]) + " |"
    separator = "| " + " | ".join("---" for _ in rows[0]) + " |"
    body = "\n".join("| " + " | ".join(r) + " |" for r in rows[1:])
    return f"{header}\n{separator}\n{body}" if body else f"{header}\n{separator}"


def _heading_level(paragraph) -> int | None:
    """返回段落的标题级别，非标题返回 None。"""
    style_name = paragraph.style.name if paragraph.style else ""
    if style_name in _HEADING_STYLES:
        return _HEADING_STYLES[style_name]
    # 也检查 outline_level（兼容自定义样式）
    try:
        ol = paragraph.style.paragraph_format.outline_level
        if ol is not None and 0 <= ol <= 5:
            return ol + 1
    except Exception:
        pass
    return None


def parse_docx(file_path: Path) -> ParseResult:
    """解析 .docx 文件，提取文本、表格和结构。"""
    doc = DocxDocument(str(file_path))
    content_parts: list[str] = []
    sections: list[dict] = []
    paragraph_count = 0
    table_count = 0

    for element in doc.element.body:
        tag = element.tag.split("}")[-1] if "}" in element.tag else element.tag

        if tag == "p":
            para = Paragraph(element, doc)
            text = para.text.strip()
            if not text:
                continue
            paragraph_count += 1

            level = _heading_level(para)
            if level is not None:
                content_parts.append(f"{'#' * level} {text}")
                sections.append({"level": level, "title": text, "text": ""})
            else:
                content_parts.append(text)

        elif tag == "tbl":
            tbl = DocxTable(element, doc)
            table_count += 1
            content_parts.append(_table_to_markdown(tbl))

    content = "\n\n".join(content_parts)

    # 用段落文本填充 section 的 text 字段
    _assign_section_texts(doc, sections)

    metadata = {
        "paragraph_count": paragraph_count,
        "table_count": table_count,
    }
    return ParseResult(content=content, metadata=metadata, sections=sections)


def _assign_section_texts(doc: DocxDocument, sections: list[dict]):
    """为每个 section 分配从该标题到下一个标题之间的段落文本。"""
    heading_map: dict[str, str] = {}
    for sec in sections:
        heading_map[sec["title"]] = ""

    current_title = None
    current_texts: list[str] = []

    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        level = _heading_level(para)
        if level is not None:
            # 保存前一个 section 的文本
            if current_title is not None:
                heading_map[current_title] = "\n".join(current_texts)
            current_title = text
            current_texts = []
        elif current_title is not None:
            current_texts.append(text)

    # 最后一个 section
    if current_title is not None:
        heading_map[current_title] = "\n".join(current_texts)

    for sec in sections:
        sec["text"] = heading_map.get(sec["title"], "")
