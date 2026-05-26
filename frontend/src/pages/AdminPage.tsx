import { useState, useEffect } from 'react'
import { Card, Table, Tag, Typography, Tabs, Button, Modal, Form, Input, Select, Space, message, Popconfirm } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { adminApi } from '@/services/authApi'
import type { User, Role } from '@/types'

const { Title } = Typography

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(false)
  const [userModalOpen, setUserModalOpen] = useState(false)
  const [roleModalOpen, setRoleModalOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [selectedRole, setSelectedRole] = useState<Role | null>(null)
  const [allRoles, setAllRoles] = useState<Role[]>([])
  const [form] = Form.useForm()
  const [roleForm] = Form.useForm()

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [u, r] = await Promise.all([adminApi.listUsers(), adminApi.listRoles()])
      setUsers(u)
      setRoles(r)
      setAllRoles(r)
    } finally {
      setLoading(false)
    }
  }

  const userColumns = [
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    { title: '状态', dataIndex: 'is_active', key: 'is_active', render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? '活跃' : '禁用'}</Tag> },
    { title: '角色', dataIndex: 'roles', key: 'roles', render: (rs: string[]) => rs.map(r => <Tag key={r}>{r}</Tag>) },
    {
      title: '操作', key: 'action',
      render: (_: unknown, record: User) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openUserModal(record)} />
        </Space>
      )
    },
  ]

  const roleColumns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '描述', dataIndex: 'description', key: 'description' },
    { title: '类型', dataIndex: 'is_system', key: 'is_system', render: (v: boolean) => <Tag color={v ? 'blue' : 'default'}>{v ? '系统' : '自定义'}</Tag> },
    { title: '权限数', key: 'perm_count', render: (_: unknown, r: Role) => r.permissions?.length ?? 0 },
    {
      title: '操作', key: 'action',
      render: (_: unknown, record: Role) => (
        <Space>
          {!record.is_system && (
            <>
              <Button size="small" icon={<EditOutlined />} onClick={() => openRoleModal(record)} />
              <Popconfirm title="确定删除此角色?" onConfirm={() => deleteRole(record.id)} okText="确定" cancelText="取消">
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </>
          )}
        </Space>
      )
    },
  ]

  const openUserModal = (user?: User) => {
    setSelectedUser(user || null)
    form.setFieldsValue({
      roles: user?.roles || [],
    })
    setUserModalOpen(true)
  }

  const openRoleModal = (role?: Role) => {
    setSelectedRole(role || null)
    roleForm.setFieldsValue({
      name: role?.name || '',
      description: role?.description || '',
    })
    setRoleModalOpen(true)
  }

  const handleUserSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (selectedUser) {
        await adminApi.assignUserRoles(selectedUser.id, values.roles)
        message.success('用户角色已更新')
      }
      setUserModalOpen(false)
      loadData()
    } catch (e) {
      if (e !== 'cancel') message.error('操作失败')
    }
  }

  const handleRoleSubmit = async () => {
    try {
      const values = await roleForm.validateFields()
      if (selectedRole) {
        await adminApi.updateRole(selectedRole.id, values.name, values.description)
        message.success('角色已更新')
      } else {
        await adminApi.createRole(values.name, values.description)
        message.success('角色已创建')
      }
      setRoleModalOpen(false)
      loadData()
    } catch (e) {
      if (e !== 'cancel') message.error('操作失败')
    }
  }

  const deleteRole = async (roleId: string) => {
    try {
      await adminApi.deleteRole(roleId)
      message.success('角色已删除')
      loadData()
    } catch {
      message.error('删除失败')
    }
  }

  return (
    <div>
      <Title level={4}>管理后台</Title>
      <Card>
        <Tabs items={[
          {
            key: 'users',
            label: '用户管理',
            children: (
              <>
                <div style={{ marginBottom: 16 }}>
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openUserModal()}>
                    分配角色
                  </Button>
                </div>
                <Table columns={userColumns} dataSource={users} rowKey="id" loading={loading} />
              </>
            ),
          },
          {
            key: 'roles',
            label: '角色管理',
            children: (
              <>
                <div style={{ marginBottom: 16 }}>
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openRoleModal()}>
                    新建角色
                  </Button>
                </div>
                <Table columns={roleColumns} dataSource={roles} rowKey="id" loading={loading} />
              </>
            ),
          },
        ]} />
      </Card>

      <Modal
        title={selectedUser ? '编辑用户角色' : '分配角色'}
        open={userModalOpen}
        onOk={handleUserSubmit}
        onCancel={() => setUserModalOpen(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="角色" name="roles" rules={[{ required: true, message: '请选择角色' }]}>
            <Select mode="multiple" placeholder="选择角色">
              {allRoles.filter(r => !r.is_system || r.name === 'admin').map(r => (
                <Select.Option key={r.name} value={r.name}>{r.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={selectedRole ? '编辑角色' : '新建角色'}
        open={roleModalOpen}
        onOk={handleRoleSubmit}
        onCancel={() => setRoleModalOpen(false)}
      >
        <Form form={roleForm} layout="vertical">
          <Form.Item label="角色名称" name="name" rules={[{ required: true, message: '请输入角色名称' }]}>
            <Input placeholder="例如: moderator" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea placeholder="角色描述" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}