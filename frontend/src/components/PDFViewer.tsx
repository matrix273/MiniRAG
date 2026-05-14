import { useRef, useCallback, useEffect } from 'react'

interface PDFViewerProps {
  url: string
  page: number
  height?: number
  containerWidth?: number
}

export default function PDFViewer({ url, page }: PDFViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 只在页面变化时更新 iframe URL，避免重复加载
  // 使用 zoom=width 实现宽度自适应
  const iframeUrl = `${url}#page=${page}&zoom=width`

  // 刷新 PDF iframe - 使用时间戳强制刷新
  const refreshPdf = useCallback(() => {
    if (iframeRef.current) {
      // 构建新的 URL，使用原始 URL + 时间戳
      const baseUrl = url
      const hash = `#page=${page}&zoom=width`
      const timestamp = Date.now()
      iframeRef.current.src = `${baseUrl}?_t=${timestamp}${hash}`
    }
  }, [url, page])

  // 暴露刷新方法给父组件
  useEffect(() => {
    (window as any).__pdfViewerRefresh = refreshPdf
    return () => {
      delete (window as any).__pdfViewerRefresh
    }
  }, [refreshPdf])

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
