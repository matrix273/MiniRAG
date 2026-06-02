import { useEffect, useState } from 'react'
import { Layout, Menu, Typography, App as AntApp, Dropdown, Space, Avatar, Modal, Form, Input } from 'antd'
import { FileTextOutlined, MessageOutlined, SettingOutlined, UserOutlined, LogoutOutlined, CrownOutlined } from '@ant-design/icons'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { useAuth } from '@/hooks/useAuth'
import ProtectedRoute from '@/components/ProtectedRoute'
import DocumentList from './pages/DocumentList'
import DocumentDetail from './pages/DocumentDetail'
import ChatPage from './pages/ChatPage'
import PromptConfigPage from './pages/PromptConfig'
import LandingPage from './pages/LandingPage'
import Login from './pages/Login'
import Register from './pages/Register'
import AdminPage from './pages/AdminPage'
import DocumentEdit from './pages/DocumentEdit'
import { healthApi } from '@/services/api'
import { authApi } from '@/services/authApi'

const { Header, Content } = Layout
const { Title } = Typography

function AppContent() {
  const navigate = useNavigate()
  const location = useLocation()
  const { message: antMessage } = AntApp.useApp()
  const { user, logout } = useAuth()
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [passwordForm] = Form.useForm()
  const isPublicPage = ['/', '/login', '/register'].includes(location.pathname)

  useEffect(() => {
    healthApi.check()
      .then(() => console.log('Backend connected'))
      .catch(() => antMessage.error('Backend not available'))
  }, [antMessage])

  const menuItems = [
    { key: '/chat', icon: <MessageOutlined />, label: 'Chat' },
    { key: '/documents', icon: <FileTextOutlined />, label: 'Documents' },
    { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
  ]

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(key)
  }

  const userMenuItems = [
    ...(user?.roles?.includes('admin') ? [{ key: '/admin', icon: <CrownOutlined />, label: 'Admin Panel' }] : []),
    { key: 'change-password', icon: <UserOutlined />, label: 'Change Password' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Logout' },
  ]

  const handleUserMenu = async ({ key }: { key: string }) => {
    if (key === 'logout') {
      await logout()
      navigate('/login')
    } else if (key === '/admin') {
      navigate(key)
    } else if (key === 'change-password') {
      setPasswordModalOpen(true)
    }
  }

  const handlePasswordSubmit = async () => {
    try {
      const values = await passwordForm.validateFields()
      await authApi.changePassword(values.old_password, values.new_password)
      antMessage.success('Password changed successfully')
      setPasswordModalOpen(false)
      passwordForm.resetFields()
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'response' in e) {
        const err = e as { response?: { data?: { detail?: string } } }
        antMessage.error(err.response?.data?.detail || 'Change failed')
      } else {
        antMessage.error('Change failed')
      }
    }
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isPublicPage && user && (
        <Header
          style={{
            display: 'flex',
            alignItems: 'center',
            background: '#fff',
            borderBottom: '1px solid #f0f0f0',
            padding: '0 48px',
            position: 'sticky',
            top: 0,
            zIndex: 100,
          }}
        >
          <Title level={4} style={{ margin: 0, marginRight: 48, whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => navigate('/')}>
            RAG
          </Title>
          <Menu
            mode="horizontal"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={handleMenuClick}
            style={{ flex: 1, borderBottom: 'none' }}
          />
          <Dropdown menu={{ items: userMenuItems, onClick: handleUserMenu }} placement="bottomRight">
            <Space style={{ cursor: 'pointer' }}>
              <Avatar icon={<UserOutlined />} />
              <span>{user.username}</span>
            </Space>
          </Dropdown>
        </Header>
      )}

      <Content style={isPublicPage ? {} : { padding: '24px 48px', background: '#f5f5f5', minHeight: 'calc(100vh - 64px)' }}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/documents" element={<ProtectedRoute><DocumentList /></ProtectedRoute>} />
          <Route path="/documents/:id" element={<ProtectedRoute><DocumentDetail /></ProtectedRoute>} />
          <Route path="/documents/:id/edit" element={<ProtectedRoute><DocumentEdit /></ProtectedRoute>} />
          <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><PromptConfigPage /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute requiredRole="admin"><AdminPage /></ProtectedRoute>} />
        </Routes>
      </Content>

      <Modal
        title="Change Password"
        open={passwordModalOpen}
        onOk={handlePasswordSubmit}
        onCancel={() => { setPasswordModalOpen(false); passwordForm.resetFields() }}
        okText="Confirm"
        cancelText="Cancel"
      >
        <Form form={passwordForm} layout="vertical">
          <Form.Item name="old_password" label="Current Password" rules={[{ required: true, message: 'Please enter current password' }]}>
            <Input.Password placeholder="Current password" />
          </Form.Item>
          <Form.Item name="new_password" label="New Password" rules={[{ required: true, message: 'Please enter new password' }, { min: 6, message: 'Password must be at least 6 characters' }]}>
            <Input.Password placeholder="New password" />
          </Form.Item>
          <Form.Item name="confirm_password" label="Confirm New Password" dependencies={['new_password']} rules={[{ required: true, message: 'Please confirm new password' }, ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('new_password') === value) {
                return Promise.resolve()
              }
              return Promise.reject(new Error('Passwords do not match'))
            },
          })]}>
            <Input.Password placeholder="Confirm new password" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  )
}

function App() {
  return (
    <AuthProvider>
      <AntApp>
        <AppContent />
      </AntApp>
    </AuthProvider>
  )
}

export default App