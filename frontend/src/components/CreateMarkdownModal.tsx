import React, { useState } from 'react'
import { Modal, Input, TreeSelect, Form } from 'antd'
import { useNavigate } from 'react-router-dom'
import { documentApi } from '@/services/api'
import type { Folder } from '@/types'

interface CreateMarkdownModalProps {
  visible: boolean
  onClose: () => void
  folders: Folder[]
  selectedFolderId: string | null
}

const CreateMarkdownModal: React.FC<CreateMarkdownModalProps> = ({
  visible,
  onClose,
  folders,
  selectedFolderId
}) => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const convertToTreeData = (folders: Folder[]): any[] => {
    return folders.map(folder => ({
      title: folder.name,
      value: folder.id,
      key: folder.id,
      children: folder.children ? convertToTreeData(folder.children) : []
    }))
  }

  const handleCreate = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)

      const doc = await documentApi.createMarkdown({
        filename: values.filename || 'untitled.md',
        folder_id: values.folder_id || selectedFolderId
      })

      navigate(`/documents/${doc.id}/edit`)
      onClose()
      form.resetFields()
    } catch (error) {
      console.error('创建失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    form.resetFields()
    onClose()
  }

  return (
    <Modal
      title="Create Markdown Document"
      open={visible}
      onOk={handleCreate}
      onCancel={handleCancel}
      confirmLoading={loading}
      okText="Create"
      cancelText="Cancel"
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="filename"
          label="Filename"
          initialValue="untitled"
        >
          <Input addonAfter=".md" placeholder="Enter filename" />
        </Form.Item>
        <Form.Item
          name="folder_id"
          label="Save to Knowledge Base"
          initialValue={selectedFolderId}
        >
          <TreeSelect
            placeholder="Select knowledge base (optional)"
            treeData={convertToTreeData(folders)}
            allowClear
            treeDefaultExpandAll
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default CreateMarkdownModal
