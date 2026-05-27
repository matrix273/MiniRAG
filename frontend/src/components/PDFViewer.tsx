import { useRef, useEffect, useState } from 'react'
import { fileCache } from '@/utils/fileCache'

interface PDFViewerProps {
  url: string
  page: number
  height?: number
  containerWidth?: number
  docId?: string
}

function extractDocId(url: string): string | undefined {
  const match = url.match(/\/api\/documents\/([^/]+)\/file/)
  return match?.[1]
}

export default function PDFViewer({ url, page, docId }: PDFViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [objectUrl, setObjectUrl] = useState<string>(`${url}#page=${page}&zoom=width`)
  const resolvedDocId = docId || extractDocId(url)

  // 加载文件并创建 object URL 以利用缓存
  useEffect(() => {
    const loadPdf = async () => {
      if (!resolvedDocId) {
        // 没有 docId，直接使用原始 URL
        setObjectUrl(`${url}#page=${page}&zoom=width`)
        return
      }

      try {
        const blob = await fileCache.fetch(resolvedDocId, url)
        const objUrl = URL.createObjectURL(blob)
        setObjectUrl(`${objUrl}#page=${page}&zoom=width`)

        // 清理之前的 object URL
        return () => {
          URL.revokeObjectURL(objUrl)
        }
      } catch {
        // 缓存加载失败，回退到原始 URL
        setObjectUrl(`${url}#page=${page}&zoom=width`)
      }
    }

    loadPdf()
  }, [url, page, resolvedDocId])

  // 刷新 PDF iframe - 使用缓存的版本
  useEffect(() => {
    (window as any).__pdfViewerRefresh = () => {
      if (iframeRef.current && objectUrl) {
        // 重新加载 iframe 以修复布局，但使用同一个 objectUrl（来自缓存）
        const currentSrc = iframeRef.current.src
        iframeRef.current.src = 'about:blank'
        setTimeout(() => {
          if (iframeRef.current) {
            iframeRef.current.src = currentSrc
          }
        }, 50)
      }
    }
    return () => {
      delete (window as any).__pdfViewerRefresh
    }
  }, [objectUrl])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 工具栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: '#f9fafb',
          borderBottom: '1px solid #e5e7eb',
          borderRadius: '8px 8px 0 0',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 13, color: '#374151' }}>
          第 {page} 页
        </div>
      </div>

      {/* PDF iframe */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          border: '1px solid #e5e7eb',
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          background: '#f3f4f6',
        }}
      >
        <iframe
          ref={iframeRef}
          src={iframeUrl}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            display: 'block',
          }}
          title="PDF Preview"
        />
      </div>
    </div>
  )
}
