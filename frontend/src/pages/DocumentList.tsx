import { useState, useEffect, useRef } from 'react'
import { Card, Table, Button, Upload, message, Tag, Space, Typography, App, Tooltip } from 'antd'
import { 
  UploadOutlined, 
  EyeOutlined, 
  DeleteOutlined, 
  FilePdfOutlined, 
  FileMarkdownOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons'
import type { UploadFile } from 'antd/es/upload/interface'
import { useNavigate } from 'react-router-dom'
import { documentApi } from '@/services/api'
import type { Document } from '@/types'
import dayjs from 'dayjs'

const { Title } = Typography

const DocumentList = () => {
  const { modal } = App.useApp()  // Use App hook for context-aware modals
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [reprocessingId, setReprocessingId] = useState<string | null>(null)
  const navigate = useNavigate()
  
  // Track previous statuses to detect changes
  const prevStatusesRef = useRef<Record<string, string>>({})

  // Fetch documents on mount
  useEffect(() => {
    fetchDocuments()
  }, [])
  
  // Auto-refresh when there are pending/processing documents
  useEffect(() => {
    const hasProcessingDocs = documents.some(
      doc => doc.status === 'pending' || doc.status === 'processing'
    )
    
    if (!hasProcessingDocs) return
    
    // Set up polling every 3 seconds
    const interval = setInterval(() => {
      fetchDocuments()
    }, 3000)
    
    return () => clearInterval(interval)
  }, [documents])

  const fetchDocuments = async () => {
    setLoading(true)
    try {
      const data = await documentApi.list()
      
      // Check for status changes (pending/processing -> completed/error)
      data.forEach((doc: Document) => {
        const prevStatus = prevStatusesRef.current[doc.id]
        if (prevStatus && prevStatus !== doc.status) {
          if (prevStatus === 'processing' && doc.status === 'completed') {
            message.success(`"${doc.filename}" indexed successfully!`)
          } else if (prevStatus === 'processing' && doc.status === 'error') {
            message.error(`"${doc.filename}" failed to index`)
          }
        }
        prevStatusesRef.current[doc.id] = doc.status
      })
      
      setDocuments(data)
    } catch (error) {
      message.error('Failed to fetch documents')
    } finally {
      setLoading(false)
    }
  }

  const handleUpload = async (fileList: UploadFile[]) => {
    if (fileList.length === 0) return
    
    setUploading(true)
    try {
      const files = fileList
        .filter(f => f.originFileObj)
        .map(f => f.originFileObj!) as File[]
      
      const result = await documentApi.uploadMultiple(files)
      
      if (result.total_uploaded > 0) {
        message.success(`Uploaded ${result.total_uploaded} document(s)`)
      }
      if (result.errors && result.errors.length > 0) {
        result.errors.forEach((err: string) => message.warning(err))
      }
      
      fetchDocuments() // Refresh list
    } catch (error) {
      message.error('Failed to upload documents')
    } finally {
      setUploading(false)
    }
  }

  const handleReprocess = async (doc: Document) => {
    modal.confirm({
      title: 'Reprocess Document?',
      icon: <ExclamationCircleOutlined />,
      content: `This will reindex "${doc.filename}" using the current AI model.`,
      okText: 'Reprocess',
      okType: 'primary',
      cancelText: 'Cancel',
      onOk: async () => {
        setReprocessingId(doc.id)
        try {
          await documentApi.reprocess(doc.id)
          message.success('Document reprocessing started')
          fetchDocuments()
        } catch (error) {
          message.error('Failed to start reprocessing')
        } finally {
          setReprocessingId(null)
        }
      },
    })
  }

  const handleDelete = async (id: string) => {
    modal.confirm({
      title: 'Delete Document?',
      icon: <ExclamationCircleOutlined />,
      content: 'This action cannot be undone.',
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          await documentApi.delete(id)
          message.success('Document deleted')
          fetchDocuments()
        } catch (error) {
          message.error('Failed to delete document')
        }
      },
    })
  }

  const getStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      pending: { color: 'default', text: 'Pending' },
      processing: { color: 'processing', text: 'Processing' },
      completed: { color: 'success', text: 'Completed' },
      error: { color: 'error', text: 'Error' },
    }
    const { color, text } = statusMap[status] || { color: 'default', text: status }
    return <Tag color={color}>{text}</Tag>
  }

  const getFileIcon = (docType: string) => {
    if (docType === 'pdf') return <FilePdfOutlined style={{ color: '#ff4d4f' }} />
    return <FileMarkdownOutlined style={{ color: '#1677ff' }} />
  }

  const columns = [
    {
      title: 'File',
      dataIndex: 'filename',
      key: 'filename',
      render: (filename: string, record: Document) => (
        <Space>
          {getFileIcon(record.doc_type)}
          <span>{filename}</span>
        </Space>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'doc_type',
      key: 'doc_type',
      render: (type: string) => type.toUpperCase(),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: getStatusTag,
    },
    {
      title: 'Pages/Lines',
      key: 'pages',
      render: (_: unknown, record: Document) => 
        record.page_count || record.line_count || '-',
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: unknown, record: Document) => (
        <Space>
          <Button
            icon={<EyeOutlined />}
            onClick={() => navigate(`/documents/${record.id}`)}
            disabled={record.status !== 'completed'}
          >
            View
          </Button>
          
          <Tooltip title="Reprocess with current AI model">
            <Button
              icon={<ReloadOutlined />}
              loading={reprocessingId === record.id}
              onClick={() => handleReprocess(record)}
              disabled={record.status === 'processing' || reprocessingId !== null}
            >
              Reprocess
            </Button>
          </Tooltip>
          
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record.id)}
          >
            Delete
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0 }}>Documents</Title>
          <Upload
            accept=".pdf,.md,.markdown"
            showUploadList={false}
            beforeUpload={() => false}
            onChange={(info) => {
              if (info.fileList.length > 0) {
                handleUpload(info.fileList)
              }
            }}
            multiple
          >
            <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
              Upload Documents
            </Button>
          </Upload>
        </div>
        
        <Table
          dataSource={documents}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </div>
  )
}

export default DocumentList
