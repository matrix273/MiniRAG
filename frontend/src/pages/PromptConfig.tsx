import { useState, useEffect } from 'react'
import { Card, Tabs, Table, Button, Modal, Input, Form, Tag, Space, message, Popconfirm, Typography, InputNumber } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { promptApi, systemConfigApi } from '@/services/api'
import type { PromptConfig, SystemConfig } from '@/types'

const { Title, Text } = Typography
const { TextArea } = Input

const CATEGORIES = [
  { key: 'agent_system', label: 'Agent System', description: 'Agent 行为和工具使用策略' },
  { key: 'rag_template', label: 'RAG Template', description: 'RAG 问答答案格式要求' },
]

const PromptConfigPage = () => {
  const [activeCategory, setActiveCategory] = useState('agent_system')
  const [versions, setVersions] = useState<PromptConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<PromptConfig | null>(null)
  const [form] = Form.useForm()

  const [configs, setConfigs] = useState<SystemConfig[]>([])
  const [configLoading, setConfigLoading] = useState(false)

  useEffect(() => {
    fetchVersions(activeCategory)
    fetchConfigs()
  }, [activeCategory])

  const fetchVersions = async (category: string) => {
    setLoading(true)
    try {
      const data = await promptApi.listVersions(category)
      setVersions(data)
    } catch {
      message.error('加载版本历史失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchConfigs = async () => {
    setConfigLoading(true)
    try {
      const data = await systemConfigApi.list()
      setConfigs(data)
    } catch {
      message.error('加载配置失败')
    } finally {
      setConfigLoading(false)
    }
  }

  const handleCreate = () => {
    setEditingPrompt(null)
    form.resetFields()
    setEditModalVisible(true)
  }

  const handleEdit = (prompt: PromptConfig) => {
    setEditingPrompt(prompt)
    form.setFieldsValue({
      name: prompt.name,
      content: prompt.content,
      description: prompt.description,
    })
    setEditModalVisible(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      await promptApi.create(activeCategory, values.name, values.content, values.description)
      message.success('新版本已创建并激活')
      setEditModalVisible(false)
      fetchVersions(activeCategory)
    } catch {
      message.error('保存失败')
    }
  }

  const handleActivate = async (promptId: string) => {
    try {
      await promptApi.activate(activeCategory, promptId)
      message.success('已切换版本')
      fetchVersions(activeCategory)
    } catch {
      message.error('切换失败')
    }
  }

  const handleDelete = async (promptId: string) => {
    try {
      await promptApi.delete(activeCategory, promptId)
      message.success('已删除')
      fetchVersions(activeCategory)
    } catch {
      message.error('删除失败')
    }
  }

  const handleConfigUpdate = async (key: string, value: string) => {
    try {
      await systemConfigApi.update(key, value)
      message.success('配置已更新')
      fetchConfigs()
    } catch {
      message.error('更新失败')
    }
  }

  const versionColumns = [
    {
      title: '版本',
      dataIndex: 'version',
      width: 80,
      render: (v: number) => `v${v}`,
    },
    {
      title: '名称',
      dataIndex: 'name',
    },
    {
      title: '说明',
      dataIndex: 'description',
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 100,
      render: (active: boolean) =>
        active ? <Tag color="green" icon={<CheckCircleOutlined />}>当前</Tag> : <Tag>历史</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 180,
      render: (t: string) => new Date(t).toLocaleString(),
    },
    {
      title: '操作',
      width: 160,
      render: (_: unknown, record: PromptConfig) => (
        <Space>
          {!record.is_active && (
            <Button size="small" onClick={() => handleActivate(record.id)}>切换</Button>
          )}
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          {!record.is_active && (
            <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  const configColumns = [
    { title: '参数', dataIndex: 'key', width: 220 },
    { title: '说明', dataIndex: 'description', width: 280 },
    {
      title: '当前值',
      dataIndex: 'value',
      render: (val: string, record: SystemConfig) => (
        <Space>
          {record.key.includes('turns') || record.key.includes('tokens') || record.key.includes('seconds') ? (
            <InputNumber
              value={parseInt(val)}
              min={1}
              max={record.key === 'agent_max_tokens' ? 8192 : 300}
              onChange={(v) => v !== null && handleConfigUpdate(record.key, String(v))}
              style={{ width: 120 }}
            />
          ) : (
            <Input
              value={val}
              onPressEnter={(e) => handleConfigUpdate(record.key, (e.target as HTMLInputElement).value)}
              style={{ width: 200 }}
            />
          )}
        </Space>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 180,
      render: (t: string) => new Date(t).toLocaleString(),
    },
  ]

  return (
    <div style={{ maxWidth: 1200 }}>
      <Title level={3}>系统配置</Title>

      <Tabs
        activeKey={activeCategory}
        onChange={setActiveCategory}
        items={[
          ...CATEGORIES.map(cat => ({
            key: cat.key,
            label: cat.label,
            children: (
              <>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text type="secondary">{cat.description}</Text>
                  <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新建版本</Button>
                </div>
                <Table
                  dataSource={versions}
                  columns={versionColumns}
                  rowKey="id"
                  loading={loading}
                  pagination={false}
                />
                {versions.find(v => v.is_active) && (
                  <Card title="当前生效内容" size="small" style={{ marginTop: 16 }}>
                    <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 13 }}>
                      {versions.find(v => v.is_active)?.content}
                    </pre>
                  </Card>
                )}
              </>
            ),
          })),
          {
            key: 'agent_params',
            label: 'Agent 参数',
            children: (
              <Table
                dataSource={configs}
                columns={configColumns}
                rowKey="key"
                loading={configLoading}
                pagination={false}
              />
            ),
          },
        ]}
      />

      <Modal
        title={editingPrompt ? `编辑 v${editingPrompt.version}` : '新建版本'}
        open={editModalVisible}
        onOk={handleSave}
        onCancel={() => setEditModalVisible(false)}
        width={800}
        okText="保存"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true, message: '请输入内容' }]}>
            <TextArea rows={16} style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item name="description" label="变更说明">
            <Input placeholder="可选：描述本次变更" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default PromptConfigPage
