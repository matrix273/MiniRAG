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
  const [iframeSrc, setIframeSrc] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const resolvedDocId = docId || extractDocId(url)

  // 加载 PDF 并设置 iframe src
  useEffect(() => {
    let cancelled = false

    const loadPdf = async () => {
      setLoading(true)
      
      if (!resolvedDocId) {
        // 没有 docId，直接使用原始 URL
        if (!cancelled) {
          setIframeSrc(`${url}#page=${page}&zoom=width`)
          setLoading(false)
        }
        return
      }

      try {
        // 获取缓存的 object URL，如果没有则异步加载
        let objectUrl = fileCache.getObjectUrl(resolvedDocId, url)
        
        if (!objectUrl) {
          // 首次加载，从缓存获取或下载文件
          objectUrl = await fileCache.getObjectUrlAsync(resolvedDocId, url)
        }
        
        if (!cancelled) {
          setIframeSrc(`${objectUrl}#page=${page}&zoom=width`)
          setLoading(false)
        }
      } catch {
        // 缓存加载失败，回退到原始 URL
        if (!cancelled) {
          setIframeSrc(`${url}#page=${page}&zoom=width`)
          setLoading(false)
        }
      }
    }

    loadPdf()

    return () => {
      cancelled = true
    }
  }, [url, page, resolvedDocId])

  // 刷新 PDF iframe - 只用于修复布局问题
  useEffect(() => {
    (window as any).__pdfViewerRefresh = () => {
      if (iframeRef.current) {
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
  }, [])

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
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          border: '1px solid #e5e7eb',
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          background: '#f3f4f6',
          position: 'relative',
        }}
      >
        {loading && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.8)',
            zIndex: 10,
          }}>
            Loading...
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            display: 'block',
            opacity: loading ? 0 : 1,
          }}
          title="PDF Preview"
          onLoad={() => setLoading(false)}
        />
      </div>
    </div>
  )
}
