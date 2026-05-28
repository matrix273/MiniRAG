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
      title="创建 Markdown 文档"
      open={visible}
      onOk={handleCreate}
      onCancel={handleCancel}
      confirmLoading={loading}
      okText="创建"
      cancelText="取消"
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="filename"
          label="文件名"
          initialValue="untitled"
        >
          <Input addonAfter=".md" placeholder="输入文件名" />
        </Form.Item>
        <Form.Item
          name="folder_id"
          label="保存到知识库"
          initialValue={selectedFolderId}
        >
          <TreeSelect
            placeholder="选择知识库（可选）"
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
