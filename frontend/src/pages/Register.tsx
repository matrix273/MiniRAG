import { useState } from 'react'
import { Form, Input, Button, Card, Typography, message, Space } from 'antd'
import { MailOutlined, UserOutlined, LockOutlined } from '@ant-design/icons'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

const { Title, Text } = Typography

export default function Register() {
  const [loading, setLoading] = useState(false)
  const { register } = useAuth()
  const navigate = useNavigate()
  const [messageApi, contextHolder] = message.useMessage()

  const onFinish = async (values: { email: string; username: string; password: string }) => {
    setLoading(true)
    try {
      await register(values.email, values.username, values.password)
      messageApi.success('注册成功，请登录')
      navigate('/login')
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } }
      messageApi.error(error.response?.data?.detail || '注册失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f0f2f5' }}>
        <Card style={{ width: 400 }}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div style={{ textAlign: 'center' }}>
              <Title level={3} style={{ margin: 0 }}>PageIndex</Title>
              <Text type="secondary">创建新账号</Text>
            </div>
            <Form onFinish={onFinish} layout="vertical" size="large">
              <Form.Item name="email" rules={[{ required: true, type: 'email', message: '请输入有效的邮箱' }]}>
                <Input prefix={<MailOutlined />} placeholder="邮箱" />
              </Form.Item>
              <Form.Item name="username" rules={[{ required: true, min: 2, message: '用户名至少2个字符' }]}>
                <Input prefix={<UserOutlined />} placeholder="用户名" />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, min: 6, message: '密码至少6个字符' }]}>
                <Input.Password prefix={<LockOutlined />} placeholder="密码" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading} block>
                  注册
                </Button>
              </Form.Item>
            </Form>
            <div style={{ textAlign: 'center' }}>
              <Text type="secondary">已有账号？</Text>{' '}
              <Link to="/login">立即登录</Link>
            </div>
          </Space>
        </Card>
      </div>
    </>
  )
}