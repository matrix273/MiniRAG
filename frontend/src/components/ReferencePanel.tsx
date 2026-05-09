import { useState, useEffect, useCallback } from 'react'
import { CloseOutlined, SearchOutlined, LoadingOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'
import type { Citation } from '@/types'
import { documentApi } from '@/services/api'
import PDFViewer from './PDFViewer'

interface ReferencePanelProps {
  citations: Citation[]
  selectedIndex: number | null
  onClose: () => void
  onSelectCitation: (index: number) => void
  documentId?: string
}

const ReferencePanel: React.FC<ReferencePanelProps> = ({
  citations,
  selectedIndex,
  onClose,
  onSelectCitation,
  documentId,
}) => {
  const [searchText, setSearchText] = useState('')
  const [pageContent, setPageContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string>('')
  const [searchResults, setSearchResults] = useState<{ text: string; index: number }[]>([])
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1)

  const selectedCitation = selectedIndex !== null ? citations[selectedIndex] : null

  // Fetch original page content when citation is selected
  useEffect(() => {
    if (!selectedCitation || !documentId) {
      setPageContent('')
      setPdfUrl('')
      return
    }
    
    const fetchContent = async () => {
      setLoading(true)
      try {
        const response = await documentApi.getPageContent(documentId, selectedCitation.page)
        setPageContent(response.content)
        
        // If it's a PDF, get the file URL for preview
        if (response.doc_type === 'pdf') {
          const fileUrl = documentApi.getFileUrl(documentId)
        if (fileUrl) {
          setPdfUrl(fileUrl)
          }
        }
      } catch (error) {
        console.error('Failed to fetch page content:', error)
        setPageContent(selectedCitation.text)
      } finally {
        setLoading(false)
      }
    }
    
    fetchContent()
  }, [selectedCitation, documentId])

  // Reset search when selection changes
  useEffect(() => {
    setSearchText('')
    setSearchResults([])
    setCurrentMatchIndex(-1)
  }, [selectedIndex])

  // Search in page content
  const searchInContent = useCallback((query: string) => {
    if (!query.trim() || !pageContent) {
      setSearchResults([])
      setCurrentMatchIndex(-1)
      return
    }

    const results: { text: string; index: number }[] = []
    const lowerQuery = query.toLowerCase()
    const lowerContent = pageContent.toLowerCase()
    let startIndex = 0

    while (startIndex < lowerContent.length) {
      const index = lowerContent.indexOf(lowerQuery, startIndex)
      if (index === -1) break
      results.push({
        text: pageContent.substring(index, index + query.length),
        index,
      })
      startIndex = index + 1
    }

    setSearchResults(results)
    setCurrentMatchIndex(results.length > 0 ? 0 : -1)
  }, [pageContent])

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchText(value)
    searchInContent(value)
  }

  // Navigate search results
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

  if (!citations.length) return null

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        minWidth: 300,
        borderLeft: '1px solid #e5e7eb',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>
          引用原文
        </div>
        <button
          onClick={onClose}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            padding: 4,
            color: '#6b7280',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CloseOutlined />
        </button>
      </div>

      {/* Citation Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '12px 20px',
          borderBottom: '1px solid #e5e7eb',
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        {citations.map((citation, index) => (
          <button
            key={index}
            onClick={() => onSelectCitation(index)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: selectedIndex === index ? '#10b981' : '#f3f4f6',
              color: selectedIndex === index ? '#fff' : '#374151',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              whiteSpace: 'nowrap',
              transition: 'all 0.2s',
            }}
          >
            [{index + 1}] {citation.node_title || `Page ${citation.page}`}
          </button>
        ))}
      </div>

      {/* Search */}
      {selectedCitation && (
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#f9fafb',
              borderRadius: 8,
              padding: '8px 12px',
              border: '1px solid #e5e7eb',
            }}
          >
            <SearchOutlined style={{ color: '#9ca3af' }} />
            <input
              type="text"
              value={searchText}
              onChange={handleSearchChange}
              placeholder="在当前页面中搜索..."
              style={{
                border: 'none',
                background: 'transparent',
                outline: 'none',
                flex: 1,
                fontSize: 13,
              }}
            />
            {searchText.trim() && searchResults.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 12, color: '#6b7280' }}>
                  {currentMatchIndex + 1}/{searchResults.length}
                </span>
                <button
                  onClick={goToPrevMatch}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: '2px 4px',
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
                    padding: '2px 4px',
                    color: '#6b7280',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <RightOutlined style={{ fontSize: 10 }} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {selectedCitation ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div
              style={{
                fontSize: 12,
                color: '#6b7280',
                padding: '12px 20px 0',
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              {selectedCitation.node_title || `Page ${selectedCitation.page}`}
            </div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 20, color: '#9ca3af' }}>
                <LoadingOutlined style={{ fontSize: 20 }} />
                <div style={{ marginTop: 8, fontSize: 13 }}>加载中...</div>
              </div>
            ) : (
              // 显示 PDF 预览
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '8px 20px 20px' }}>
                {pdfUrl ? (
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <PDFViewer
                      url={pdfUrl}
                      page={selectedCitation.page}
                      searchQuery={searchText}
                    />
                  </div>
                ) : (
                  <div style={{ color: '#9ca3af', textAlign: 'center', padding: 20 }}>
                    无法加载 PDF 预览
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: '#9ca3af', textAlign: 'center', marginTop: 40 }}>
            点击引用标记查看原文
          </div>
        )}
      </div>
    </div>
  )
}

export default ReferencePanel