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
    { title: 'Username', dataIndex: 'username', key: 'username' },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    { title: 'Status', dataIndex: 'is_active', key: 'is_active', render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? 'Active' : 'Disabled'}</Tag> },
    { title: 'Roles', dataIndex: 'roles', key: 'roles', render: (rs: string[]) => rs.map(r => <Tag key={r}>{r}</Tag>) },
    {
      title: 'Actions', key: 'action',
      render: (_: unknown, record: User) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openUserModal(record)} />
        </Space>
      )
    },
  ]

  const roleColumns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Description', dataIndex: 'description', key: 'description' },
    { title: 'Type', dataIndex: 'is_system', key: 'is_system', render: (v: boolean) => <Tag color={v ? 'blue' : 'default'}>{v ? 'System' : 'Custom'}</Tag> },
    { title: 'Permissions', key: 'perm_count', render: (_: unknown, r: Role) => r.permissions?.length ?? 0 },
    {
      title: 'Actions', key: 'action',
      render: (_: unknown, record: Role) => (
        <Space>
          {!record.is_system && (
            <>
              <Button size="small" icon={<EditOutlined />} onClick={() => openRoleModal(record)} />
              <Popconfirm title="Are you sure you want to delete this role?" onConfirm={() => deleteRole(record.id)} okText="OK" cancelText="Cancel">
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
        message.success('User roles updated')
      }
      setUserModalOpen(false)
      loadData()
    } catch (e) {
      if (e !== 'cancel') message.error('Operation failed')
    }
  }

  const handleRoleSubmit = async () => {
    try {
      const values = await roleForm.validateFields()
      if (selectedRole) {
        await adminApi.updateRole(selectedRole.id, values.name, values.description)
        message.success('Role updated')
      } else {
        await adminApi.createRole(values.name, values.description)
        message.success('Role created')
      }
      setRoleModalOpen(false)
      loadData()
    } catch (e) {
      if (e !== 'cancel') message.error('Operation failed')
    }
  }

  const deleteRole = async (roleId: string) => {
    try {
      await adminApi.deleteRole(roleId)
      message.success('Role deleted')
      loadData()
    } catch {
      message.error('Failed to delete')
    }
  }

  return (
    <div>
      <Title level={4}>Admin Panel</Title>
      <Card>
        <Tabs items={[
          {
            key: 'users',
            label: 'User Management',
            children: (
              <>
                <div style={{ marginBottom: 16 }}>
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openUserModal()}>
                    Assign Roles
                  </Button>
                </div>
                <Table columns={userColumns} dataSource={users} rowKey="id" loading={loading} />
              </>
            ),
          },
          {
            key: 'roles',
            label: 'Role Management',
            children: (
              <>
                <div style={{ marginBottom: 16 }}>
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openRoleModal()}>
                    New Role
                  </Button>
                </div>
                <Table columns={roleColumns} dataSource={roles} rowKey="id" loading={loading} />
              </>
            ),
          },
        ]} />
      </Card>

      <Modal
        title={selectedUser ? 'Edit User Roles' : 'Assign Roles'}
        open={userModalOpen}
        onOk={handleUserSubmit}
        onCancel={() => setUserModalOpen(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Roles" name="roles" rules={[{ required: true, message: 'Please select roles' }]}>
            <Select mode="multiple" placeholder="Select roles">
              {allRoles.filter(r => !r.is_system || r.name === 'admin').map(r => (
                <Select.Option key={r.name} value={r.name}>{r.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={selectedRole ? 'Edit Role' : 'New Role'}
        open={roleModalOpen}
        onOk={handleRoleSubmit}
        onCancel={() => setRoleModalOpen(false)}
      >
        <Form form={roleForm} layout="vertical">
          <Form.Item label="Role Name" name="name" rules={[{ required: true, message: 'Please enter role name' }]}>
            <Input placeholder="e.g. moderator" />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea placeholder="Role description" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}