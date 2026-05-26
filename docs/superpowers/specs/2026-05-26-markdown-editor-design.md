# Markdown 在线编辑器设计文档

**创建日期**: 2026-05-26
**项目**: PageIndex
**功能**: 文档页面新增 Markdown 在线编辑功能

---

## 一、功能概述

### 1.1 目标
在文档管理页面新增 Markdown 在线编辑功能，支持：
1. 编辑已上传的 Markdown 文件
2. 在线创建并保存新的 Markdown 文档
3. 编辑后自动重新索引文档，确保 AI 对话功能正常

### 1.2 用户故事
- 作为用户，我希望能在线编辑已上传的 Markdown 文档，以便快速修正内容错误
- 作为用户，我希望能在线创建新的 Markdown 文档，方便直接在系统中编写内容
- 作为用户，我希望编辑保存后文档能立即被 AI 检索到最新内容

---

## 二、技术架构

### 2.1 技术选型
| 组件 | 技术方案 | 说明 |
|------|---------|------|
| 编辑器组件 | @uiw/react-md-editor | 内置分屏编辑、实时预览、工具栏 |
| 路由 | React Router | /documents/:id/edit 编辑页面 |
| 状态管理 | React useState | 页面级状态管理 |
| API 通信 | Axios | RESTful API 调用 |
| 后端框架 | FastAPI | Python 异步 API |
| 数据库 | SQLite | 文档元数据存储 |

### 2.2 架构图
```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (React)                           │
├─────────────────────────────────────────────────────────────┤
│  DocumentEdit.tsx  │  DocumentList.tsx  │  api.ts          │
│  - 编辑器组件       │  - 新建按钮        │  - saveContent   │
│  - 保存逻辑         │  - 编辑按钮        │  - getDocument   │
│  - 目录导航         │                   │  - createDocument │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      后端 (FastAPI)                          │
├─────────────────────────────────────────────────────────────┤
│  main.py          │  document_service.py                    │
│  - PUT /api/docs  │  - save_document_content()             │
│    /:id/content   │  - reindex_document()                  │
│  - POST /api/docs │  - create_document()                   │
│    /create-md     │                                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      存储层                                  │
├─────────────────────────────────────────────────────────────┤
│  uploads/          │  SQLite DB                             │
│  - {uuid}.md       │  - documents 表                        │
│                    │  - 更新 line_count, structure          │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、数据库设计

### 3.1 现有表结构
**documents 表** (已有字段):
```sql
CREATE TABLE documents (
    id VARCHAR(36) PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    doc_type VARCHAR(10) NOT NULL,  -- 'pdf' or 'md'
    status VARCHAR(20) NOT NULL,    -- 'pending', 'processing', 'completed', 'error'
    doc_description TEXT,
    page_count INTEGER,
    line_count INTEGER,             -- Markdown 文档的行数
    structure JSON,                 -- 文档结构树
    structure_summary TEXT,
    pages JSON,
    error_message TEXT,
    folder_id VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3.2 无需新增表
现有表结构已支持所需功能，无需修改。

---

## 四、API 设计

### 4.1 新增 API 端点

#### 4.1.1 保存文档内容
```http
PUT /api/documents/{doc_id}/content
Content-Type: application/json
Authorization: Bearer <token>

{
    "content": "# 标题\n\n内容..."
}
```

**响应**:
```json
{
    "success": true,
    "message": "文档已保存并重新索引",
    "line_count": 150,
    "status": "processing"
}
```

**业务逻辑**:
1. 验证文档类型为 Markdown
2. 写入内容到 uploads/{uuid}.md
3. 更新数据库: line_count, updated_at, status='processing'
4. 触发后台重新索引任务
5. 返回保存成功信息

#### 4.1.2 创建新的 Markdown 文档
```http
POST /api/documents/create-md
Content-Type: application/json
Authorization: Bearer <token>

{
    "filename": "my-document.md",
    "content": "# 标题\n\n内容...",
    "folder_id": "optional-folder-id"
}
```

**响应**:
```json
{
    "id": "uuid",
    "filename": "uuid.md",
    "original_name": "my-document.md",
    "doc_type": "md",
    "status": "processing",
    "line_count": 150,
    "created_at": "2026-05-26T10:00:00"
}
```

**业务逻辑**:
1. 生成唯一 UUID 作为文件名
2. 保存内容到 uploads/{uuid}.md
3. 创建数据库记录
4. 触发后台索引任务
5. 返回新文档信息

### 4.2 修改现有 API

#### 4.2.1 获取文档内容 (已有，需适配)
```http
GET /api/documents/{doc_id}/content?start_line=1&end_line=100
```

**响应** (Markdown 文档):
```json
{
    "content": "# 标题\n\n第1行\n第2行...",
    "total_lines": 150,
    "start_line": 1,
    "end_line": 100
}
```

---

## 五、前端设计

### 5.1 新增页面: DocumentEdit.tsx
**路由**: `/documents/:id/edit`

#### 5.1.1 页面布局
```
┌─────────────────────────────────────────────────────────────┐
│  ◀ 返回  文档名称.md                    [保存] [预览] [帮助] │
├─────────────────────────────────────────────────────────────┤
│  目录导航        │  编辑器区域                               │
│  ┌────────────┐  │  ┌─────────────────────────────────────┐ │
│  │ # 标题1    │  │  │ 标题1                               │ │
│  │   ## 标题2 │  │  │ ─────────────────────────────────── │ │
│  │   ## 标题3 │  │  │ 内容内容内容...                     │ │
│  │ # 标题4    │  │  │                                     │ │
│  │   ## 标题5 │  │  │ 实时预览区域                         │ │
│  └────────────┘  │  │                                     │ │
│                  │  │                                     │ │
│                  │  └─────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  行数: 150  字数: 3000  最后保存: 10:30:15                  │
└─────────────────────────────────────────────────────────────┘
```

#### 5.1.2 核心功能
1. **编辑器组件**: @uiw/react-md-editor
   - 分屏模式: 左侧编辑，右侧实时预览
   - 全屏模式: 工具栏支持切换
   - 语法高亮: Markdown 语法着色
   - 快捷键: Ctrl+S 保存，Ctrl+Z 撤销

2. **目录导航**:
   - 解析 Markdown 标题生成目录树
   - 点击目录跳转到对应位置
   - 实时高亮当前所在章节

3. **保存功能**:
   - 手动保存: 点击保存按钮或 Ctrl+S
   - 自动保存: 每 30 秒自动保存（可配置）
   - 保存状态: 显示保存中/已保存/保存失败

4. **状态栏**:
   - 显示行数、字数、最后保存时间
   - 显示文档状态（编辑中/保存中/已保存）

#### 5.1.3 组件代码结构
```typescript
// DocumentEdit.tsx
import MDEditor from '@uiw/react-md-editor';

interface DocumentEditProps {
  documentId: string;
}

export const DocumentEdit: React.FC<DocumentEditProps> = ({ documentId }) => {
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // 加载文档内容
  useEffect(() => {
    loadDocument(documentId);
  }, [documentId]);

  // 保存文档
  const handleSave = async () => {
    setSaving(true);
    await documentApi.saveContent(documentId, content);
    setSaving(false);
    setLastSaved(new Date());
  };

  return (
    <div className="document-edit">
      <Header
        filename={doc.original_name}
        onSave={handleSave}
        saving={saving}
      />
      <div className="editor-container">
        <TableOfContents content={content} />
        <MDEditor
          value={content}
          onChange={setContent}
          height="calc(100vh - 120px)"
          preview="live"
        />
      </div>
      <StatusBar
        lineCount={content.split('\n').length}
        charCount={content.length}
        lastSaved={lastSaved}
      />
    </div>
  );
};
```

### 5.2 新增组件: CreateMarkdownModal.tsx
**位置**: DocumentList 页面内的弹窗

#### 5.2.1 功能
- 输入文件名（可选，默认: untitled.md）
- 选择保存的文件夹（复用现有文件夹选择器）
- 点击确认后跳转到编辑页面

#### 5.2.2 代码结构
```typescript
interface CreateMarkdownModalProps {
  visible: boolean;
  onClose: () => void;
  folders: Folder[];
  selectedFolderId: string | null;
}

export const CreateMarkdownModal: React.FC<CreateMarkdownModalProps> = ({
  visible,
  onClose,
  folders,
  selectedFolderId
}) => {
  const [filename, setFilename] = useState('');
  const navigate = useNavigate();

  const handleCreate = async () => {
    const doc = await documentApi.createMarkdown({
      filename: filename || 'untitled.md',
      folder_id: selectedFolderId
    });
    navigate(`/documents/${doc.id}/edit`);
  };

  return (
    <Modal title="创建 Markdown 文档" visible={visible} onOk={handleCreate}>
      <Input
        placeholder="文件名 (可选)"
        addonAfter=".md"
        value={filename}
        onChange={(e) => setFilename(e.target.value)}
      />
      <TreeSelect
        placeholder="选择文件夹"
        treeData={folders}
        defaultValue={selectedFolderId}
      />
    </Modal>
  );
};
```

### 5.3 修改现有组件

#### 5.3.1 DocumentList.tsx
新增按钮:
```typescript
<Button type="primary" onClick={() => setShowCreateModal(true)}>
  创建 Markdown
</Button>
```

在表格操作列新增编辑按钮:
```typescript
<Button
  type="link"
  onClick={() => navigate(`/documents/${doc.id}/edit`)}
  disabled={doc.doc_type !== 'md'}
>
  编辑
</Button>
```

#### 5.3.2 api.ts
新增 API 方法:
```typescript
export const documentApi = {
  // ... 现有方法

  // 保存文档内容
  saveContent: async (docId: string, content: string) => {
    const response = await api.put(`/api/documents/${docId}/content`, {
      content
    });
    return response.data;
  },

  // 创建 Markdown 文档
  createMarkdown: async (data: {
    filename: string;
    content?: string;
    folder_id?: string | null;
  }) => {
    const response = await api.post('/api/documents/create-md', data);
    return response.data;
  }
};
```

---

## 六、后端实现

### 6.1 新增路由 (main.py)

```python
@app.put("/api/documents/{doc_id}/content")
async def save_document_content(
    doc_id: str,
    request: SaveContentRequest,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """保存 Markdown 文档内容并重新索引"""
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    if doc.doc_type != "md":
        raise HTTPException(status_code=400, detail="只能编辑 Markdown 文档")

    # 保存文件
    file_path = os.path.join(settings.UPLOAD_DIR, doc.filename)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(request.content)

    # 更新数据库
    line_count = len(request.content.split('\n'))
    doc.line_count = line_count
    doc.status = "processing"
    doc.updated_at = datetime.now()
    db.commit()

    # 触发重新索引
    background_tasks.add_task(
        doc_service.reindex_document, doc_id, file_path, "md"
    )

    return {
        "success": True,
        "message": "文档已保存并重新索引",
        "line_count": line_count,
        "status": "processing"
    }


@app.post("/api/documents/create-md")
async def create_markdown_document(
    request: CreateMarkdownRequest,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """创建新的 Markdown 文档"""
    # 生成文件名
    doc_id = str(uuid.uuid4())
    original_name = request.filename or "untitled.md"
    if not original_name.endswith('.md'):
        original_name += '.md'
    safe_filename = f"{doc_id}.md"

    # 保存文件
    file_path = os.path.join(settings.UPLOAD_DIR, safe_filename)
    content = request.content or f"# {original_name.replace('.md', '')}\n\n"
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)

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
    db.commit()

    # 触发索引
    background_tasks.add_task(
        doc_service.index_document, doc_id, file_path, "md"
    )

    return {
        "id": doc.id,
        "filename": doc.filename,
        "original_name": doc.original_name,
        "doc_type": doc.doc_type,
        "status": doc.status,
        "line_count": doc.line_count,
        "created_at": doc.created_at.isoformat()
    }
```

### 6.2 新增 Schema (schemas.py)

```python
class SaveContentRequest(BaseModel):
    content: str

class CreateMarkdownRequest(BaseModel):
    filename: Optional[str] = "untitled.md"
    content: Optional[str] = None
    folder_id: Optional[str] = None
```

### 6.3 DocumentService 新增方法

```python
class DocumentService:
    # ... 现有方法

    async def reindex_document(self, doc_id: str, file_path: str, doc_type: str):
        """重新索引文档"""
        try:
            # 更新状态
            doc = self.db.query(Document).filter(Document.id == doc_id).first()
            doc.status = "processing"
            self.db.commit()

            # 调用索引服务
            await self.index_document(doc_id, file_path, doc_type)

            # 更新为完成状态
            doc.status = "completed"
            self.db.commit()

            # 清除内存缓存
            if doc_id in self.doc_clients:
                del self.doc_clients[doc_id]

        except Exception as e:
            doc.status = "error"
            doc.error_message = str(e)
            self.db.commit()
```

---

## 七、交互流程

### 7.1 编辑已有文档
```
1. 用户在文档列表页点击 "编辑" 按钮
2. 跳转到 /documents/:id/edit
3. 加载文档内容到编辑器
4. 用户编辑内容，右侧实时预览
5. 点击 "保存" 按钮或按 Ctrl+S
6. 调用 PUT /api/documents/:id/content
7. 后端保存文件并触发重新索引
8. 前端显示 "已保存" 状态
9. 用户可点击 "返回" 回到文档列表
```

### 7.2 创建新文档
```
1. 用户在文档列表页点击 "创建 Markdown" 按钮
2. 弹出 CreateMarkdownModal
3. 输入文件名（可选）和选择文件夹
4. 点击 "确认" 调用 POST /api/documents/create-md
5. 跳转到编辑页面 /documents/:id/edit
6. 编辑器显示默认内容
7. 用户编辑后保存
8. 文档进入处理状态，AI 可检索
```

---

## 八、错误处理

### 8.1 前端错误处理
```typescript
// 保存失败
const handleSave = async () => {
  try {
    setSaving(true);
    await documentApi.saveContent(documentId, content);
    message.success('保存成功');
    setLastSaved(new Date());
  } catch (error) {
    message.error('保存失败，请重试');
  } finally {
    setSaving(false);
  }
};
```

### 8.2 后端错误处理
```python
@app.put("/api/documents/{doc_id}/content")
async def save_document_content(...):
    try:
        # 保存逻辑
        return {"success": True, "message": "保存成功"}
    except Exception as e:
        logger.error(f"保存文档失败: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"保存失败: {str(e)}"
        )
```

---

## 九、性能优化

### 9.1 自动保存策略
- 使用防抖（debounce）避免频繁保存
- 30 秒自动保存一次
- 页面离开前提醒保存

### 9.2 缓存策略
- 文档内容加载后缓存在内存中
- 编辑过程中不频繁请求后端
- 保存后清除缓存

### 9.3 索引优化
- 重新索引在后台异步执行
- 不阻塞用户编辑
- 索引完成后更新文档状态

---

## 十、测试计划

### 10.1 单元测试
1. API 端点测试
   - 保存文档内容
   - 创建新文档
   - 获取文档内容

2. 前端组件测试
   - 编辑器组件渲染
   - 保存功能
   - 目录导航

### 10.2 集成测试
1. 完整编辑流程
   - 打开编辑页面
   - 编辑内容
   - 保存并验证

2. 创建文档流程
   - 打开创建弹窗
   - 输入信息
   - 跳转到编辑页面
   - 编辑并保存

### 10.3 边界测试
1. 空内容保存
2. 超大文件编辑（>1MB）
3. 特殊字符处理
4. 并发编辑同一文档

---

## 十一、依赖项

### 11.1 新增依赖
```json
{
  "@uiw/react-md-editor": "^4.0.0"
}
```

### 11.2 已有依赖（无需修改）
- react-router-dom
- antd
- axios
- fastapi
- sqlalchemy

---

## 十二、部署说明

### 12.1 前端部署
```bash
cd frontend
npm install
npm run build
```

### 12.2 后端部署
```bash
cd backend
uv pip install -r requirements.txt
uvicorn app.main:app --reload
```

### 12.3 环境变量
无需新增环境变量，使用现有配置即可。

---

## 十三、风险评估

### 13.1 技术风险
| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| @uiw/react-md-editor 兼容性 | 中 | 测试多个版本，准备降级方案 |
| 大文件编辑性能 | 低 | 分页加载，虚拟滚动 |
| 索引过程中数据不一致 | 低 | 版本控制，乐观锁 |

### 13.2 用户体验风险
| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 自动保存导致意外修改 | 中 | 手动保存为主，自动保存可配置 |
| 编辑器学习成本 | 低 | 提供快捷键帮助文档 |
| 网络异常丢失内容 | 中 | 本地缓存，离线保存 |

---

## 十四、后续迭代

### 14.1 Phase 2 (可选)
- [ ] 版本历史功能
- [ ] 协同编辑支持
- [ ] 图片上传和管理
- [ ] Markdown 模板库
- [ ] 导出为 PDF/HTML

### 14.2 Phase 3 (可选)
- [ ] 插件系统
- [ ] 自定义主题
- [ ] 快捷键自定义
- [ ] 多语言支持

---

## 十五、总结

本设计文档详细描述了在 PageIndex 项目中新增 Markdown 在线编辑功能的完整方案。通过使用 @uiw/react-md-editor 库，结合现有的后端架构，实现了：

1. ✅ 编辑已有 Markdown 文档
2. ✅ 在线创建新文档
3. ✅ 保存后自动重新索引
4. ✅ 分屏编辑和实时预览
5. ✅ 目录导航和状态栏

该方案与现有系统架构保持一致，无需修改数据库结构，只需新增两个 API 端点和两个前端组件即可完成。

---

**文档版本**: 1.0
**最后更新**: 2026-05-26
