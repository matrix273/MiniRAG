# Office 文件格式支持实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 PageIndex 系统新增 .docx/.xlsx/.pptx 三种 Office 文件的上传、解析、树结构构建、RAG 问答和前端预览功能。

**Architecture:** 为每种 Office 格式构建专用的 Python 文本解析器（`parsers/` 模块），输出统一的 `ParseResult` 数据类。通用树结构构建器将解析结果转换为与现有 PDF/MD 系统一致的树结构 JSON。前端新增 `OfficeViewer` 组件，根据 `doc_type` 路由到对应的浏览器端渲染器。

**Tech Stack:** python-docx, openpyxl, python-pptx, docx-preview (npm), xlsx/SheetJS (npm), Ant Design Table

**Spec:** `docs/superpowers/specs/2026-05-26-office-file-support-design.md`

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `backend/pageindex/parsers/__init__.py` | 解析器模块入口，导出 ParseResult 和 parse 工厂 |
| `backend/pageindex/parsers/docx_parser.py` | Word (.docx) 文本/表格/标题提取 |
| `backend/pageindex/parsers/xlsx_parser.py` | Excel (.xlsx) Sheet/表格提取 |
| `backend/pageindex/parsers/pptx_parser.py` | PowerPoint (.pptx) Slide/文本提取 |
| `backend/pageindex/parsers/tree_builder.py` | 将 sections 列表转换为树结构 JSON |
| `backend/pageindex/parsers/office_to_tree.py` | 入口函数：docx_to_tree/xlsx_to_tree/pptx_to_tree |
| `backend/tests/parsers/test_docx_parser.py` | docx 解析器单元测试 |
| `backend/tests/parsers/test_xlsx_parser.py` | xlsx 解析器单元测试 |
| `backend/tests/parsers/test_pptx_parser.py` | pptx 解析器单元测试 |
| `backend/tests/parsers/test_tree_builder.py` | 树构建器单元测试 |
| `backend/tests/parsers/__init__.py` | 测试包 |
| `frontend/src/components/OfficeViewer.tsx` | Office 文件浏览器预览组件 |

---

## Task 1: 安装 Python 依赖

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: 添加 Python 依赖**

在 `pyproject.toml` 的 `dependencies` 列表末尾添加：

```toml
"python-docx>=1.1.0",
"openpyxl>=3.1.5",
"python-pptx>=0.6.23",
```

- [ ] **Step 2: 安装依赖**

Run: `cd /Users/neo/PycharmProjects/PageIndex && uv sync`
Expected: 成功安装 python-docx, openpyxl, python-pptx

- [ ] **Step 3: Commit**

```bash
git add pyproject.toml uv.lock
git commit -m "deps: add python-docx, openpyxl, python-pptx for Office file parsing"
```

---

## Task 2: 创建解析器模块入口和 ParseResult

**Files:**
- Create: `backend/pageindex/parsers/__init__.py`
- Create: `backend/tests/parsers/__init__.py`
- Create: `backend/tests/parsers/test_docx_parser.py`

- [ ] **Step 1: 创建 parsers 包**

```python
# backend/pageindex/parsers/__init__.py
from dataclasses import dataclass, field

@dataclass
class ParseResult:
    """统一的解析结果数据类。"""
    content: str                              # 提取的文本内容（Markdown 格式）
    metadata: dict = field(default_factory=dict)  # 元信息
    sections: list[dict] = field(default_factory=list)  # 结构化章节列表
```

- [ ] **Step 2: 创建测试包**

```python
# backend/tests/parsers/__init__.py
```

- [ ] **Step 3: 创建 docx 解析器测试**

```python
# backend/tests/parsers/test_docx_parser.py
import tempfile
from pathlib import Path
from docx import Document

from pageindex.parsers import ParseResult
from pageindex.parsers.docx_parser import parse_docx


def _make_docx(paragraphs: list[tuple[str, str]]) -> Path:
    """创建测试用 docx 文件。paragraphs: [(style, text), ...]"""
    doc = Document()
    for style, text in paragraphs:
        doc.add_paragraph(text, style=style)
    tmp = tempfile.NamedTemporaryFile(suffix=".docx", delete=False)
    doc.save(tmp.name)
    return Path(tmp.name)


def test_parse_docx_headings():
    path = _make_docx([
        ("Heading 1", "Chapter 1"),
        ("Normal", "Some body text"),
        ("Heading 2", "Section 1.1"),
        ("Normal", "More text"),
    ])
    result = parse_docx(path)

    assert isinstance(result, ParseResult)
    assert len(result.sections) == 2
    assert result.sections[0]["title"] == "Chapter 1"
    assert result.sections[0]["level"] == 1
    assert result.sections[1]["title"] == "Section 1.1"
    assert result.sections[1]["level"] == 2
    assert "# Chapter 1" in result.content
    assert "## Section 1.1" in result.content
    assert "Some body text" in result.content


def test_parse_docx_tables():
    doc = Document()
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Name"
    table.cell(0, 1).text = "Value"
    table.cell(1, 0).text = "A"
    table.cell(1, 1).text = "1"
    tmp = tempfile.NamedTemporaryFile(suffix=".docx", delete=False)
    doc.save(tmp.name)
    result = parse_docx(Path(tmp.name))

    assert "| Name |" in result.content
    assert "| A |" in result.content


def test_parse_docx_metadata():
    path = _make_docx([("Normal", "Hello")])
    result = parse_docx(path)
    assert "paragraph_count" in result.metadata
    assert result.metadata["paragraph_count"] == 1
```

- [ ] **Step 4: Run 测试确认失败**

Run: `cd /Users/neo/PycharmProjects/PageIndex/backend && uv run pytest tests/parsers/test_docx_parser.py -v`
Expected: FAIL (ImportError — docx_parser 不存在)

- [ ] **Step 5: 实现 docx_parser.py**

```python
# backend/pageindex/parsers/docx_parser.py
"""Word (.docx) 文件解析器。"""
from pathlib import Path

from docx import Document as DocxDocument

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
            from docx.text.paragraph import Paragraph
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
            from docx.table import Table as DocxTable
            tbl = DocxTable(element, doc)
            table_count += 1
            content_parts.append(_table_to_markdown(tbl))

    content = "\n\n".join(content_parts)

    # 用最后一个段落的文本填充 section 的 text 字段
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
```

- [ ] **Step 6: Run 测试确认通过**

Run: `cd /Users/neo/PycharmProjects/PageIndex/backend && uv run pytest tests/parsers/test_docx_parser.py -v`
Expected: 3 passed

- [ ] **Step 7: Commit**

```bash
git add backend/pageindex/parsers/ backend/tests/parsers/
git commit -m "feat: add docx parser with ParseResult and unit tests"
```

---

## Task 3: xlsx 解析器

**Files:**
- Create: `backend/pageindex/parsers/xlsx_parser.py`
- Create: `backend/tests/parsers/test_xlsx_parser.py`

- [ ] **Step 1: 创建测试**

```python
# backend/tests/parsers/test_xlsx_parser.py
import tempfile
from pathlib import Path
from openpyxl import Workbook

from pageindex.parsers import ParseResult
from pageindex.parsers.xlsx_parser import parse_xlsx


def _make_xlsx(sheets: dict[str, list[list]]) -> Path:
    """创建测试用 xlsx。sheets: {sheet_name: [[row1], [row2], ...]}"""
    wb = Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(title=name)
        for row in rows:
            ws.append(row)
    tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    wb.save(tmp.name)
    return Path(tmp.name)


def test_parse_xlsx_single_sheet():
    path = _make_xlsx({"Data": [["Name", "Score"], ["Alice", 90], ["Bob", 85]]})
    result = parse_xlsx(path)

    assert isinstance(result, ParseResult)
    assert len(result.sections) == 1
    assert result.sections[0]["title"] == "Data"
    assert result.sections[0]["level"] == 2
    assert "## Data" in result.content
    assert "| Name |" in result.content
    assert "| Alice |" in result.content


def test_parse_xlsx_multiple_sheets():
    path = _make_xlsx({
        "Sheet1": [["A", "B"], [1, 2]],
        "Sheet2": [["X"], ["Y"]],
    })
    result = parse_xlsx(path)
    assert len(result.sections) == 2
    assert result.metadata["sheet_count"] == 2


def test_parse_xlsx_skips_empty_sheet():
    wb = Workbook()
    wb.active.title = "Empty"
    # 不添加任何数据
    tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    wb.save(tmp.name)
    result = parse_xlsx(Path(tmp.name))
    assert len(result.sections) == 0
```

- [ ] **Step 2: Run 测试确认失败**

Run: `cd /Users/neo/PycharmProjects/PageIndex/backend && uv run pytest tests/parsers/test_xlsx_parser.py -v`
Expected: FAIL (ImportError)

- [ ] **Step 3: 实现 xlsx_parser.py**

```python
# backend/pageindex/parsers/xlsx_parser.py
"""Excel (.xlsx) 文件解析器。"""
from pathlib import Path

from openpyxl import load_workbook

from . import ParseResult


def _table_to_markdown(headers: list[str], rows: list[list[str]]) -> str:
    """将表头和数据行转为 Markdown 表格。"""
    header = "| " + " | ".join(headers) + " |"
    separator = "| " + " | ".join("---" for _ in headers) + " |"
    body_lines = ["| " + " | ".join(row) + " |" for row in rows]
    return "\n".join([header, separator] + body_lines)


def parse_xlsx(file_path: Path) -> ParseResult:
    """解析 .xlsx 文件，每个 Sheet 作为一个 section。"""
    wb = load_workbook(str(file_path), read_only=True, data_only=True)
    content_parts: list[str] = []
    sections: list[dict] = []
    sheet_count = 0

    for ws_name in wb.sheetnames:
        ws = wb[ws_name]
        # 跳过隐藏 Sheet
        if ws.sheet_state != "visible":
            continue

        all_rows: list[list] = []
        for row in ws.iter_rows(values_only=True):
            # 跳过完全为空的行
            if any(cell is not None for cell in row):
                all_rows.append(list(row))

        # 跳过空 Sheet
        if not all_rows:
            continue

        sheet_count += 1
        headers = [str(c) if c is not None else "" for c in all_rows[0]]
        data_rows = [
            [str(c) if c is not None else "" for c in row]
            for row in all_rows[1:]
        ]

        content_parts.append(f"## {ws_name}")
        content_parts.append(_table_to_markdown(headers, data_rows))

        sections.append({
            "level": 2,
            "title": ws_name,
            "text": "\n".join(str(c) for row in all_rows for c in row if c is not None),
        })

    wb.close()
    content = "\n\n".join(content_parts)
    metadata = {"sheet_count": sheet_count, "sheet_names": list(wb.sheetnames)}

    return ParseResult(content=content, metadata=metadata, sections=sections)
```

- [ ] **Step 4: Run 测试确认通过**

Run: `cd /Users/neo/PycharmProjects/PageIndex/backend && uv run pytest tests/parsers/test_xlsx_parser.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add backend/pageindex/parsers/xlsx_parser.py backend/tests/parsers/test_xlsx_parser.py
git commit -m "feat: add xlsx parser with unit tests"
```

---

## Task 4: pptx 解析器

**Files:**
- Create: `backend/pageindex/parsers/pptx_parser.py`
- Create: `backend/tests/parsers/test_pptx_parser.py`

- [ ] **Step 1: 创建测试**

```python
# backend/tests/parsers/test_pptx_parser.py
import tempfile
from pathlib import Path
from pptx import Presentation
from pptx.util import Inches

from pageindex.parsers import ParseResult
from pageindex.parsers.pptx_parser import parse_pptx


def _make_pptx(slides_content: list[str]) -> Path:
    """创建测试用 pptx。"""
    prs = Presentation()
    for text in slides_content:
        slide = prs.slides.add_slide(prs.slide_layouts[1])  # Title and Content
        slide.shapes.title.text = text
        slide.placeholders[1].text = f"Content for {text}"
    tmp = tempfile.NamedTemporaryFile(suffix=".pptx", delete=False)
    prs.save(tmp.name)
    return Path(tmp.name)


def test_parse_pptx_basic():
    path = _make_pptx(["Slide One", "Slide Two"])
    result = parse_pptx(path)

    assert isinstance(result, ParseResult)
    assert len(result.sections) == 2
    assert result.sections[0]["title"] == "Slide 1"
    assert result.sections[0]["level"] == 2
    assert "## Slide 1" in result.content
    assert "Slide One" in result.content


def test_parse_pptx_metadata():
    path = _make_pptx(["A", "B", "C"])
    result = parse_pptx(path)
    assert result.metadata["slide_count"] == 3


def test_parse_pptx_with_table():
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = "Table Slide"
    # 添加表格
    rows, cols = 2, 2
    left, top, width, height = Inches(1), Inches(1.5), Inches(5), Inches(2)
    table = slide.shapes.add_table(rows, cols, left, top, width, height).table
    table.cell(0, 0).text = "H1"
    table.cell(0, 1).text = "H2"
    table.cell(1, 0).text = "V1"
    table.cell(1, 1).text = "V2"
    tmp = tempfile.NamedTemporaryFile(suffix=".pptx", delete=False)
    prs.save(tmp.name)

    result = parse_pptx(Path(tmp.name))
    assert "| H1 |" in result.content
    assert "| V1 |" in result.content
```

- [ ] **Step 2: Run 测试确认失败**

Run: `cd /Users/neo/PycharmProjects/PageIndex/backend && uv run pytest tests/parsers/test_pptx_parser.py -v`
Expected: FAIL (ImportError)

- [ ] **Step 3: 实现 pptx_parser.py**

```python
# backend/pageindex/parsers/pptx_parser.py
"""PowerPoint (.pptx) 文件解析器。"""
from pathlib import Path

from pptx import Presentation

from . import ParseResult


def _table_to_markdown(table) -> str:
    """将 pptx Table 转为 Markdown 表格。"""
    rows_data = []
    for row in table.rows:
        cells = [cell.text.replace("\n", " ").strip() for cell in row.cells]
        rows_data.append(cells)
    if not rows_data:
        return ""
    headers = rows_data[0]
    header_line = "| " + " | ".join(headers) + " |"
    separator = "| " + " | ".join("---" for _ in headers) + " |"
    body = "\n".join("| " + " | ".join(r) + " |" for r in rows_data[1:])
    return f"{header_line}\n{separator}\n{body}" if body else f"{header_line}\n{separator}"


def parse_pptx(file_path: Path) -> ParseResult:
    """解析 .pptx 文件，每个 Slide 作为一个 section。"""
    prs = Presentation(str(file_path))
    content_parts: list[str] = []
    sections: list[dict] = []
    total_chars = 0

    for slide_idx, slide in enumerate(prs.slides, 1):
        slide_texts: list[str] = []

        # 提取所有形状中的文本
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    text = para.text.strip()
                    if text:
                        slide_texts.append(text)
                        total_chars += len(text)

            if shape.has_table:
                slide_texts.append(_table_to_markdown(shape.table))

        # Speaker notes
        notes_text = ""
        if slide.has_notes_slide:
            notes_frame = slide.notes_slide.notes_text_frame
            notes_text = notes_frame.text.strip()
            if notes_text:
                slide_texts.append(f"**Notes:** {notes_text}")

        if not slide_texts:
            continue

        content_parts.append(f"## Slide {slide_idx}")
        content_parts.extend(slide_texts)

        sections.append({
            "level": 2,
            "title": f"Slide {slide_idx}",
            "text": "\n".join(slide_texts),
        })

    content = "\n\n".join(content_parts)
    metadata = {
        "slide_count": len(prs.slides),
        "total_chars": total_chars,
    }
    return ParseResult(content=content, metadata=metadata, sections=sections)
```

- [ ] **Step 4: Run 测试确认通过**

Run: `cd /Users/neo/PycharmProjects/PageIndex/backend && uv run pytest tests/parsers/test_pptx_parser.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add backend/pageindex/parsers/pptx_parser.py backend/tests/parsers/test_pptx_parser.py
git commit -m "feat: add pptx parser with unit tests"
```

---

## Task 5: 通用树结构构建器

**Files:**
- Create: `backend/pageindex/parsers/tree_builder.py`
- Create: `backend/tests/parsers/test_tree_builder.py`

- [ ] **Step 1: 创建测试**

```python
# backend/tests/parsers/test_tree_builder.py
from pageindex.parsers.tree_builder import build_tree_from_sections


def test_flat_sections():
    sections = [
        {"level": 1, "title": "Intro", "text": "Hello"},
        {"level": 1, "title": "Body", "text": "World"},
    ]
    tree = build_tree_from_sections(sections)
    assert len(tree) == 2
    assert tree[0]["title"] == "Intro"
    assert tree[0]["node_id"] == "0001"
    assert tree[1]["node_id"] == "0002"


def test_nested_sections():
    sections = [
        {"level": 1, "title": "Chapter 1", "text": ""},
        {"level": 2, "title": "Section 1.1", "text": "Content"},
        {"level": 2, "title": "Section 1.2", "text": "More"},
        {"level": 1, "title": "Chapter 2", "text": ""},
    ]
    tree = build_tree_from_sections(sections)
    assert len(tree) == 2  # Two root nodes
    assert tree[0]["title"] == "Chapter 1"
    assert len(tree[0]["nodes"]) == 2
    assert tree[0]["nodes"][0]["title"] == "Section 1.1"
    assert tree[1]["title"] == "Chapter 2"
    assert len(tree[1]["nodes"]) == 0


def test_node_id_assigned():
    sections = [
        {"level": 1, "title": "A", "text": ""},
        {"level": 2, "title": "A.1", "text": ""},
    ]
    tree = build_tree_from_sections(sections)
    assert tree[0]["node_id"] == "0001"
    assert tree[0]["nodes"][0]["node_id"] == "0002"


def test_empty_sections():
    assert build_tree_from_sections([]) == []


def test_deeply_nested():
    sections = [
        {"level": 1, "title": "L1", "text": ""},
        {"level": 2, "title": "L2", "text": ""},
        {"level": 3, "title": "L3", "text": "Deep"},
    ]
    tree = build_tree_from_sections(sections)
    assert len(tree) == 1
    assert len(tree[0]["nodes"]) == 1
    assert len(tree[0]["nodes"][0]["nodes"]) == 1
    assert tree[0]["nodes"][0]["nodes"][0]["title"] == "L3"
```

- [ ] **Step 2: Run 测试确认失败**

Run: `cd /Users/neo/PycharmProjects/PageIndex/backend && uv run pytest tests/parsers/test_tree_builder.py -v`
Expected: FAIL (ImportError)

- [ ] **Step 3: 实现 tree_builder.py**

```python
# backend/pageindex/parsers/tree_builder.py
"""通用树结构构建器 — 将 sections 列表转为嵌套树结构 JSON。"""
from . import ParseResult


def build_tree_from_sections(sections: list[dict]) -> list[dict]:
    """
    将平铺的 sections 列表转为嵌套树结构。

    sections: [{level, title, text, ...}]
    输出: [{title, node_id, text, nodes: [...]}]

    与 page_index_md.py 中 build_tree_from_nodes() 的输出格式一致。
    """
    if not sections:
        return []

    stack: list[tuple[dict, int]] = []  # (node, level)
    root_nodes: list[dict] = []
    node_counter = 1

    for section in sections:
        level = section["level"]
        node = {
            "title": section["title"],
            "node_id": str(node_counter).zfill(4),
            "text": section.get("text", ""),
            "nodes": [],
        }
        node_counter += 1

        # 回溯栈，找到当前节点的父节点
        while stack and stack[-1][1] >= level:
            stack.pop()

        if not stack:
            root_nodes.append(node)
        else:
            parent_node, _ = stack[-1]
            parent_node["nodes"].append(node)

        stack.append((node, level))

    return root_nodes
```

- [ ] **Step 4: Run 测试确认通过**

Run: `cd /Users/neo/PycharmProjects/PageIndex/backend && uv run pytest tests/parsers/test_tree_builder.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add backend/pageindex/parsers/tree_builder.py backend/tests/parsers/test_tree_builder.py
git commit -m "feat: add tree builder for office sections with unit tests"
```

---

## Task 6: office_to_tree 入口函数

**Files:**
- Create: `backend/pageindex/parsers/office_to_tree.py`

- [ ] **Step 1: 实现 office_to_tree.py**

```python
# backend/pageindex/parsers/office_to_tree.py
"""Office 文件 → 树结构的入口函数，与 md_to_tree 接口对齐。"""
import os
from pathlib import Path

from .docx_parser import parse_docx
from .xlsx_parser import parse_xlsx
from .pptx_parser import parse_pptx
from .tree_builder import build_tree_from_sections


def _generate_doc_description(structure, model=None):
    """生成文档描述（复用 pageindex.utils 的工具）。"""
    try:
        from ..utils import create_clean_structure_for_description, generate_doc_description
        clean = create_clean_structure_for_description(structure)
        return generate_doc_description(clean, model=model)
    except Exception:
        # 降级：用第一个 section 的 title 作为描述
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
```

- [ ] **Step 2: Commit**

```bash
git add backend/pageindex/parsers/office_to_tree.py
git commit -m "feat: add office_to_tree entry functions for docx/xlsx/pptx"
```

---

## Task 7: 更新 pageindex 模块导出

**Files:**
- Modify: `backend/pageindex/__init__.py`

- [ ] **Step 1: 修改 __init__.py**

```python
# backend/pageindex/__init__.py
from .page_index import *
from .page_index_md import md_to_tree
from .parsers.office_to_tree import docx_to_tree, xlsx_to_tree, pptx_to_tree
from .retrieve import get_document, get_document_structure, get_page_content
from .client import PageIndexClient
```

- [ ] **Step 2: 验证导入正常**

Run: `cd /Users/neo/PycharmProjects/PageIndex/backend && uv run python -c "from pageindex import docx_to_tree, xlsx_to_tree, pptx_to_tree; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/pageindex/__init__.py
git commit -m "feat: export docx_to_tree, xlsx_to_tree, pptx_to_tree from pageindex"
```

---

## Task 8: 修改 client.py 路由

**Files:**
- Modify: `backend/pageindex/client.py`

- [ ] **Step 1: 在 index() 方法中添加 Office 文件路由**

在 `client.py` 的 `index()` 方法中，将 `else: raise ValueError(...)` 替换为：

```python
        is_docx = ext == '.docx'
        is_xlsx = ext == '.xlsx'
        is_pptx = ext == '.pptx'

        if mode == "docx" or (mode == "auto" and is_docx):
            print(f"Indexing DOCX: {file_path}")
            from .parsers.office_to_tree import docx_to_tree
            result = docx_to_tree(
                file_path,
                model=self.model,
                if_add_node_summary='yes',
                if_add_node_text='yes',
                if_add_node_id='yes',
                if_add_doc_description='yes',
            )
            self.documents[doc_id] = {
                'id': doc_id,
                'type': 'docx',
                'path': file_path,
                'doc_name': result.get('doc_name', ''),
                'doc_description': result.get('doc_description', ''),
                'page_count': result.get('metadata', {}).get('paragraph_count', 0),
                'structure': result['structure'],
            }

        elif mode == "xlsx" or (mode == "auto" and is_xlsx):
            print(f"Indexing XLSX: {file_path}")
            from .parsers.office_to_tree import xlsx_to_tree
            result = xlsx_to_tree(
                file_path,
                model=self.model,
                if_add_node_summary='yes',
                if_add_node_text='yes',
                if_add_node_id='yes',
                if_add_doc_description='yes',
            )
            self.documents[doc_id] = {
                'id': doc_id,
                'type': 'xlsx',
                'path': file_path,
                'doc_name': result.get('doc_name', ''),
                'doc_description': result.get('doc_description', ''),
                'page_count': result.get('metadata', {}).get('sheet_count', 0),
                'structure': result['structure'],
            }

        elif mode == "pptx" or (mode == "auto" and is_pptx):
            print(f"Indexing PPTX: {file_path}")
            from .parsers.office_to_tree import pptx_to_tree
            result = pptx_to_tree(
                file_path,
                model=self.model,
                if_add_node_summary='yes',
                if_add_node_text='yes',
                if_add_node_id='yes',
                if_add_doc_description='yes',
            )
            self.documents[doc_id] = {
                'id': doc_id,
                'type': 'pptx',
                'path': file_path,
                'doc_name': result.get('doc_name', ''),
                'doc_description': result.get('doc_description', ''),
                'page_count': result.get('metadata', {}).get('slide_count', 0),
                'structure': result['structure'],
            }

        else:
            raise ValueError(f"Unsupported file format for: {file_path}")
```

完整替换区域：从 `elif mode == "md"` 代码块结束后到 `else: raise ValueError(...)` 之间，将原来的 `else` 分支替换为上述代码。

- [ ] **Step 2: 同步修改 _make_meta_entry 支持新类型**

在 `_make_meta_entry` 静态方法中，添加 Office 类型的 meta：

```python
        elif doc.get('type') in ('docx', 'xlsx', 'pptx'):
            entry['page_count'] = doc.get('page_count')
```

- [ ] **Step 3: Commit**

```bash
git add backend/pageindex/client.py
git commit -m "feat: add docx/xlsx/pptx routing in PageIndexClient.index()"
```

---

## Task 9: 修改上传端点

**Files:**
- Modify: `backend/app/main.py` (upload_documents 函数)

- [ ] **Step 1: 修改 allowed_extensions 和 doc_type 映射**

在 `upload_documents` 函数中：

```python
        # 替换原来的 allowed_extensions
        allowed_extensions = {'.pdf', '.md', '.markdown', '.docx', '.xlsx', '.pptx'}

        # ... (在 file_ext 检查之后) ...

        # 替换原来的 doc_type 推断
        doc_type_map = {
            '.pdf': 'pdf', '.md': 'md', '.markdown': 'md',
            '.docx': 'docx', '.xlsx': 'xlsx', '.pptx': 'pptx',
        }
        doc_type = doc_type_map[file_ext]
```

具体修改位置：原代码第 110 行 `allowed_extensions = {'.pdf', '.md', '.markdown'}` 替换为上面的值。原代码第 134 行 `doc_type = "pdf" if file_ext == ".pdf" else "md"` 替换为 `doc_type = doc_type_map[file_ext]`。

- [ ] **Step 2: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: extend upload endpoint to support docx/xlsx/pptx"
```

---

## Task 10: 修改 get_document_file content_type

**Files:**
- Modify: `backend/app/main.py` (get_document_file 函数)

- [ ] **Step 1: 扩展 content_type 映射**

在 `get_document_file` 函数中，替换原来的 content_type 判断：

```python
    content_type_map = {
        'pdf': 'application/pdf',
        'md': 'text/markdown',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }
    content_type = content_type_map.get(doc.doc_type, 'application/octet-stream')
```

原代码第 304 行 `content_type = "application/pdf" if doc.doc_type == "pdf" else "text/markdown"` 替换为上述代码。

- [ ] **Step 2: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: add correct content-type for Office file downloads"
```

---

## Task 11: 修改 _ensure_doc_in_client

**Files:**
- Modify: `backend/app/services/document_service.py`

- [ ] **Step 1: 在 _ensure_doc_in_client 中添加 Office 类型处理**

在 `_ensure_doc_in_client()` 方法中，替换 `else: # markdown` 分支：

```python
            elif document.doc_type in ('docx', 'xlsx', 'pptx'):
                # Office 文件复用 pages 字段存储按章节内容
                doc_info['page_count'] = document.page_count or 0
                doc_info['pages'] = document.pages or []
```

原代码第 213-215 行的 `else:  # markdown` 分支替换为上述代码。

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/document_service.py
git commit -m "feat: handle office doc types in _ensure_doc_in_client"
```

---

## Task 12: 安装前端依赖

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: 安装 npm 依赖**

Run: `cd /Users/neo/PycharmProjects/PageIndex/frontend && npm install docx-preview xlsx`
Expected: 两个包安装成功

- [ ] **Step 2: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "deps: add docx-preview and xlsx for Office file preview"
```

---

## Task 13: 创建 OfficeViewer 组件

**Files:**
- Create: `frontend/src/components/OfficeViewer.tsx`

- [ ] **Step 1: 实现 OfficeViewer 组件**

```tsx
// frontend/src/components/OfficeViewer.tsx
import { useEffect, useRef, useState } from 'react'
import { Spin, Typography, Tabs, message } from 'antd'
import type { TableProps } from 'antd'

const { Text } = Typography

interface OfficeViewerProps {
  fileUrl: string
  fileType: 'docx' | 'xlsx' | 'pptx'
}

function DocxViewer({ fileUrl }: { fileUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false

    const render = async () => {
      try {
        const { renderAsync } = await import('docx-preview')
        const response = await fetch(fileUrl)
        const blob = await response.blob()
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = ''
          await renderAsync(blob, containerRef.current, undefined, {
            debug: false,
            inWrapper: true,
          })
        }
      } catch (err) {
        if (!cancelled) message.error('Failed to render DOCX')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    render()
    return () => { cancelled = true }
  }, [fileUrl])

  return (
    <Spin spinning={loading}>
      <div ref={containerRef} style={{ minHeight: 200 }} />
    </Spin>
  )
}

interface SheetData {
  name: string
  headers: string[]
  rows: string[][]
}

function XlsxViewer({ fileUrl }: { fileUrl: string }) {
  const [sheets, setSheets] = useState<SheetData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const XLSX = await import('xlsx')
        const response = await fetch(fileUrl)
        const buffer = await response.arrayBuffer()
        const workbook = XLSX.read(buffer, { type: 'array' })
        const parsed: SheetData[] = workbook.SheetNames.map((name) => {
          const sheet = workbook.Sheets[name]
          const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })
          const headers = (data[0] || []).map(String)
          const rows = data.slice(1).map((row) => row.map(String))
          return { name, headers, rows }
        })
        setSheets(parsed)
      } catch {
        message.error('Failed to render XLSX')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [fileUrl])

  if (loading) return <Spin tip="Loading..." />
  if (sheets.length === 0) return <Text type="secondary">No data</Text>

  const tabItems = sheets.map((sheet) => ({
    key: sheet.name,
    label: sheet.name,
    children: (
      <div style={{ overflow: 'auto', maxHeight: 500 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {sheet.headers.map((h, i) => (
                <th key={i} style={{ border: '1px solid #d9d9d9', padding: '6px 8px', background: '#fafafa', fontWeight: 600, textAlign: 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{ border: '1px solid #d9d9d9', padding: '6px 8px' }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  }))

  return sheets.length === 1
    ? tabItems[0].children
    : <Tabs items={tabItems} size="small" />
}

function PptxViewer({ fileUrl }: { fileUrl: string }) {
  return (
    <div style={{ textAlign: 'center', padding: 40 }}>
      <Text type="secondary">
        PowerPoint preview is not available in browser.{' '}
        <a href={fileUrl} target="_blank" rel="noopener noreferrer">
          Download file
        </a>
      </Text>
    </div>
  )
}

export default function OfficeViewer({ fileUrl, fileType }: OfficeViewerProps) {
  switch (fileType) {
    case 'docx':
      return <DocxViewer fileUrl={fileUrl} />
    case 'xlsx':
      return <XlsxViewer fileUrl={fileUrl} />
    case 'pptx':
      return <PptxViewer fileUrl={fileUrl} />
    default:
      return <Text type="secondary">Unsupported file type</Text>
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/OfficeViewer.tsx
git commit -m "feat: add OfficeViewer component for docx/xlsx preview"
```

---

## Task 14: 修改 DocumentList 图标和上传组件

**Files:**
- Modify: `frontend/src/pages/DocumentList.tsx`

- [ ] **Step 1: 更新 imports**

添加新图标 import：

```tsx
import {
  UploadOutlined,
  EyeOutlined,
  DeleteOutlined,
  FilePdfOutlined,
  FileMarkdownOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
  FolderOutlined,
  FolderAddOutlined,
  EditOutlined,
  FolderOpenOutlined,
  SwapOutlined,
  InboxOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FilePptOutlined,
} from '@ant-design/icons'
```

- [ ] **Step 2: 替换 getFileIcon 函数**

```tsx
  const getFileIcon = (docType: string) => {
    switch (docType) {
      case 'pdf': return <FilePdfOutlined style={{ color: '#ff4d4f' }} />
      case 'docx': return <FileWordOutlined style={{ color: '#1677ff' }} />
      case 'xlsx': return <FileExcelOutlined style={{ color: '#52c41a' }} />
      case 'pptx': return <FilePptOutlined style={{ color: '#fa8c16' }} />
      default: return <FileMarkdownOutlined style={{ color: '#1677ff' }} />
    }
  }
```

- [ ] **Step 3: 替换 treeData 中硬编码的图标**

在 `buildNodes` 内部的 `icon:` 属性，替换为 `icon: getFileIcon(d.doc_type)`。同样替换 `rootDocs` 映射中的图标。两处位于 `const treeData = useMemo(...)` 中。

- [ ] **Step 4: 更新 Upload.Dragger accept 属性**

```tsx
<Upload.Dragger
  accept=".pdf,.md,.markdown,.docx,.xlsx,.pptx"
  ...
>
  <p className="ant-upload-hint">Support for PDF, Markdown, Word, Excel, PowerPoint files</p>
</Upload.Dragger>
```

- [ ] **Step 5: 更新 pendingFiles 图标**

在 `renderItem` 中的 avatar 替换为：

```tsx
avatar={getFileIcon(
  file.name.endsWith('.pdf') ? 'pdf' :
  file.name.endsWith('.docx') ? 'docx' :
  file.name.endsWith('.xlsx') ? 'xlsx' :
  file.name.endsWith('.pptx') ? 'pptx' : 'md'
)}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/DocumentList.tsx
git commit -m "feat: add Office file icons and extend upload accept list"
```

---

## Task 15: 修改 DocumentDetail 添加预览 tab

**Files:**
- Modify: `frontend/src/pages/DocumentDetail.tsx`

- [ ] **Step 1: 添加 OfficeViewer import**

```tsx
import OfficeViewer from '@/components/OfficeViewer'
```

- [ ] **Step 2: 在 tabItems 中添加预览 tab**

在 `tabItems` 数组末尾，structure tab 之后，添加条件渲染的预览 tab：

```tsx
  // 在 tabItems 数组末尾追加：
  ...(document?.doc_type && ['docx', 'xlsx', 'pptx'].includes(document.doc_type)
    ? [{
        key: 'preview',
        label: 'Preview',
        children: (
          <OfficeViewer
            fileUrl={documentApi.getFileUrl(document.id)}
            fileType={document.doc_type as 'docx' | 'xlsx' | 'pptx'}
          />
        ),
      }]
    : []),
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/DocumentDetail.tsx
git commit -m "feat: add Office preview tab to document detail page"
```

---

## Task 16: 数据库迁移

**Files:**
- Create: `backend/alembic/versions/xxxx_add_office_doc_types.py`

- [ ] **Step 1: 生成迁移**

Run: `cd /Users/neo/PycharmProjects/PageIndex/backend && uv run alembic revision --autogenerate -m "add support for office doc types"`
Expected: 创建新的迁移文件

- [ ] **Step 2: 检查迁移内容**

迁移应仅涉及 doc_type 字段的长度扩展（String(10) → String(10) 已足够容纳 docx/xlsx/pptx）。由于字段长度已足够，迁移可能是空的，这是正常的。

- [ ] **Step 3: 应用迁移**

Run: `cd /Users/neo/PycharmProjects/PageIndex/backend && uv run alembic upgrade head`

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/
git commit -m "chore: add migration for office doc type support"
```

---

## Task 17: 端到端验证

- [ ] **Step 1: 运行所有后端测试**

Run: `cd /Users/neo/PycharmProjects/PageIndex/backend && uv run pytest tests/ -v`
Expected: 所有测试通过

- [ ] **Step 2: 启动后端服务**

Run: `cd /Users/neo/PycharmProjects/PageIndex/backend && uv run uvicorn app.main:app --reload`
Expected: 服务正常启动

- [ ] **Step 3: 启动前端**

Run: `cd /Users/neo/PycharmProjects/PageIndex/frontend && npm run dev`
Expected: 前端正常启动

- [ ] **Step 4: 手动测试上传**

1. 打开浏览器访问 http://localhost:5173
2. 上传一个 .docx 文件 → 确认解析成功，树结构正确显示章节标题
3. 上传一个 .xlsx 文件 → 确认多个 Sheet 在树结构中显示
4. 上传一个 .pptx 文件 → 确认 Slide 列表在树结构中显示
5. 进入文档详情 → 确认 Office 文件显示 Preview tab
6. 在 Preview tab 中确认内容正确渲染
7. 创建聊天会话 → 问答流程正常

- [ ] **Step 5: 确认旧功能不受影响**

1. 上传一个 PDF → 确认原有流程正常
2. 上传一个 .md 文件 → 确认原有流程正常
3. 编辑 Markdown 文档 → 确认编辑功能正常

---

## 关键文件清单

| 文件 | 变更类型 |
|------|----------|
| `pyproject.toml` | 修改 |
| `backend/pageindex/parsers/__init__.py` | 新建 |
| `backend/pageindex/parsers/docx_parser.py` | 新建 |
| `backend/pageindex/parsers/xlsx_parser.py` | 新建 |
| `backend/pageindex/parsers/pptx_parser.py` | 新建 |
| `backend/pageindex/parsers/tree_builder.py` | 新建 |
| `backend/pageindex/parsers/office_to_tree.py` | 新建 |
| `backend/pageindex/__init__.py` | 修改 |
| `backend/pageindex/client.py` | 修改 |
| `backend/app/main.py` | 修改 |
| `backend/app/services/document_service.py` | 修改 |
| `frontend/package.json` | 修改 |
| `frontend/src/components/OfficeViewer.tsx` | 新建 |
| `frontend/src/pages/DocumentList.tsx` | 修改 |
| `frontend/src/pages/DocumentDetail.tsx` | 修改 |
| `backend/tests/parsers/` | 新建（测试） |
