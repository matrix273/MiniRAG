import { useState } from 'react'
import { Form, Input, Button, Card, Typography, message, Space } from 'antd'
import { MailOutlined, LockOutlined, ArrowLeftOutlined } from '@ant-design/icons'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

const { Title, Text } = Typography

export default function Login() {
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()
  const [messageApi, contextHolder] = message.useMessage()

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true)
    try {
      await login(values.email, values.password)
      navigate('/documents')
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } }
      messageApi.error(error.response?.data?.detail || 'Login failed')
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
              <Text type="secondary">Log in to your account</Text>
            </div>
            <Form onFinish={onFinish} layout="vertical" size="large">
              <Form.Item name="email" rules={[{ required: true, message: 'Please enter email or username' }]}>
                <Input prefix={<MailOutlined />} placeholder="Email or username" />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, message: 'Please enter password' }]}>
                <Input.Password prefix={<LockOutlined />} placeholder="Password" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading} block>
                  Login
                </Button>
              </Form.Item>
            </Form>
            <div style={{ textAlign: 'center' }}>
              <Text type="secondary">Don't have an account?</Text>{' '}
              <Link to="/register">Register Now</Link>
            </div>
          </Space>
        </Card>
      </div>
    </>
  )
}