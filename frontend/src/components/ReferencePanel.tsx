import { useState, useEffect } from 'react'
import { CloseOutlined, LoadingOutlined } from '@ant-design/icons'
import type { Citation } from '@/types'
import { documentApi } from '@/services/api'
import PDFViewer from './PDFViewer'
import OfficeViewer from './OfficeViewer'
import MDViewer from './MDViewer'
import GenericFileViewer from './GenericFileViewer'

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
  const [loading, setLoading] = useState(false)
  const [fileUrl, setFileUrl] = useState<string>('')
  const [docType, setDocType] = useState<string>('')
  const [currentDocId, setCurrentDocId] = useState<string>('')
  const [fileUrlCache, setFileUrlCache] = useState<Record<string, { url: string, type: string }>>({})

  const selectedCitation = selectedIndex !== null ? citations[selectedIndex] : null

  // Fetch original page content when citation is selected
  useEffect(() => {
    if (!selectedCitation) {
      setFileUrl('')
      setDocType('')
      setCurrentDocId('')
      return
    }

    // Use citation's document_id if available, otherwise fall back to prop
    const targetDocId = selectedCitation.document_id || documentId
    if (!targetDocId) {
      setFileUrl('')
      setDocType('')
      setCurrentDocId('')
      return
    }

    const fetchContent = async () => {
      setLoading(true)
      try {
        const response = await documentApi.getPageContent(targetDocId, selectedCitation.page)

        // Check cache first
        if (fileUrlCache[targetDocId]) {
          setFileUrl(fileUrlCache[targetDocId].url)
          setDocType(fileUrlCache[targetDocId].type)
        } else {
          const fileUrl = documentApi.getFileUrl(targetDocId)
          if (fileUrl) {
            setFileUrl(fileUrl)
            setDocType(response.doc_type || 'pdf')
            setFileUrlCache(prev => ({ ...prev, [targetDocId]: { url: fileUrl, type: response.doc_type || 'pdf' } }))
          }
        }
        setCurrentDocId(targetDocId)
      } catch (error) {
        console.error('Failed to fetch page content:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchContent()
  }, [selectedCitation, documentId])

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
          Reference Source
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
                <div style={{ marginTop: 8, fontSize: 13 }}>Loading...</div>
              </div>
            ) : (
              // 显示文档预览
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '8px 20px 20px' }}>
                {fileUrl ? (
                  <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    {docType === 'pdf' ? (
                      <PDFViewer
                        url={fileUrl}
                        page={selectedCitation.page}
                        docId={currentDocId}
                      />
                    ) : docType === 'md' ? (
                      <MDViewer
                        fileUrl={fileUrl}
                        docId={currentDocId}
                      />
                    ) : ['docx', 'xlsx', 'pptx'].includes(docType) ? (
                      <OfficeViewer
                        fileUrl={fileUrl}
                        fileType={docType as 'docx' | 'xlsx' | 'pptx'}
                        docId={currentDocId}
                      />
                    ) : (
                      <GenericFileViewer
                        fileUrl={fileUrl}
                        fileType={docType}
                        filename={selectedCitation.document_id || 'file'}
                      />
                    )}
                  </div>
                ) : (
                  <div style={{ color: '#9ca3af', textAlign: 'center', padding: 20 }}>
                    Unable to load document preview
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: '#9ca3af', textAlign: 'center', marginTop: 40 }}>
            Click a citation to view the source
          </div>
        )}
      </div>
    </div>
  )
}

export default ReferencePanel