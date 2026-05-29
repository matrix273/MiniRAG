import { useState, useEffect } from 'react'
import { Layout, Menu, Typography, message } from 'antd'
import { FileTextOutlined, MessageOutlined, SettingOutlined } from '@ant-design/icons'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import DocumentList from './pages/DocumentList'
import DocumentDetail from './pages/DocumentDetail'
import ChatPage from './pages/ChatPage'
import { healthApi } from '@/services/api'

const { Header, Content } = Layout
const { Title } = Typography

function App() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    healthApi.check()
      .then(() => console.log('Backend connected'))
      .catch(() => message.error('Backend not available'))
  }, [])

  const menuItems = [
    {
      key: '/chat',
      icon: <MessageOutlined />,
      label: 'Chat',
    },
    {
      key: '/documents',
      icon: <FileTextOutlined />,
      label: 'Documents',
    },
    {
      key: '/settings',
      icon: <SettingOutlined />,
      label: 'Settings',
    },
  ]

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(key)
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
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
        <Title level={4} style={{ margin: 0, marginRight: 48, whiteSpace: 'nowrap' }}>
          PageIndex
        </Title>
        <Menu
          mode="horizontal"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={handleMenuClick}
          style={{ flex: 1, borderBottom: 'none' }}
        />
      </Header>
      
      <Content style={{ padding: '24px 48px', background: '#f5f5f5', minHeight: 'calc(100vh - 64px)' }}>
        <Routes>
          <Route path="/" element={<Navigate to="/documents" replace />} />
          <Route path="/documents" element={<DocumentList />} />
          <Route path="/documents/:id" element={<DocumentDetail />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/settings" element={<div>Settings (TODO)</div>} />
        </Routes>
      </Content>
    </Layout>
  )
}

export default App
