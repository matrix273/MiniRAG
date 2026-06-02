import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, Button, Space, Typography, message, Spin, Tooltip } from 'antd'
import { ArrowLeftOutlined, SaveOutlined, FileTextOutlined, BulbOutlined, BulbFilled } from '@ant-design/icons'
import MDEditor from '@uiw/react-md-editor'
import '@uiw/react-md-editor/markdown-editor.css'
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
  const [isDark, setIsDark] = useState(false)

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
      setLastSaved(new Date())
    } catch (error) {
      message.error('Failed to save, please try again')
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
            {lastSaved && (
              <span style={{ color: '#999', fontSize: 12 }}>
                Last saved: {lastSaved.toLocaleTimeString()}
              </span>
            )}
            <Tooltip title="Ctrl+S">
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
          <span>Status: {saving ? 'Saving...' : 'Saved'}</span>
        </div>
      </Card>
    </div>
  )
}

export default DocumentEdit
