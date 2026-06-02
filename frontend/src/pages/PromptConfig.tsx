import { useState, useEffect } from 'react'
import { Card, Tabs, Table, Button, Modal, Input, Form, Tag, Space, message, Popconfirm, Typography, InputNumber, Switch } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { promptApi, systemConfigApi } from '@/services/api'
import type { PromptConfig, SystemConfig } from '@/types'

const { Title, Text } = Typography
const { TextArea } = Input

const CATEGORIES = [
  { key: 'agent_system', label: 'Agent System', description: 'Agent behavior and tool usage policy' },
  { key: 'rag_template', label: 'RAG Template', description: 'RAG Q&A answer format requirements' },
]

// LLM 配置项
const LLM_CONFIG_KEYS = [
  'llm_default_model',
  'llm_vision_model',
  'llm_vision_enabled',
  'llm_api_base_url',
  'llm_dashscope_key',
  'llm_openai_key',
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
      message.error('Failed to load version history')
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
      message.error('Failed to load configurations')
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
      message.success('New version created and activated')
      setEditModalVisible(false)
      fetchVersions(activeCategory)
    } catch {
      message.error('Failed to save')
    }
  }

  const handleActivate = async (promptId: string) => {
    try {
      await promptApi.activate(activeCategory, promptId)
      message.success('Version switched')
      fetchVersions(activeCategory)
    } catch {
      message.error('Failed to switch')
    }
  }

  const handleDelete = async (promptId: string) => {
    try {
      await promptApi.delete(activeCategory, promptId)
      message.success('Deleted')
      fetchVersions(activeCategory)
    } catch {
      message.error('Failed to delete')
    }
  }

  const handleConfigUpdate = async (key: string, value: string) => {
    try {
      await systemConfigApi.update(key, value)
      message.success('Configuration updated')
      fetchConfigs()
    } catch {
      message.error('Failed to update')
    }
  }

  const versionColumns = [
    {
      title: 'Version',
      dataIndex: 'version',
      width: 80,
      render: (v: number) => `v${v}`,
    },
    {
      title: 'Name',
      dataIndex: 'name',
    },
    {
      title: 'Description',
      dataIndex: 'description',
      ellipsis: true,
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      width: 100,
      render: (active: boolean) =>
        active ? <Tag color="green" icon={<CheckCircleOutlined />}>Active</Tag> : <Tag>History</Tag>,
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      width: 180,
      render: (t: string) => new Date(t).toLocaleString(),
    },
    {
      title: 'Actions',
      width: 160,
      render: (_: unknown, record: PromptConfig) => (
        <Space>
          {!record.is_active && (
            <Button size="small" onClick={() => handleActivate(record.id)}>Switch</Button>
          )}
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          {!record.is_active && (
            <Popconfirm title="Confirm deletion?" onConfirm={() => handleDelete(record.id)}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  const configColumns = [
    { title: 'Parameter', dataIndex: 'key', width: 220 },
    { title: 'Description', dataIndex: 'description', width: 280 },
    {
      title: 'Current Value',
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
      title: 'Updated',
      dataIndex: 'updated_at',
      width: 180,
      render: (t: string) => new Date(t).toLocaleString(),
    },
  ]

  // LLM 配置专用列
  const llmConfigColumns = [
    { title: 'Parameter', dataIndex: 'key', width: 200 },
    { title: 'Description', dataIndex: 'description', width: 280 },
    {
      title: 'Current Value',
      dataIndex: 'value',
      render: (val: string, record: SystemConfig) => {
        // 布尔类型使用 Switch
        if (record.key.includes('enabled')) {
          return (
            <Switch
              checked={val === 'true'}
              onChange={(checked) => handleConfigUpdate(record.key, checked ? 'true' : 'false')}
              checkedChildren="Enabled"
              unCheckedChildren="Disabled"
            />
          )
        }
        // API Key 使用密码输入
        if (record.key.includes('key')) {
          return (
            <Input.Password
              value={val}
              placeholder={val ? '****' : 'Enter API Key'}
              onPressEnter={(e) => handleConfigUpdate(record.key, (e.target as HTMLInputElement).value)}
              style={{ width: 300 }}
            />
          )
        }
        // 其他使用普通输入
        return (
          <Input
            value={val}
            onPressEnter={(e) => handleConfigUpdate(record.key, (e.target as HTMLInputElement).value)}
            style={{ width: 300 }}
          />
        )
      },
    },
    {
      title: 'Updated',
      dataIndex: 'updated_at',
      width: 180,
      render: (t: string) => new Date(t).toLocaleString(),
    },
  ]

  return (
    <div style={{ maxWidth: 1200 }}>
      <Title level={3}>System Configuration</Title>

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
                  <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>New Version</Button>
                </div>
                <Table
                  dataSource={versions}
                  columns={versionColumns}
                  rowKey="id"
                  loading={loading}
                  pagination={false}
                />
                {versions.find(v => v.is_active) && (
                  <Card title="Currently Active Content" size="small" style={{ marginTop: 16 }}>
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
            label: 'Agent Parameters',
            children: (
              <Table
                dataSource={configs.filter(c => !LLM_CONFIG_KEYS.includes(c.key))}
                columns={configColumns}
                rowKey="key"
                loading={configLoading}
                pagination={false}
              />
            ),
          },
          {
            key: 'llm_config',
            label: 'LLM Configuration',
            children: (
              <>
                <div style={{ marginBottom: 16 }}>
                  <Text type="secondary">LLM Configuration - Uses LiteLLM to support multiple model providers (DashScope, OpenAI, etc.)</Text>
                </div>
                <Table
                  dataSource={configs.filter(c => LLM_CONFIG_KEYS.includes(c.key))}
                  columns={llmConfigColumns}
                  rowKey="key"
                  loading={configLoading}
                  pagination={false}
                />
              </>
            ),
          },
        ]}
      />

      <Modal
        title={editingPrompt ? `Edit v${editingPrompt.version}` : 'New Version'}
        open={editModalVisible}
        onOk={handleSave}
        onCancel={() => setEditModalVisible(false)}
        width={800}
        okText="Save"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Please enter a name' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="content" label="Content" rules={[{ required: true, message: 'Please enter content' }]}>
            <TextArea rows={16} style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item name="description" label="Change Description">
            <Input placeholder="Optional: describe this change" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default PromptConfigPage
