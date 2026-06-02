import { Button, Typography, Space, Row, Col } from 'antd'
import { FileTextOutlined, MessageOutlined, FolderOutlined, SafetyOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

const { Title, Paragraph } = Typography

const features = [
  { icon: <FileTextOutlined style={{ fontSize: 32, color: '#1890ff' }} />, title: 'Smart Documents', desc: 'Supports PDF, Word, Excel, PPT, Markdown, auto-indexing and structuring' },
  { icon: <MessageOutlined style={{ fontSize: 32, color: '#52c41a' }} />, title: 'AI Chat', desc: 'Document-based intelligent Q&A with citation tracking' },
  { icon: <FolderOutlined style={{ fontSize: 32, color: '#faad14' }} />, title: 'File Management', desc: 'Hierarchical organization, drag-and-drop management' },
  { icon: <SafetyOutlined style={{ fontSize: 32, color: '#f5222d' }} />, title: 'Access Control', desc: 'Role-based permission management, secure and reliable' },
]

export default function LandingPage() {
  const { user } = useAuth()

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <div style={{ background: '#fff', padding: '80px 0', textAlign: 'center' }}>
        <Title level={1}>RAG Q&A</Title>
        <Paragraph style={{ fontSize: 18, color: '#666', maxWidth: 600, margin: '0 auto 40px' }}>
          Vector-free, reasoning-driven document Q&A system
        </Paragraph>
        <Space size="middle">
          {user ? (
            <Button type="primary" size="large">
              <Link to="/documents">Enter</Link>
            </Button>
          ) : (
            <>
              <Button type="primary" size="large">
                <Link to="/login">Login</Link>
              </Button>
              <Button size="large">
                <Link to="/register">Register</Link>
              </Button>
            </>
          )}
        </Space>
      </div>

      <div style={{ padding: '80px 48px', maxWidth: 1200, margin: '0 auto' }}>
        <Row gutter={[48, 48]}>
          {features.map((f) => (
            <Col xs={24} sm={12} key={f.title}>
              <div style={{ textAlign: 'center', padding: '24px' }}>
                {f.icon}
                <Title level={4} style={{ marginTop: 16 }}>{f.title}</Title>
                <Paragraph type="secondary">{f.desc}</Paragraph>
              </div>
            </Col>
          ))}
        </Row>
      </div>
    </div>
  )
}