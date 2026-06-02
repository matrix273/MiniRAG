import { useState } from 'react'
import { Form, Input, Button, Card, Typography, message, Space } from 'antd'
import { MailOutlined, UserOutlined, LockOutlined, ArrowLeftOutlined } from '@ant-design/icons'
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
      messageApi.success('Registration successful, please log in')
      navigate('/login')
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } }
      messageApi.error(error.response?.data?.detail || 'Registration failed')
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
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>Back to Home</Button>
            </div>
            <div style={{ textAlign: 'center' }}>
              <Title level={3} style={{ margin: 0 }}>RAG</Title>
              <Text type="secondary">Create New Account</Text>
            </div>
            <Form onFinish={onFinish} layout="vertical" size="large">
              <Form.Item name="email" rules={[{ required: true, type: 'email', message: 'Please enter a valid email' }]}>
                <Input prefix={<MailOutlined />} placeholder="Email" />
              </Form.Item>
              <Form.Item name="username" rules={[{ required: true, min: 2, message: 'Username must be at least 2 characters' }]}>
                <Input prefix={<UserOutlined />} placeholder="Username" />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, min: 6, message: 'Password must be at least 6 characters' }]}>
                <Input.Password prefix={<LockOutlined />} placeholder="Password" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading} block>
                  Register
                </Button>
              </Form.Item>
            </Form>
            <div style={{ textAlign: 'center' }}>
              <Text type="secondary">Already have an account?</Text>{' '}
              <Link to="/login">Log In</Link>
            </div>
          </Space>
        </Card>
      </div>
    </>
  )
}