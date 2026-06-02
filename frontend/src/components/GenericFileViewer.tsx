import { Typography, Button } from 'antd'
import { FileTextOutlined, DownloadOutlined } from '@ant-design/icons'

const { Text, Title } = Typography

interface GenericFileViewerProps {
  fileUrl: string
  filename?: string
  fileType: string
}

export default function GenericFileViewer({ 
  fileUrl, 
  filename = 'file', 
  fileType 
}: GenericFileViewerProps) {
  const getIcon = () => {
    return <FileTextOutlined style={{ fontSize: 64, color: '#9ca3af' }} />
  }

  const getDescription = () => {
    switch (fileType) {
      case 'pptx':
        return 'PowerPoint documents cannot be previewed in the browser. Please download to view.'
      default:
        return `This file format (${fileType.toUpperCase()}) cannot be previewed in the browser. Please download to view.`
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: 40,
        background: '#f9fafb',
        textAlign: 'center',
      }}
    >
      {getIcon()}
      <Title level={4} style={{ marginTop: 24, marginBottom: 8 }}>
        {filename}
      </Title>
      <Text type="secondary" style={{ marginBottom: 24, maxWidth: 400 }}>
        {getDescription()}
      </Text>
      <Button 
        type="primary" 
        icon={<DownloadOutlined />}
        href={fileUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        Download File
      </Button>
    </div>
  )
}
