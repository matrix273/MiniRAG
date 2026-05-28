import { Button, Typography, Space, Row, Col } from 'antd'
import { FileTextOutlined, MessageOutlined, FolderOutlined, SafetyOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

const { Title, Paragraph } = Typography

const features = [
  { icon: <FileTextOutlined style={{ fontSize: 32, color: '#1890ff' }} />, title: '智能文档', desc: '上传 PDF 或 Markdown，自动索引和结构化' },
  { icon: <MessageOutlined style={{ fontSize: 32, color: '#52c41a' }} />, title: 'AI 对话', desc: '基于文档内容的智能问答，带引用溯源' },
  { icon: <FolderOutlined style={{ fontSize: 32, color: '#faad14' }} />, title: '文件管理', desc: '知识库层级组织，拖拽管理' },
  { icon: <SafetyOutlined style={{ fontSize: 32, color: '#f5222d' }} />, title: '访问控制', desc: '基于角色的权限管理，安全可靠' },
]

export default function LandingPage() {
  const { user } = useAuth()

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <div style={{ background: '#fff', padding: '80px 0', textAlign: 'center' }}>
        <Title level={1}>RAG 智能问答</Title>
        <Paragraph style={{ fontSize: 18, color: '#666', maxWidth: 600, margin: '0 auto 40px' }}>
          无向量、推理驱动的文档问答系统
        </Paragraph>
        <Space size="middle">
          {user ? (
            <Button type="primary" size="large">
              <Link to="/documents">进入系统</Link>
            </Button>
          ) : (
            <>
              <Button type="primary" size="large">
                <Link to="/login">登录</Link>
              </Button>
              <Button size="large">
                <Link to="/register">注册</Link>
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