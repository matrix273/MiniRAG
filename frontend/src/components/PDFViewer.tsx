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
  const resolvedDocId = docId || extractDocId(url)
  const baseWidthRef = useRef(PDF_DEFAULT_WIDTH)
  const currentScaleRef = useRef(1)
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

  // 通过 DOM 直接应用缩放，避免 React 重渲染 iframe 导致 PDF 重置到第一页
  const applyScale = useCallback((newScale: number) => {
    currentScaleRef.current = newScale
    const iframe = iframeRef.current
    const wrapper = contentRef.current
    if (!iframe || !wrapper) return

    iframe.style.transform = `scale(${newScale})`
    iframe.style.transformOrigin = 'top left'
    iframe.style.position = 'absolute'
    iframe.style.top = '0'
    iframe.style.left = '0'
    iframe.style.width = `${baseWidthRef.current}px`
    iframe.style.height = '100%'

    wrapper.style.width = `${baseWidthRef.current * newScale}px`

    // 尝试获取 iframe 内容高度
    let height = 0
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
      if (iframeDoc) {
        height = iframeDoc.documentElement.scrollHeight
      }
    } catch {
      // 跨域限制，无法访问 iframe 内容
    }

    if (!height || height <= 0) {
      height = baseWidthRef.current * 1.414 * newScale
    }

    const containerHeight = scrollContainerRef.current?.clientHeight || 0
    // 缩放后视觉高度必须铺满容器，因此 wrapper 高度至少为 containerHeight / scale
    const minHeight = containerHeight / newScale
    if (height < minHeight) {
      height = minHeight
    }

    wrapper.style.height = `${height}px`
  }, [])

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
        applyScale(newScale)
      }, 50)
    })

    observer.observe(scrollContainerRef.current)
    return () => {
      cancelled = true
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      observer.disconnect()
    }
  }, [applyScale])

  // 刷新 PDF 布局（不重新加载，不丢失位置）
  useEffect(() => {
    (window as any).__pdfViewerRefresh = () => {
      if (scrollContainerRef.current) {
        const cw = scrollContainerRef.current.clientWidth
        if (cw > 0) {
          const newScale = cw / baseWidthRef.current
          applyScale(newScale)
        }
      }
    }
    return () => { delete (window as any).__pdfViewerRefresh }
  }, [applyScale])

  // 组件挂载时应用初始缩放
  useEffect(() => {
    if (scrollContainerRef.current) {
      const cw = scrollContainerRef.current.clientWidth
      if (cw > 0) {
        applyScale(cw / baseWidthRef.current)
      }
    }
  }, [applyScale])

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
          Page {page}
        </div>
      </div>

      {/* PDF 缩放容器 */}
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          border: '1px solid #e5e7eb',
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          background: '#fff',
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
            position: 'relative',
          }}
        >
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            style={{
              border: 'none',
              display: 'block',
              opacity: loading ? 0 : 1,
            }}
            title="PDF Preview"
            onLoad={() => setLoading(false)}
          />
        </div>
      </div>
    </div>
  )
}
