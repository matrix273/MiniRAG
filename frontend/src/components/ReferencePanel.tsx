import { useState, useEffect } from 'react'
import { CloseOutlined, SearchOutlined, LoadingOutlined } from '@ant-design/icons'
import type { Citation } from '@/types'
import { documentApi } from '@/services/api'

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
  const [docType, setDocType] = useState<string>('')

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
        setDocType(response.doc_type || '')
        
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
  }, [selectedIndex])

  // Highlight search text in content
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

  if (!citations.length) return null

  return (
    <div
      style={{
        width: 400,
        borderLeft: '1px solid #e5e7eb',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
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
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="在引用中搜索..."
              style={{
                border: 'none',
                background: 'transparent',
                outline: 'none',
                flex: 1,
                fontSize: 13,
              }}
            />
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {selectedCitation ? (
          <div>
            <div
              style={{
                fontSize: 12,
                color: '#6b7280',
                marginBottom: 12,
                fontWeight: 500,
              }}
            >
              {selectedCitation.node_title || `Page ${selectedCitation.page}`}
            </div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 20, color: '#9ca3af' }}>
                <LoadingOutlined style={{ fontSize: 20 }} />
                <div style={{ marginTop: 8, fontSize: 13 }}>加载中...</div>
              </div>
            ) : docType === 'pdf' && pdfUrl ? (
              // PDF Preview
              <div style={{ position: 'relative' }}>
                <iframe
                  src={`${pdfUrl}#page=${selectedCitation.page}`}
                  style={{
                    width: '100%',
                    height: 500,
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    background: 'transparent',
                  }}
                  title="PDF Preview"
                />
              </div>
            ) : (
              // Text Content with highlighting
              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: '#374151',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {highlightText(pageContent || selectedCitation.text, searchText)}
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