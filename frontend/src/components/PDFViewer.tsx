import { useState, useEffect, useRef, useCallback } from 'react'
import { SearchOutlined, LoadingOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import * as pdfjsLib from 'pdfjs-dist'

// 设置 pdfjs-dist worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`

interface PDFViewerProps {
  url: string
  page: number
  searchQuery?: string
  height?: number
}

interface SearchResult {
  text: string
  index: number
}

export default function PDFViewer({ url, page, searchQuery = '', height = 500 }: PDFViewerProps) {
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1)
  const [pdfTextContent, setPdfTextContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [renderCount, setRenderCount] = useState(0)

  // 暴露刷新方法给父组件
  useEffect(() => {
    (window as any).__pdfViewerRefresh = () => {
      setRenderCount(prev => prev + 1)
    }
    return () => {
      delete (window as any).__pdfViewerRefresh
    }
  }, [])

  // 加载 PDF 并提取文本内容用于搜索
  useEffect(() => {
    if (!url || !searchQuery.trim()) {
      setSearchResults([])
      setCurrentMatchIndex(-1)
      setPdfTextContent('')
      return
    }

    const loadPDF = async () => {
      setLoading(true)
      setError(null)
      try {
        // 使用 fetch 获取 PDF 文件
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`Failed to fetch PDF: ${response.status}`)
        }
        const blob = await response.blob()
        const blobUrl = URL.createObjectURL(blob)
        
        const loadingTask = pdfjsLib.getDocument(blobUrl)
        const doc = await loadingTask.promise
        
        pdfDocRef.current = doc
        
        // 提取当前页面的文本内容
        const pdfPage = await doc.getPage(page)
        const textContent = await pdfPage.getTextContent()
        const fullText = textContent.items.map((item: any) => item.str).join(' ')
        
        setPdfTextContent(fullText)
        
        // 搜索文本
        const results: SearchResult[] = []
        const lowerQuery = searchQuery.toLowerCase()
        const lowerText = fullText.toLowerCase()
        let startIndex = 0

        while (startIndex < lowerText.length) {
          const index = lowerText.indexOf(lowerQuery, startIndex)
          if (index === -1) break
          results.push({
            text: fullText.substring(index, index + searchQuery.length),
            index,
          })
          startIndex = index + 1
        }

        setSearchResults(results)
        setCurrentMatchIndex(results.length > 0 ? 0 : -1)
      } catch (err) {
        console.error('Failed to search PDF:', err)
        setError('搜索失败')
        setSearchResults([])
        setCurrentMatchIndex(-1)
      } finally {
        setLoading(false)
      }
    }

    loadPDF()
  }, [url, page, searchQuery])

  // 清除搜索结果
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      setCurrentMatchIndex(-1)
      setPdfTextContent('')
    }
  }, [searchQuery])

  // 导航搜索结果
  const goToNextMatch = () => {
    if (searchResults.length === 0) return
    const nextIndex = (currentMatchIndex + 1) % searchResults.length
    setCurrentMatchIndex(nextIndex)
  }

  const goToPrevMatch = () => {
    if (searchResults.length === 0) return
    const prevIndex = (currentMatchIndex - 1 + searchResults.length) % searchResults.length
    setCurrentMatchIndex(prevIndex)
  }

  // 高亮搜索文本
  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text
    const parts = text.split(new RegExp(`(${query})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark
          key={i}
          style={{
            background: '#fef08a',
            padding: '0 2px',
            borderRadius: 2,
          }}
        >
          {part}
        </mark>
      ) : (
        part
      )
    )
  }

  // 使用时间戳确保每次都是新的 URL
  const iframeUrl = `${url}#page=${page}&t=${Date.now()}`

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* 工具栏 - 显示搜索状态 */}
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
        }}
      >
        <div style={{ fontSize: 13, color: '#374151' }}>
          第 {page} 页
        </div>

        {/* 搜索结果计数 */}
        {searchQuery.trim() && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {loading ? (
              <span style={{ fontSize: 12, color: '#9ca3af' }}>
                <LoadingOutlined spin /> 搜索中...
              </span>
            ) : searchResults.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 12, color: '#6b7280' }}>
                  {currentMatchIndex + 1} / {searchResults.length}
                </span>
                <button
                  onClick={goToPrevMatch}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: '4px 6px',
                    color: '#6b7280',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <LeftOutlined style={{ fontSize: 10 }} />
                </button>
                <button
                  onClick={goToNextMatch}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: '4px 6px',
                    color: '#6b7280',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <RightOutlined style={{ fontSize: 10 }} />
                </button>
              </div>
            ) : error ? (
              <span style={{ fontSize: 12, color: '#ef4444' }}>{error}</span>
            ) : (
              <span style={{ fontSize: 12, color: '#9ca3af' }}>未找到匹配</span>
            )}
          </div>
        )}
      </div>

      {/* PDF iframe */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: `${height}px`,
          overflow: 'hidden',
          border: '1px solid #e5e7eb',
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          background: '#f3f4f6',
        }}
      >
        <iframe
          key={renderCount}
          ref={iframeRef}
          src={iframeUrl}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
          }}
          title="PDF Preview"
        />
      </div>

      {/* 搜索结果面板 */}
      {searchQuery.trim() && pdfTextContent && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            maxHeight: '150px',
            overflow: 'auto',
            background: '#fff',
            borderTop: '1px solid #e5e7eb',
            padding: '12px 16px',
            fontSize: 13,
            lineHeight: 1.6,
            color: '#374151',
            boxShadow: '0 -2px 8px rgba(0,0,0,0.1)',
          }}
        >
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8, fontWeight: 500 }}>
            当前页面搜索结果：
          </div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {highlightText(pdfTextContent, searchQuery)}
          </div>
        </div>
      )}
    </div>
  )
}