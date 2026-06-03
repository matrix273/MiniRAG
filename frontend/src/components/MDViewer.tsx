import { useEffect, useState } from 'react'
import { Typography, Spin } from 'antd'
import { fileCache } from '@/utils/fileCache'

const { Text } = Typography

interface MDViewerProps {
  fileUrl: string
  docId?: string
}

function extractDocId(url: string): string | undefined {
  const match = url.match(/\/api\/documents\/([^/]+)\/file/)
  return match?.[1]
}

export default function MDViewer({ fileUrl, docId }: MDViewerProps) {
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const resolvedDocId = docId || extractDocId(fileUrl)

  useEffect(() => {
    const loadContent = async () => {
      setLoading(true)
      setError(null)
      
      try {
        let text: string
        
        if (resolvedDocId) {
          // 使用缓存服务获取文件
          const blob = await fileCache.fetch(resolvedDocId, fileUrl)
          text = await blob.text()
        } else {
          // 直接获取内容
          const response = await fetch(fileUrl)
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
          }
          text = await response.text()
        }
        
        setContent(text)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load markdown')
      } finally {
        setLoading(false)
      }
    }

    loadContent()
  }, [fileUrl, resolvedDocId])

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        height: '100%',
        padding: 20 
      }}>
        <Spin tip="Loading..." fullscreen />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <Text type="danger">{error}</Text>
      </div>
    )
  }

  return (
    <div style={{ 
      flex: 1, 
      overflow: 'auto', 
      padding: '20px',
      background: '#fff',
      minHeight: 0,
    }}>
      <pre
        style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word',
          fontFamily: 'monospace',
          fontSize: 14,
          lineHeight: 1.6,
          color: '#333',
        }}
      >
        {content}
      </pre>
    </div>
  )
}
