import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Card, Button, Space, Typography, message, Spin, Tooltip, Tag } from 'antd'
import { ArrowLeftOutlined, SaveOutlined, FileTextOutlined, BulbOutlined, BulbFilled, EditOutlined, CheckCircleOutlined, ExclamationCircleOutlined, SyncOutlined } from '@ant-design/icons'
import MDEditor from '@uiw/react-md-editor'
import '@uiw/react-md-editor/markdown-editor.css'
import { documentApi } from '@/services/api'
import type { Document } from '@/types'

const { Title } = Typography

/** 文档保存/索引状态 */
type SaveStatus = 'indexed' | 'indexing' | 'draft'

const DocumentEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [document, setDocument] = useState<Document | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  const [savedStatus, setSavedStatus] = useState<SaveStatus | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    loadDocument()
  }, [id, location.key])

  const loadDocument = async () => {
    if (!id) return

    try {
      setLoading(true)
      const doc = await documentApi.get(id)
      setDocument(doc)

      // Load raw file content directly from disk (reflects drafts)
      if (doc.doc_type === 'md') {
        const rawData = await documentApi.getRaw(id)
        setContent(rawData.content)
      } else if (doc.line_count) {
        const contentData = await documentApi.getContent(id, 1, doc.line_count)
        setContent(contentData.content)
      }

      // 根据服务器数据判断索引状态
      setLastUpdatedAt(doc.updated_at || doc.created_at)
      if (doc.status === 'completed') {
        setSavedStatus('indexed')
      } else if (doc.status === 'processing') {
        setSavedStatus('indexing')
      } else {
        setSavedStatus('draft')
      }
    } catch (error) {
      message.error('Failed to load document')
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
      setLastUpdatedAt(result.updated_at)
      setSavedStatus('indexing')
      // 更新 document status 为 processing
      setDocument(prev => prev ? { ...prev, status: 'processing' } : null)
    } catch (error) {
      message.error('Failed to save, please try again')
    } finally {
      setSaving(false)
    }
  }, [id, content])

  const handleSaveDraft = useCallback(async () => {
    if (!id) return

    try {
      setDraftSaving(true)
      const result = await documentApi.saveDraft(id, content)
      message.success('Draft saved (not indexed)')
      setLastUpdatedAt(result.updated_at)
      setSavedStatus('draft')
    } catch (error) {
      message.error('Failed to save draft, please try again')
    } finally {
      setDraftSaving(false)
    }
  }, [id, content])

  // 快捷键保存 (Ctrl+S 完整保存, Ctrl+D 暂存)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault()
        handleSaveDraft()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, handleSaveDraft])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div style={{ height: 'calc(100vh - 112px)', display: 'flex', flexDirection: 'column', backgroundColor: isDark ? '#1e1e1e' : '#f5f5f5', color: isDark ? '#fff' : '#000', transition: 'background-color 0.3s, color 0.3s' }}>
      {/* Header toolbar */}
      <Card
        size="small"
        style={{ marginBottom: 8, backgroundColor: '#fff', borderColor: '#f0f0f0' }}
        bodyStyle={{ padding: '8px 16px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate('/documents')}
            >
              Back
            </Button>
            <FileTextOutlined />
            <Title level={5} style={{ margin: 0 }}>
              {document?.filename || 'Document'}
            </Title>
          </Space>

          <Space>
            <Tooltip title={isDark ? "Switch to light mode" : "Switch to dark mode"}>
              <Button
                icon={isDark ? <BulbFilled /> : <BulbOutlined />}
                onClick={() => setIsDark(!isDark)}
              />
            </Tooltip>
            {/* 索引状态指示器 */}
            {savedStatus && (
              <SaveStatusBadge status={savedStatus} updatedAt={lastUpdatedAt} />
            )}
            <Tooltip title="Save draft without re-indexing. Index will be stale. (Ctrl+D)">
              <Button
                icon={<EditOutlined />}
                onClick={handleSaveDraft}
                loading={draftSaving}
              >
                Save Draft
              </Button>
            </Tooltip>
            <Tooltip title="Save & re-index now (Ctrl+S)">
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saving}
              >
                Save
              </Button>
            </Tooltip>
          </Space>
        </div>
      </Card>

      {/* Editor area */}
      <div style={{ flex: 1, overflow: 'hidden' }} data-color-mode={isDark ? "dark" : "light"} data-dark-mode={isDark ? "dark" : "light"}>
        <MDEditor
          value={content}
          onChange={(value) => setContent(value || '')}
          height="100%"
          preview="live"
          visibleDragbar={true}
        />
      </div>

      {/* Status bar */}
      <Card
        size="small"
        style={{ marginTop: 8, backgroundColor: isDark ? '#2d2d2d' : '#fff', borderColor: isDark ? '#404040' : '#f0f0f0' }}
        bodyStyle={{ padding: '4px 16px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666', fontSize: 12 }}>
          <span>Lines: {content.split('\n').length}</span>
          <span>Chars: {content.length}</span>
          <span>
            {draftSaving ? 'Saving draft...' : saving ? 'Saving & re-indexing...' : savedStatus === 'indexed' ? 'Indexed' : savedStatus === 'indexing' ? 'Indexing...' : savedStatus === 'draft' ? 'Draft (not indexed)' : 'Unsaved'}
          </span>
        </div>
      </Card>
    </div>
  )
}

/** 格式化 ISO 时间为可读字符串 */
function formatTime(isoStr: string | null): string {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return isoStr
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 索引状态徽标 */
const SaveStatusBadge: React.FC<{ status: SaveStatus; updatedAt: string | null }> = ({ status, updatedAt }) => {
  const timeStr = formatTime(updatedAt)

  switch (status) {
    case 'indexed':
      return (
        <Tooltip title={`Indexed and searchable. Updated: ${timeStr}`}>
          <Tag icon={<CheckCircleOutlined />} color="success" style={{ marginRight: 0 }}>
            Indexed {timeStr}
          </Tag>
        </Tooltip>
      )
    case 'indexing':
      return (
        <Tooltip title={`Re-indexing in progress... Updated: ${timeStr}`}>
          <Tag icon={<SyncOutlined spin />} color="processing" style={{ marginRight: 0 }}>
            Indexing... {timeStr}
          </Tag>
        </Tooltip>
      )
    case 'draft':
      return (
        <Tooltip title={`Draft only — not indexed or index is stale. Use Save (Ctrl+S) to re-index. Updated: ${timeStr}`}>
          <Tag icon={<ExclamationCircleOutlined />} color="warning" style={{ marginRight: 0 }}>
            Draft {timeStr}
          </Tag>
        </Tooltip>
      )
    default:
      return null
  }
}

export default DocumentEdit
