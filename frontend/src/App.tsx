import { useEffect } from 'react'
import { Layout, Menu, Typography, App as AntApp, Dropdown, Space, Avatar } from 'antd'
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
import { healthApi } from '@/services/api'

const { Header, Content } = Layout
const { Title } = Typography

function AppContent() {
  const navigate = useNavigate()
  const location = useLocation()
  const { message } = AntApp.useApp()
  const { user, logout } = useAuth()
  const isPublicPage = ['/', '/login', '/register'].includes(location.pathname)

  useEffect(() => {
    healthApi.check()
      .then(() => console.log('Backend connected'))
      .catch(() => message.error('Backend not available'))
  }, [message])

  const menuItems = [
    { key: '/chat', icon: <MessageOutlined />, label: 'Chat' },
    { key: '/documents', icon: <FileTextOutlined />, label: 'Documents' },
    { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
  ]

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(key)
  }

  const userMenuItems = [
    ...(user?.roles?.includes('admin') ? [{ key: '/admin', icon: <CrownOutlined />, label: '管理后台' }] : []),
    { key: 'logout', icon: <LogoutOutlined />, label: '登出' },
  ]

  const handleUserMenu = async ({ key }: { key: string }) => {
    if (key === 'logout') {
      await logout()
      navigate('/login')
    } else if (key === '/admin') {
      navigate(key)
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
            PageIndex
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
          <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><PromptConfigPage /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute requiredRole="admin"><AdminPage /></ProtectedRoute>} />
        </Routes>
      </Content>
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