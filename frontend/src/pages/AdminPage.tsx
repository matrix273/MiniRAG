import { useState, useEffect } from 'react'
import { Card, Table, Tag, Typography, Tabs } from 'antd'
import { adminApi } from '@/services/authApi'
import type { User, Role } from '@/types'

const { Title } = Typography

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [u, r] = await Promise.all([adminApi.listUsers(), adminApi.listRoles()])
      setUsers(u)
      setRoles(r)
    } finally {
      setLoading(false)
    }
  }

  const userColumns = [
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    { title: '状态', dataIndex: 'is_active', key: 'is_active', render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? '活跃' : '禁用'}</Tag> },
    { title: '角色', dataIndex: 'roles', key: 'roles', render: (rs: string[]) => rs.map(r => <Tag key={r}>{r}</Tag>) },
  ]

  const roleColumns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '描述', dataIndex: 'description', key: 'description' },
    { title: '类型', dataIndex: 'is_system', key: 'is_system', render: (v: boolean) => <Tag color={v ? 'blue' : 'default'}>{v ? '系统' : '自定义'}</Tag> },
    { title: '权限数', key: 'perm_count', render: (_: unknown, r: Role) => r.permissions?.length ?? 0 },
  ]

  return (
    <div>
      <Title level={4}>管理后台</Title>
      <Card>
        <Tabs items={[
          {
            key: 'users',
            label: '用户管理',
            children: <Table columns={userColumns} dataSource={users} rowKey="id" loading={loading} />,
          },
          {
            key: 'roles',
            label: '角色管理',
            children: <Table columns={roleColumns} dataSource={roles} rowKey="id" loading={loading} />,
          },
        ]} />
      </Card>
    </div>
  )
}