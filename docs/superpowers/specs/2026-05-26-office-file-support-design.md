# Office 文件格式支持设计文档

## 概述

为 PageIndex 系统新增对 Word (.docx)、Excel (.xlsx)、PowerPoint (.pptx) 三种 Office 文件格式的上传、查看和问答能力。

采用**方案 B：独立解析管线 + 前端原生渲染**，为每种格式构建专用的文本提取器，前端使用对应组件进行原生渲染预览。

## 范围

- **支持**：上传、文本提取、树结构构建、LLM 问答、前端原生预览
- **不支持**：在线编辑 Office 文件
- **文件格式**：.docx / .xlsx / .pptx（不支持旧版 .doc / .xls / .ppt）

## 后端架构

### 1. 新增 Python 依赖

| 库 | 用途 |
|---|---|
| `python-docx` | Word (.docx) 文本提取 |
| `openpyxl` | Excel (.xlsx) 文本提取 |
| `python-pptx` | PowerPoint (.pptx) 文本提取 |
| `html2text` | HTML → 纯文本转换（表格等结构化内容） |

### 2. 文件解析器模块

在 `backend/pageindex/` 下新建 `parsers/` 目录，包含：

- `__init__.py` — 解析器工厂函数
- `docx_parser.py` — Word 文档解析
- `xlsx_parser.py` — Excel 文档解析
- `pptx_parser.py` — PowerPoint 文档解析

**解析器统一接口：**

```python
@dataclass
class ParseResult:
    content: str          # 提取的文本内容（Markdown 格式）
    metadata: dict        # 元信息（标题、作者、页数/ sheet 数等）
    sections: list[dict]  # 结构化章节列表，用于构建树结构

def parse(file_path: Path) -> ParseResult
```

#### docx_parser.py

- 遍历文档段落（`doc.paragraphs`），按样式区分标题级别和正文
- 标题段落（Heading 1-6）→ Markdown `#` 标记
- 正文段落 → 普通文本，保留加粗/斜体等格式标记
- 表格（`doc.tables`）→ Markdown 表格格式
- 图片 → 跳过（记录到 metadata 中作为标记）
- 页眉页脚 → 跳过

#### xlsx_parser.py

- 遍历所有 Sheet
- 每个 Sheet 转为 Markdown 表格格式
- 第一行自动识别为表头
- Sheet 名作为二级标题 `## Sheet名称`
- 跳过完全为空的 Sheet
- 数字格式保留原始格式

#### pptx_parser.py

- 遍历所有 Slide
- 每个 Slide 作为一级标题 `## Slide N`
- 提取所有文本占位符内容
- 表格（`shape.has_table`）→ Markdown 表格
- 图片 → 跳过
- 备注页内容（speaker notes）→ 作为补充文本

### 3. 树结构构建

为 Office 文件设计通用的树结构构建器 `build_tree_from_sections()`：

- 输入：`ParseResult.sections`（包含 level + title 的列表）
- 输出：与现有 PDF/Markdown 格式一致的树结构 JSON
- 章节层级映射：
  - Word：Heading 样式级别直接映射
  - Excel：根节点 = 文件名，子节点 = Sheet 名
  - PPT：根节点 = 文件名，子节点 = Slide 编号

树结构格式与现有系统完全一致：

```json
{
  "title": "文档标题",
  "children": [...],
  "page_start": 0
}
```

对于 Office 文件，`page` 概念替换为逻辑章节编号。

### 4. 客户端路由修改

修改 `backend/pageindex/client.py` 的 `PageIndexClient.index()` 方法：

```python
file_ext = Path(file_path).suffix.lower()
if file_ext == '.pdf':
    page_index_main(file_path, ...)
elif file_ext in ('.md', '.markdown'):
    md_to_tree(file_path, ...)
elif file_ext == '.docx':
    docx_to_tree(file_path, ...)
elif file_ext == '.xlsx':
    xlsx_to_tree(file_path, ...)
elif file_ext == '.pptx':
    pptx_to_tree(file_path, ...)
else:
    raise ValueError(f"Unsupported file format: {file_ext}")
```

### 5. 上传端点修改

修改 `backend/app/main.py` 中的上传限制：

```python
allowed_extensions = {
    '.pdf', '.md', '.markdown',
    '.docx', '.xlsx', '.pptx'
}
```

### 6. 数据库模型修改

`doc_type` 字段扩展：

- 现有：`"pdf"` / `"md"`
- 新增：`"docx"` / `"xlsx"` / `"pptx"`

`page_count` 字段复用，对于 Office 文件存储逻辑章节/Slide 数量。

### 7. 文件存储

Office 原始文件保存在 `uploads/` 目录（与 PDF/MD 相同策略），文件名为 `{uuid}.{ext}`。

新增文件 URL 端点：`GET /api/files/{filename}` — 用于前端预览 Office 原始文件。

## 前端架构

### 1. 新增依赖

| 包 | 用途 |
|---|---|
| `@microsoft/officeparser` 或纯后端方案 | — |
| `docx-preview` | Word (.docx) 浏览器内渲染 |
| `xlsx` (SheetJS) | Excel (.xlsx) 数据解析与表格渲染 |
| `pptx-preview` 或自定义渲染 | PowerPoint (.pptx) 浏览器内渲染 |

> **注意**：前端 Office 预览库的选型需在实现阶段进一步验证兼容性和体积。备选方案是后端将 Office 转为 HTML 再传给前端渲染。

### 2. OfficeViewer 组件

新建 `frontend/src/components/OfficeViewer.tsx`，根据 `doc_type` 路由到对应渲染器：

- `docx` → 使用 `docx-preview` 渲染
- `xlsx` → 使用 `xlsx` (SheetJS) 解析后用 Ant Design Table 渲染
- `pptx` → 使用自定义 Slide 播放器（基于 SVG 渲染或图片序列）

组件接口：

```typescript
interface OfficeViewerProps {
  fileId: string;        // 文件 ID
  fileType: 'docx' | 'xlsx' | 'pptx';
  fileUrl: string;       // 原始文件 URL
}
```

### 3. 文件类型图标

修改 `DocumentList.tsx` 中的图标显示逻辑：

- `.docx` → Word 蓝色图标
- `.xlsx` → Excel 绿色图标
- `.pptx` → PowerPoint 橙色图标

### 4. 文件详情页修改

修改 `DocumentDetail.tsx`：

- Office 文件显示预览标签页（使用 OfficeViewer 组件）
- 保留树结构标签页
- 移除编辑按钮（Office 文件不支持编辑）

### 5. 上传组件修改

修改 `DocumentList.tsx` 中的上传组件：

- `accept` 属性新增 `.docx,.xlsx,.pptx`
- 文件类型校验逻辑更新

## 数据流

```
用户上传 .docx/.xlsx/.pptx
    ↓
POST /api/upload → 保存到 uploads/{uuid}.{ext}
    ↓
doc_service.index_document() (后台任务)
    ↓
PageIndexClient.index() → 识别文件类型，路由到对应解析器
    ↓
parser.parse(file_path) → ParseResult(content, metadata, sections)
    ↓
build_tree_from_sections(sections) → tree JSON
    ↓
保存到数据库: structure, pages, doc_type, metadata
    ↓
前端通过 /api/files/{filename} 加载原始文件进行预览
```

## 错误处理

- 不支持的旧格式（.doc/.xls/.ppt）→ 返回 400 错误，提示用户另存为新格式
- 损坏的文件 → 捕获异常，设置 status="error"，记录 error_message
- 超大文件 → 设置合理上限（建议 50MB）

## 测试策略

- 为每种解析器编写单元测试，提供标准样例文件
- 测试树结构构建的一致性
- 测试前端组件在不同文件类型下的渲染
- 端到端测试：上传 → 解析 → 问答完整流程

## 实现顺序

1. 安装 Python 依赖，创建 `parsers/` 模块
2. 实现 docx_parser + docx_to_tree
3. 修改 client.py 路由 + 上传端点 + 数据库模型
4. 实现 xlsx_parser + xlsx_to_tree
5. 实现 pptx_parser + pptx_to_tree
6. 前端：OfficeViewer 组件 + 图标 + 上传组件
7. 前端：文件详情页预览集成
8. 端到端测试
