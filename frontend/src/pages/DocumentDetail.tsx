import { useState, useEffect } from 'react'
import { Card, Descriptions, Tag, Tree, message, Button, Space, Spin, Typography, Tabs } from 'antd'
import { ArrowLeftOutlined, MessageOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import { documentApi, chatApi } from '@/services/api'
import type { Document, TreeNode } from '@/types'
import OfficeViewer from '@/components/OfficeViewer'

const { Title, Text } = Typography
const { DirectoryTree } = Tree

const DocumentDetail = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [document, setDocument] = useState<Document | null>(null)
  const [structure, setStructure] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [structureLoading, setStructureLoading] = useState(false)

  useEffect(() => {
    if (id) {
      fetchDocument()
    }
  }, [id])

  const fetchDocument = async () => {
    setLoading(true)
    try {
      const doc = await documentApi.get(id!)
      setDocument(doc)
      
      // Fetch structure if document is completed
      if (doc.status === 'completed') {
        fetchStructure()
      }
    } catch (error) {
      message.error('Failed to fetch document')
    } finally {
      setLoading(false)
    }
  }

  const fetchStructure = async () => {
    setStructureLoading(true)
    try {
      const data = await documentApi.getStructure(id!)
      setStructure(data.structure)
    } catch (error) {
      message.error('Failed to fetch structure')
    } finally {
      setStructureLoading(false)
    }
  }

  const handleCreateChat = async () => {
    try {
      const session = await chatApi.createSession(id!, `Chat about ${document?.filename}`)
      navigate('/chat', { state: { sessionId: session.id, documentId: id } })
    } catch (error) {
      message.error('Failed to create chat session')
    }
  }

  const getStatusTag = (status: string) => {
    const statusMap: Record<string, string> = {
      pending: 'default',
      processing: 'processing',
      completed: 'success',
      error: 'error',
    }
    return <Tag color={statusMap[status] || 'default'}>{status.toUpperCase()}</Tag>
  }

  const buildTreeData = (nodes: TreeNode[]): any[] => {
    return nodes.map((node, index) => ({
      title: (
        <div>
          <Text strong>{node.title}</Text>
          {node.summary && (
            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              {node.summary.slice(0, 100)}...
            </Text>
          )}
          {node.start_index && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              Pages: {node.start_index}-{node.end_index}
            </Text>
          )}
        </div>
      ),
      key: node.node_id || `node-${index}`,
      children: node.nodes ? buildTreeData(node.nodes) : [],
    }))
  }

  const tabItems = [
    {
      key: 'info',
      label: 'Document Info',
      children: (
        <Descriptions bordered column={2}>
          <Descriptions.Item label="Filename">{document?.filename}</Descriptions.Item>
          <Descriptions.Item label="Type">{document?.doc_type?.toUpperCase()}</Descriptions.Item>
          <Descriptions.Item label="Status">{getStatusTag(document?.status || '')}</Descriptions.Item>
          <Descriptions.Item label="Pages/Lines">
            {document?.page_count || document?.line_count || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Description" span={2}>
            {document?.doc_description || 'No description available'}
          </Descriptions.Item>
          <Descriptions.Item label="Created">{document?.created_at}</Descriptions.Item>
          <Descriptions.Item label="Updated">{document?.updated_at || '-'}</Descriptions.Item>
        </Descriptions>
      ),
    },
    {
      key: 'structure',
      label: 'Tree Structure',
      children: (
        structureLoading ? (
          <Spin tip="Loading structure..." />
        ) : structure.length > 0 ? (
          <DirectoryTree
            treeData={buildTreeData(structure)}
            defaultExpandAll
            style={{ background: '#f5f5f5', padding: 16 }}
          />
        ) : (
          <Text type="secondary">No structure available</Text>
        )
      ),
    },
    ...(['docx', 'xlsx', 'pptx'].includes(document?.doc_type || '') ? [{
      key: 'preview',
      label: 'Preview',
      children: (
        <OfficeViewer
          fileUrl={`/api/documents/${id}/file`}
          fileType={document!.doc_type as 'docx' | 'xlsx' | 'pptx'}
        />
      ),
    }] : []),
  ]

  if (loading) {
    return <Spin tip="Loading document..." style={{ display: 'block', marginTop: 100 }} />
  }

  return (
    <div>
      <Card>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/documents')}>
              Back
            </Button>
            <Title level={3} style={{ margin: 0 }}>
              {document?.filename}
            </Title>
            <Button
              type="primary"
              icon={<MessageOutlined />}
              onClick={handleCreateChat}
              disabled={document?.status !== 'completed'}
            >
              Start Chat
            </Button>
          </div>

          <Tabs items={tabItems} defaultActiveKey="info" />
        </Space>
      </Card>
    </div>
  )
}

export default DocumentDetail
