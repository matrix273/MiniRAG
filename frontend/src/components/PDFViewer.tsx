import { useRef, useEffect, useState, useCallback } from 'react'
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

// PDF 默认宽度（与浏览器 PDF 查看器的默认宽度一致）
const PDF_DEFAULT_WIDTH = 800

export default function PDFViewer({ url, page, docId }: PDFViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [iframeSrc, setIframeSrc] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [scale, setScale] = useState(1)
  const resolvedDocId = docId || extractDocId(url)
  const baseWidthRef = useRef(PDF_DEFAULT_WIDTH)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 加载 PDF 并设置 iframe src
  useEffect(() => {
    let cancelled = false

    const loadPdf = async () => {
      setLoading(true)

      if (!resolvedDocId) {
        if (!cancelled) {
          // 使用固定宽度，不使用 zoom=width，改为 CSS 缩放
          setIframeSrc(`${url}#page=${page}`)
          setLoading(false)
        }
        return
      }

      try {
        let objectUrl = fileCache.getObjectUrl(resolvedDocId, url)
        if (!objectUrl) {
          objectUrl = await fileCache.getObjectUrlAsync(resolvedDocId, url)
        }
        if (!cancelled) {
          setIframeSrc(`${objectUrl}#page=${page}`)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setIframeSrc(`${url}#page=${page}`)
          setLoading(false)
        }
      }
    }

    loadPdf()
    return () => { cancelled = true }
  }, [url, page, resolvedDocId])

  // 监听容器宽度变化，使用 CSS transform 缩放（不重新加载 iframe）
  useEffect(() => {
    if (!scrollContainerRef.current) return
    let cancelled = false

    const observer = new ResizeObserver((entries) => {
      if (cancelled) return
      const cw = entries[0]?.contentRect?.width
      if (!cw || cw <= 0) return
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(() => {
        if (cancelled) return
        const newScale = cw / baseWidthRef.current
        setScale(newScale)
        // 缩放后修正外层容器的高度，使其与缩放后的 iframe 内容匹配
        if (contentRef.current) {
          const iframe = contentRef.current.querySelector('iframe')
          if (iframe) {
            const wrapper = contentRef.current
            // 尝试获取 iframe 实际高度，如果失败则使用估算值
            let height = 0
            try {
              // 尝试从 iframe 内容获取高度
              const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
              if (iframeDoc) {
                height = iframeDoc.documentElement.scrollHeight
              }
            } catch {
              // 跨域限制，无法访问 iframe 内容
            }
            
            // 如果无法获取实际高度，使用估算值
            if (!height || height <= 0) {
              // PDF A4 比例约 1.414，但使用更保守的比例以确保填满
              height = baseWidthRef.current * 1.414 * newScale
            }
            
            // 确保高度不小于容器高度
            const containerHeight = scrollContainerRef.current?.clientHeight || 0
            if (height < containerHeight) {
              height = containerHeight
            }
            
            wrapper.style.height = `${height}px`
            wrapper.style.width = `${baseWidthRef.current * newScale}px`
          }
        }
      }, 50)
    })

    observer.observe(scrollContainerRef.current)
    return () => {
      cancelled = true
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      observer.disconnect()
    }
  }, [])

  // 刷新 PDF 布局（不重新加载，不丢失位置）
  useEffect(() => {
    (window as any).__pdfViewerRefresh = () => {
      if (scrollContainerRef.current) {
        const cw = scrollContainerRef.current.clientWidth
        if (cw > 0) {
          const newScale = cw / baseWidthRef.current
          setScale(newScale)
        }
      }
    }
    return () => { delete (window as any).__pdfViewerRefresh }
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

      {/* PDF 缩放容器 */}
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          border: '1px solid #e5e7eb',
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          background: '#f3f4f6',
          position: 'relative',
        }}
      >
        {loading && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.8)', zIndex: 10,
          }}>
            Loading...
          </div>
        )}
        <div
          ref={contentRef}
          style={{
            width: scale > 0 ? `${baseWidthRef.current * scale}px` : '100%',
            position: 'relative',
          }}
        >
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            style={{
              width: `${baseWidthRef.current}px`,
              height: '100%',
              border: 'none',
              display: 'block',
              opacity: loading ? 0 : 1,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              position: scale > 0 ? 'absolute' : 'relative',
              top: 0,
              left: 0,
            }}
            title="PDF Preview"
            onLoad={() => setLoading(false)}
          />
        </div>
      </div>
    </div>
  )
}
