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
