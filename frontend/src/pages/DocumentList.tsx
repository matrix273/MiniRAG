import { useState, useEffect, useRef, useMemo } from 'react'
import { Card, Table, Button, Upload, Tag, Space, Typography, App, Tooltip, Layout, Tree, Input, Modal, Dropdown, Select, List } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import type { DataNode } from 'antd/es/tree'
import {
  UploadOutlined,
  EyeOutlined,
  DeleteOutlined,
  FilePdfOutlined,
  FileMarkdownOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
  FolderOutlined,
  FolderAddOutlined,
  EditOutlined,
  FolderOpenOutlined,
  SwapOutlined,
  InboxOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { documentApi, folderApi } from '@/services/api'
import type { Document, Folder } from '@/types'
import dayjs from 'dayjs'

const { Title } = Typography
const { Sider, Content } = Layout

const getFileKey = (file: File) => `${file.name}-${file.size}`

function collectAllKeys(folders: Folder[]): string[] {
  const keys: string[] = []
  for (const f of folders) {
    keys.push(f.id)
    if (f.children?.length) keys.push(...collectAllKeys(f.children))
  }
  return keys
}

function buildFolderSelectItems(folders: Folder[], prefix = ''): { label: string; value: string }[] {
  const items: { label: string; value: string }[] = []
  for (const folder of folders) {
    items.push({ label: `${prefix}${folder.name}`, value: folder.id })
    if (folder.children?.length) {
      items.push(...buildFolderSelectItems(folder.children, `${prefix}${folder.name}/`))
    }
  }
  return items
}

const DocumentList = () => {
  const { modal, message } = App.useApp()
  const [documents, setDocuments] = useState<Document[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [reprocessingId, setReprocessingId] = useState<string | null>(null)
  const navigate = useNavigate()
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([])
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<UploadFile[]>([])
  const [uploadFolderId, setUploadFolderId] = useState<string | null>(null)

  const prevStatusesRef = useRef<Record<string, string>>({})

  const fetchFolders = async () => {
    try {
      const data = await folderApi.list()
      setFolders(data)
    } catch {
      message.error('Failed to fetch folders')
    }
  }

  const fetchDocuments = async () => {
    setLoading(true)
    try {
      const data = await documentApi.list(selectedFolderId ?? undefined)

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
    } catch {
      message.error('Failed to fetch documents')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFolders()
  }, [])

  useEffect(() => {
    fetchDocuments()
  }, [selectedFolderId])

  useEffect(() => {
    const hasProcessingDocs = documents.some(
      doc => doc.status === 'pending' || doc.status === 'processing'
    )

    if (!hasProcessingDocs) return

    const interval = setInterval(() => {
      fetchDocuments()
    }, 3000)

    return () => clearInterval(interval)
  }, [documents])

  const handleUpload = async (fileList: UploadFile[]) => {
    console.log('handleUpload called with:', fileList.map(f => ({ name: f.name, originFileObj: f.originFileObj })))
    if (fileList.length === 0) return

    const newFiles = fileList
      .filter(f => f.originFileObj)
      .map(f => f.originFileObj as File)

    console.log('filtered files:', newFiles.map(f => f.name))
    if (newFiles.length === 0) {
      message.info('No valid files to upload')
      return
    }

    setUploading(true)
    try {
      const result = await documentApi.uploadMultiple(newFiles, uploadFolderId || undefined)

      if (result.total_uploaded > 0) {
        message.success(`Uploaded ${result.total_uploaded} document(s)`)
      }
      if (result.errors && result.errors.length > 0) {
        result.errors.forEach((err: string) => message.warning(err))
      }

      fetchDocuments()
    } catch {
      message.error('Failed to upload documents')
    } finally {
      setUploading(false)
    }
  }

  const showUploadModal = () => {
    setPendingFiles([])
    setUploadFolderId(selectedFolderId)
    setUploadModalOpen(true)
  }

  const handleUploadModalOk = async () => {
    if (pendingFiles.length === 0) {
      message.info('Please select files to upload')
      return
    }
    await handleUpload(pendingFiles)
    setUploadModalOpen(false)
    setPendingFiles([])
  }

  const handleUploadModalCancel = () => {
    setUploadModalOpen(false)
    setPendingFiles([])
  }

  const handleFileRemove = (file: UploadFile) => {
    setPendingFiles(prev => prev.filter(f => f.uid !== file.uid))
  }

  const handleCreateFolder = (parentId?: string) => {
    let inputName = ''
    Modal.confirm({
      title: 'Create Folder',
      content: (
        <Input
          placeholder="Folder name"
          onChange={e => { inputName = e.target.value }}
          autoFocus
        />
      ),
      onOk: async () => {
        if (!inputName.trim()) {
          message.error('Folder name is required')
          return
        }
        try {
          await folderApi.create(inputName.trim(), parentId)
          message.success('Folder created')
          fetchFolders()
        } catch {
          message.error('Failed to create folder')
        }
      },
    })
  }

  const handleRenameFolder = (folderId: string, currentName: string) => {
    let inputName = currentName
    Modal.confirm({
      title: 'Rename Folder',
      content: (
        <Input
          defaultValue={currentName}
          placeholder="Folder name"
          onChange={e => { inputName = e.target.value }}
          autoFocus
        />
      ),
      onOk: async () => {
        if (!inputName.trim()) {
          message.error('Folder name is required')
          return
        }
        try {
          await folderApi.rename(folderId, inputName.trim())
          message.success('Folder renamed')
          fetchFolders()
        } catch {
          message.error('Failed to rename folder')
        }
      },
    })
  }

  const handleDeleteFolder = (folderId: string, folderName: string) => {
    modal.confirm({
      title: 'Delete Folder?',
      icon: <ExclamationCircleOutlined />,
      content: `This will delete "${folderName}" and all its contents.`,
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          await folderApi.delete(folderId)
          message.success('Folder deleted')
          if (selectedFolderId === folderId) {
            setSelectedFolderId(null)
            setSelectedKeys([])
          }
          fetchFolders()
          fetchDocuments()
        } catch {
          message.error('Failed to delete folder')
        }
      },
    })
  }

  const handleMoveDocument = async (docId: string, folderId: string | null) => {
    try {
      await documentApi.move(docId, folderId)
      message.success('Document moved')
      fetchDocuments()
      fetchFolders()
    } catch {
      message.error('Failed to move document')
    }
  }

  const handleMoveSelected = (folderId: string) => {
    selectedDocIds.forEach(docId => handleMoveDocument(docId, folderId || null))
    setSelectedDocIds([])
  }

  const handleSelect = (selectedKeys: React.Key[]) => {
    setSelectedKeys(selectedKeys)
    if (selectedKeys.length > 0) {
      const key = selectedKeys[0] as string
      if (key === 'root') {
        setSelectedFolderId(null)
      } else {
        const isDoc = documents.some(d => d.id === key)
        if (!isDoc) {
          setSelectedFolderId(key)
        }
      }
    } else {
      setSelectedFolderId(null)
    }
  }

  const handleDragOver = (info: { node: DataNode }) => {
    const nodeKey = info.node.key as string
    if (nodeKey !== 'root') {
      setDragOverKey(nodeKey)
    }
  }

  const handleExpand = (keys: React.Key[]) => {
    setExpandedKeys(keys)
  }

  const handleDragLeave = () => {
    setDragOverKey(null)
  }

  const handleTreeDrop = (info: any) => {
    setDragOverKey(null)
    const dropTargetKey = info.node.key as string
    const dragKey = info.dragNode.key as string

    // 检查拖动的是文件还是文件夹
    const isDragFile = documents.some(d => d.id === dragKey)
    const isDragFolder = folders.some(f => f.id === dragKey)

    if (isDragFile) {
      // 移动文件到目标文件夹
      // 如果目标是文件或root，移动到root；否则移动到目标文件夹
      const isTargetFolder = folders.some(f => f.id === dropTargetKey)
      const isTargetRoot = dropTargetKey === 'root'
      const targetFolderId = isTargetRoot || !isTargetFolder ? null : dropTargetKey
      handleMoveDocument(dragKey, targetFolderId)
    } else if (isDragFolder) {
      // 移动文件夹
      // 如果目标是文件或root，移动到root；否则移动到目标文件夹
      const isTargetFolder = folders.some(f => f.id === dropTargetKey)
      const isTargetRoot = dropTargetKey === 'root'
      const targetFolderId = isTargetRoot || !isTargetFolder ? null : dropTargetKey
      folderApi.move(dragKey, targetFolderId).then(() => {
        message.success('Folder moved')
        fetchFolders()
      }).catch(() => {
        message.error('Failed to move folder')
      })
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
        } catch {
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
          setSelectedDocIds(prev => prev.filter(i => i !== id))
          fetchDocuments()
        } catch {
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

  const allKeys = useMemo(() => {
    const keys = collectAllKeys(folders)
    keys.push('root')
    return keys
  }, [folders])

  const folderSelectItems = useMemo(() => buildFolderSelectItems(folders), [folders])

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

  const treeData = useMemo(() => {
    const buildNodes = (flds: Folder[], docs: Document[]): DataNode[] => {
      return flds.map(folder => {
        const isOver = dragOverKey === folder.id
        return {
          key: folder.id,
          title: (
            <span style={{ backgroundColor: isOver ? '#e6f7ff' : undefined, padding: '2px 4px', borderRadius: 4 }}>
              {folder.name}
            </span>
          ),
          icon: <FolderOutlined />,
          children: [
            ...buildNodes(folder.children || [], docs),
            ...docs
              .filter(d => d.folder_id === folder.id)
              .map(d => ({
                key: d.id,
                title: d.filename,
                icon: d.doc_type === 'pdf' ? <FilePdfOutlined style={{ color: '#ff4d4f' }} /> : <FileMarkdownOutlined style={{ color: '#1677ff' }} />,
                isLeaf: true,
              })),
          ],
        }
      })
    }

    const folderNodes = buildNodes(folders, documents)
    const rootDocs = documents
      .filter(d => !d.folder_id)
      .map(d => ({
        key: d.id,
        title: d.filename,
        icon: d.doc_type === 'pdf' ? <FilePdfOutlined style={{ color: '#ff4d4f' }} /> : <FileMarkdownOutlined style={{ color: '#1677ff' }} />,
        isLeaf: true,
      }))

    return [...folderNodes, ...rootDocs]
  }, [folders, documents, dragOverKey])

  const rootDataNode = useMemo(() => {
    return [
      {
        key: 'root',
        title: 'All Documents',
        icon: <FolderOpenOutlined />,
        children: treeData,
      },
    ]
  }, [treeData])

  return (
    <Layout style={{ minHeight: '100%', background: '#fff' }}>
      <Sider
        width={260}
        style={{
          background: '#fff',
          borderRight: '1px solid #f0f0f0',
          padding: '16px 8px',
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, padding: '0 8px' }}>
          <Title level={5} style={{ margin: 0, fontSize: 14 }}>Folders</Title>
          <Button
            type="text"
            icon={<FolderAddOutlined />}
            onClick={() => handleCreateFolder(selectedFolderId ?? undefined)}
            size="small"
          />
        </div>
        <Tree
          treeData={rootDataNode}
          selectedKeys={selectedKeys}
          onSelect={handleSelect}
          expandedKeys={expandedKeys.length > 0 ? expandedKeys : allKeys}
          onExpand={handleExpand}
          showIcon
          style={{ fontSize: 13 }}
          blockNode
          draggable
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleTreeDrop}
        />
      </Sider>
      <Content style={{ padding: '16px 24px' }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Title level={4} style={{ margin: 0 }}>
              {selectedFolderId ? `Documents in ${folders.find(f => f.id === selectedFolderId)?.name || 'folder'}` : 'All Documents'}
            </Title>
            <Space>
              {selectedDocIds.length > 0 && (
                <Dropdown
                  menu={{
                    items: [
                      { key: 'root', label: 'Root Directory', onClick: () => handleMoveSelected('') },
                      ...folderSelectItems.map(item => ({
                        key: item.value,
                        label: item.label,
                        onClick: () => handleMoveSelected(item.value),
                      })),
                    ],
                  }}
                  trigger={['click']}
                >
                  <Button icon={<SwapOutlined />}>
                    Move ({selectedDocIds.length})
                  </Button>
                </Dropdown>
              )}
              {selectedFolderId && (
                <>
                  <Button
                    icon={<EditOutlined />}
                    onClick={() => handleRenameFolder(selectedFolderId, folders.find(f => f.id === selectedFolderId)?.name || '')}
                  >
                    Rename
                  </Button>
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleDeleteFolder(selectedFolderId, folders.find(f => f.id === selectedFolderId)?.name || '')}
                  >
                    Delete Folder
                  </Button>
                </>
              )}
              <Button type="primary" icon={<UploadOutlined />} loading={uploading} onClick={showUploadModal}>
                Upload
              </Button>
            </Space>
          </div>

          <Modal
            title="Upload Documents"
            open={uploadModalOpen}
            onOk={handleUploadModalOk}
            onCancel={handleUploadModalCancel}
            okText="Upload"
            cancelText="Cancel"
            width={500}
            okButtonProps={{ loading: uploading }}
          >
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8 }}>Select folder:</label>
              <Select
                style={{ width: '100%' }}
                value={uploadFolderId}
                onChange={setUploadFolderId}
                allowClear
                placeholder="Root Directory"
                options={[
                  { value: '', label: 'Root Directory' },
                  ...folderSelectItems.map(item => ({
                    value: item.value,
                    label: item.label,
                  })),
                ]}
              />
            </div>
            <Upload.Dragger
              accept=".pdf,.md,.markdown"
              showUploadList={false}
              beforeUpload={(file) => {
                const uploadFile = { uid: file.uid, name: file.name, originFileObj: file } as UploadFile
                setPendingFiles(prev => [...prev, uploadFile])
                return false
              }}
              multiple
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">Click or drag files to this area</p>
              <p className="ant-upload-hint">Support for PDF, Markdown files</p>
            </Upload.Dragger>
            {pendingFiles.length > 0 && (
              <List
                style={{ marginTop: 16 }}
                size="small"
                dataSource={pendingFiles}
                renderItem={(file) => (
                  <List.Item
                    actions={[
                      <Button
                        key="remove"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleFileRemove(file)}
                      />,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={file.type?.includes('pdf') ? <FilePdfOutlined style={{ color: '#ff4d4f' }} /> : <FileMarkdownOutlined style={{ color: '#1677ff' }} />}
                      title={file.name}
                    />
                  </List.Item>
                )}
              />
            )}
          </Modal>

          <Table
            dataSource={documents}
            columns={columns}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 10 }}
            rowSelection={{
              selectedRowKeys: selectedDocIds,
              onChange: (keys) => setSelectedDocIds(keys as string[]),
            }}
          />
        </Card>
      </Content>
    </Layout>
  )
}

export default DocumentList
