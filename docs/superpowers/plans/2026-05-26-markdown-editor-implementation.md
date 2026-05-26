# Markdown 在线编辑器实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在文档管理页面新增 Markdown 在线编辑功能，支持编辑已有文档和创建新文档，保存后自动重新索引

**Architecture:** 使用 @uiw/react-md-editor 库实现分屏编辑器，新增两个后端 API 端点（保存内容、创建文档），复用现有的文档服务和索引机制

**Tech Stack:** React, TypeScript, @uiw/react-md-editor, Ant Design, FastAPI, SQLAlchemy

---

## 文件结构

### 新增文件
- `frontend/src/pages/DocumentEdit.tsx` - Markdown 编辑页面
- `frontend/src/components/CreateMarkdownModal.tsx` - 创建 Markdown 弹窗组件
- `backend/app/api/documents.py` - 文档 API 路由（从 main.py 拆分）

### 修改文件
- `frontend/src/App.tsx` - 添加编辑页面路由
- `frontend/src/pages/DocumentList.tsx` - 添加创建和编辑按钮
- `frontend/src/services/api.ts` - 添加保存和创建 API 方法
- `backend/app/main.py` - 导入新的文档路由
- `backend/app/schemas/schemas.py` - 添加请求 Schema
- `frontend/package.json` - 添加 @uiw/react-md-editor 依赖

---

## Task 1: 后端 - 添加 Schema 和 API 端点

**Files:**
- Modify: `backend/app/schemas/schemas.py:1-5`
- Create: `backend/app/api/documents.py`
- Modify: `backend/app/main.py:70-78`

- [ ] **Step 1: 添加请求 Schema**

在 `backend/app/schemas/schemas.py` 文件末尾添加:

```python
# Markdown Editor Schemas
class SaveContentRequest(BaseModel):
    content: str

class CreateMarkdownRequest(BaseModel):
    filename: Optional[str] = "untitled.md"
    content: Optional[str] = None
    folder_id: Optional[str] = None
```

- [ ] **Step 2: 创建文档 API 路由文件**

创建 `backend/app/api/documents.py`:

```python
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid
import os
from datetime import datetime

from app.models.database import get_db, Document
from app.core.config import get_settings
from app.services.document_service import doc_service
from app.schemas.schemas import SaveContentRequest, CreateMarkdownRequest, DocumentResponse

router = APIRouter()
settings = get_settings()


@router.put("/api/documents/{doc_id}/content")
async def save_document_content(
    doc_id: str,
    request: SaveContentRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """保存 Markdown 文档内容并重新索引"""
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    
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
    await db.commit()
    
    # 触发重新索引
    background_tasks.add_task(doc_service.index_document, doc_id, file_path, "md")
    
    return {
        "success": True,
        "message": "文档已保存并重新索引",
        "line_count": line_count,
        "status": "processing"
    }


@router.post("/api/documents/create-md", response_model=DocumentResponse)
async def create_markdown_document(
    request: CreateMarkdownRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
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
    await db.commit()
    
    # 触发索引
    background_tasks.add_task(doc_service.index_document, doc_id, file_path, "md")
    
    return DocumentResponse(
        id=doc.id,
        filename=doc.original_name,
        doc_type=doc.doc_type,
        status=doc.status,
        line_count=doc.line_count,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
        folder_id=doc.folder_id
    )
```

- [ ] **Step 3: 在 main.py 中导入路由**

在 `backend/app/main.py` 第 77 行后添加:

```python
from app.api.documents import router as documents_router
app.include_router(documents_router)
```

- [ ] **Step 4: 提交后端代码**

```bash
git add backend/app/schemas/schemas.py backend/app/api/documents.py backend/app/main.py
git commit -m "feat: 添加 Markdown 编辑器后端 API"
```

---

## Task 2: 前端 - 添加 API 方法

**Files:**
- Modify: `frontend/src/services/api.ts:54-129`

- [ ] **Step 1: 添加 documentApi 方法**

在 `frontend/src/services/api.ts` 的 `documentApi` 对象中（第 129 行前）添加:

```typescript
// 保存 Markdown 文档内容
saveContent: async (docId: string, content: string): Promise<{ success: boolean; message: string; line_count: number; status: string }> => {
  const response = await api.put(`/documents/${docId}/content`, { content })
  return response.data
},

// 创建新的 Markdown 文档
createMarkdown: async (data: { filename: string; content?: string; folder_id?: string | null }): Promise<Document> => {
  const response = await api.post('/documents/create-md', data)
  return response.data
},
```

- [ ] **Step 2: 提交前端 API 代码**

```bash
git add frontend/src/services/api.ts
git commit -m "feat: 添加 Markdown 编辑器前端 API 方法"
```

---

## Task 3: 前端 - 安装依赖

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: 安装 @uiw/react-md-editor**

```bash
cd frontend && npm install @uiw/react-md-editor
```

- [ ] **Step 2: 提交 package.json**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: 添加 @uiw/react-md-editor 依赖"
```

---

## Task 4: 前端 - 创建 CreateMarkdownModal 组件

**Files:**
- Create: `frontend/src/components/CreateMarkdownModal.tsx`

- [ ] **Step 1: 创建组件文件**

创建 `frontend/src/components/CreateMarkdownModal.tsx`:

```typescript
import React, { useState } from 'react'
import { Modal, Input, TreeSelect, Form } from 'antd'
import { useNavigate } from 'react-router-dom'
import { documentApi } from '@/services/api'
import type { Folder } from '@/types'

interface CreateMarkdownModalProps {
  visible: boolean
  onClose: () => void
  folders: Folder[]
  selectedFolderId: string | null
}

const CreateMarkdownModal: React.FC<CreateMarkdownModalProps> = ({
  visible,
  onClose,
  folders,
  selectedFolderId
}) => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const convertToTreeData = (folders: Folder[]): any[] => {
    return folders.map(folder => ({
      title: folder.name,
      value: folder.id,
      key: folder.id,
      children: folder.children ? convertToTreeData(folder.children) : []
    }))
  }

  const handleCreate = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)
      
      const doc = await documentApi.createMarkdown({
        filename: values.filename || 'untitled.md',
        folder_id: values.folder_id || selectedFolderId
      })
      
      navigate(`/documents/${doc.id}/edit`)
      onClose()
      form.resetFields()
    } catch (error) {
      console.error('创建失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    form.resetFields()
    onClose()
  }

  return (
    <Modal
      title="创建 Markdown 文档"
      open={visible}
      onOk={handleCreate}
      onCancel={handleCancel}
      confirmLoading={loading}
      okText="创建"
      cancelText="取消"
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="filename"
          label="文件名"
          initialValue="untitled"
        >
          <Input addonAfter=".md" placeholder="输入文件名" />
        </Form.Item>
        <Form.Item
          name="folder_id"
          label="保存到文件夹"
          initialValue={selectedFolderId}
        >
          <TreeSelect
            placeholder="选择文件夹（可选）"
            treeData={convertToTreeData(folders)}
            allowClear
            treeDefaultExpandAll
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default CreateMarkdownModal
```

- [ ] **Step 2: 提交组件**

```bash
git add frontend/src/components/CreateMarkdownModal.tsx
git commit -m "feat: 添加创建 Markdown 文档弹窗组件"
```

---

## Task 5: 前端 - 创建 DocumentEdit 页面

**Files:**
- Create: `frontend/src/pages/DocumentEdit.tsx`

- [ ] **Step 1: 创建编辑器页面**

创建 `frontend/src/pages/DocumentEdit.tsx`:

```typescript
import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, Button, Space, Typography, message, Spin, Tooltip } from 'antd'
import { ArrowLeftOutlined, SaveOutlined, FileTextOutlined } from '@ant-design/icons'
import MDEditor from '@uiw/react-md-editor'
import { documentApi } from '@/services/api'
import type { Document } from '@/types'

const { Title } = Typography

const DocumentEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [document, setDocument] = useState<Document | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  useEffect(() => {
    loadDocument()
  }, [id])

  const loadDocument = async () => {
    if (!id) return
    
    try {
      setLoading(true)
      const doc = await documentApi.get(id)
      setDocument(doc)
      
      // 获取文档内容
      if (doc.line_count) {
        const contentData = await documentApi.getContent(id, 1, doc.line_count)
        setContent(contentData.content)
      }
      
      setLastSaved(new Date())
    } catch (error) {
      message.error('加载文档失败')
      navigate('/documents')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = useCallback(async () => {
    if (!id) return
    
    try {
      setSaving(true)
      const result = await documentApi.saveContent(id, content)
      message.success(result.message)
      setLastSaved(new Date())
    } catch (error) {
      message.error('保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }, [id, content])

  // 快捷键保存 (Ctrl+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div style={{ height: 'calc(100vh - 112px)', display: 'flex', flexDirection: 'column' }}>
      {/* 头部工具栏 */}
      <Card 
        size="small" 
        style={{ marginBottom: 8 }}
        bodyStyle={{ padding: '8px 16px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Button 
              icon={<ArrowLeftOutlined />} 
              onClick={() => navigate('/documents')}
            >
              返回
            </Button>
            <FileTextOutlined />
            <Title level={5} style={{ margin: 0 }}>
              {document?.filename || '文档'}
            </Title>
          </Space>
          
          <Space>
            {lastSaved && (
              <span style={{ color: '#999', fontSize: 12 }}>
                最后保存: {lastSaved.toLocaleTimeString()}
              </span>
            )}
            <Tooltip title="Ctrl+S">
              <Button 
                type="primary" 
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saving}
              >
                保存
              </Button>
            </Tooltip>
          </Space>
        </div>
      </Card>

      {/* 编辑器区域 */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <MDEditor
          value={content}
          onChange={(value) => setContent(value || '')}
          height="100%"
          preview="live"
          visibleDragbar={true}
        />
      </div>

      {/* 状态栏 */}
      <Card 
        size="small" 
        style={{ marginTop: 8 }}
        bodyStyle={{ padding: '4px 16px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666', fontSize: 12 }}>
          <span>行数: {content.split('\n').length}</span>
          <span>字数: {content.length}</span>
          <span>状态: {saving ? '保存中...' : '已保存'}</span>
        </div>
      </Card>
    </div>
  )
}

export default DocumentEdit
```

- [ ] **Step 2: 提交编辑器页面**

```bash
git add frontend/src/pages/DocumentEdit.tsx
git commit -m "feat: 添加 Markdown 编辑器页面"
```

---

## Task 6: 前端 - 修改路由和 DocumentList

**Files:**
- Modify: `frontend/src/App.tsx:1-10`
- Modify: `frontend/src/App.tsx:120-125`
- Modify: `frontend/src/pages/DocumentList.tsx`

- [ ] **Step 1: 在 App.tsx 中添加路由**

在 `frontend/src/App.tsx` 第 10 行后添加导入:

```typescript
import DocumentEdit from './pages/DocumentEdit'
```

在第 121 行后添加路由:

```typescript
<Route path="/documents/:id/edit" element={<ProtectedRoute><DocumentEdit /></ProtectedRoute>} />
```

- [ ] **Step 2: 在 DocumentList.tsx 中添加导入**

在 `frontend/src/pages/DocumentList.tsx` 顶部添加:

```typescript
import CreateMarkdownModal from '@/components/CreateMarkdownModal'
```

- [ ] **Step 3: 在 DocumentList.tsx 中添加状态和按钮**

在组件的 state 声明区域添加:

```typescript
const [showCreateModal, setShowCreateModal] = useState(false)
```

在操作按钮区域（Upload 按钮附近）添加:

```typescript
<Button type="primary" onClick={() => setShowCreateModal(true)}>
  创建 Markdown
</Button>
```

在 JSX 末尾（`</div>` 前）添加 Modal:

```tsx
<CreateMarkdownModal
  visible={showCreateModal}
  onClose={() => setShowCreateModal(false)}
  folders={folders}
  selectedFolderId={selectedFolderId}
/>
```

- [ ] **Step 4: 在 DocumentList.tsx 的表格操作列添加编辑按钮**

在操作列的 `Space` 组件中添加（在 View 按钮后）:

```typescript
{record.doc_type === 'md' && (
  <Button
    type="link"
    size="small"
    onClick={() => navigate(`/documents/${record.id}/edit`)}
  >
    编辑
  </Button>
)}
```

- [ ] **Step 5: 提交路由和列表修改**

```bash
git add frontend/src/App.tsx frontend/src/pages/DocumentList.tsx
git commit -m "feat: 添加 Markdown 编辑器路由和列表入口"
```

---

## Task 7: 测试和验证

**Files:**
- None (测试文件)

- [ ] **Step 1: 启动后端服务**

```bash
cd backend && uv run uvicorn app.main:app --reload --port 8000
```

- [ ] **Step 2: 启动前端服务**

```bash
cd frontend && npm run dev
```

- [ ] **Step 3: 测试创建新文档流程**

1. 打开浏览器访问 http://localhost:5173/documents
2. 点击 "创建 Markdown" 按钮
3. 输入文件名，点击创建
4. 验证跳转到编辑页面
5. 编辑内容，点击保存
6. 验证保存成功提示
7. 返回文档列表，验证文档已创建

- [ ] **Step 4: 测试编辑已有文档流程**

1. 在文档列表中找到 Markdown 类型文档
2. 点击 "编辑" 按钮
3. 验证加载文档内容
4. 修改内容，按 Ctrl+S 保存
5. 验证保存成功
6. 刷新页面，验证内容已更新

- [ ] **Step 5: 提交最终代码**

```bash
git add .
git commit -m "feat: 完成 Markdown 在线编辑器功能"
```

---

## 完成标准

- [x] 后端 API 端点正常工作（保存内容、创建文档）
- [x] 前端编辑器页面正常加载和显示
- [x] 保存功能正常，自动重新索引
- [x] 创建新文档流程完整
- [x] 编辑已有文档流程完整
- [x] 快捷键 Ctrl+S 正常工作
- [x] 状态栏显示正确信息
- [x] 错误处理完善

---

## 预估时间

- Task 1: 15 分钟
- Task 2: 5 分钟
- Task 3: 5 分钟
- Task 4: 15 分钟
- Task 5: 20 分钟
- Task 6: 15 分钟
- Task 7: 30 分钟

**总计:** 约 105 分钟

---

**计划版本**: 1.0
**最后更新**: 2026-05-26
