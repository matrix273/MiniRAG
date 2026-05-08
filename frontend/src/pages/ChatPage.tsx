import { useState, useEffect, useRef } from 'react'
import { Button, Typography, message, Select, Tooltip } from 'antd'
import { 
  SendOutlined, 
  PlusOutlined, 
  CopyOutlined, 
  CheckOutlined,
  FileTextOutlined,
  MessageOutlined,
  MoreOutlined,
  DownOutlined,
} from '@ant-design/icons'
import { chatApi, documentApi } from '@/services/api'
import type { ChatSession, ChatMessage, Document } from '@/types'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

const { Text } = Typography

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations?: Array<{
    page: number
    text: string
    node_title?: string
  }>
  created_at: string
  isThinking?: boolean
}

// Copy button for code blocks
const CopyButton = ({ content }: { content: string }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Tooltip title={copied ? 'Copied!' : 'Copy'}>
      <button
        onClick={handleCopy}
        style={{
          padding: '4px 8px',
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          background: copied ? '#10b981' : '#fff',
          color: copied ? '#fff' : '#6b7280',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 12,
          transition: 'all 0.2s',
        }}
      >
        {copied ? <CheckOutlined /> : <CopyOutlined />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </Tooltip>
  )
}

// Message bubble component - Deepseek style
const MessageBubble = ({ msg }: { msg: Message }) => {
  const isUser = msg.role === 'user'
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(msg.content)
    setCopied(true)
    message.success('Copied to clipboard')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        gap: isUser ? 8 : 12,
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: isUser 
            ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' 
            : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontSize: 14,
          color: '#fff',
          fontWeight: 600,
        }}
      >
        {isUser ? 'U' : 'AI'}
      </div>

      {/* Content */}
      <div
        style={{
          width: '100%',
          flex: isUser ? '0 0 auto' : 1,
        }}
      >
        {/* Message bubble */}
        <div
          style={{
            background: isUser ? '#f3f4f6' : '#f9fafb',
            padding: '12px 16px',
            borderRadius: 12,
            borderTopRightRadius: isUser ? 4 : 12,
            borderTopLeftRadius: isUser ? 12 : 4,
            maxWidth: isUser ? 'fit-content' : '100%',
          }}
        >
          {/* Render markdown for assistant, plain text for user */}
          {isUser ? (
            <div style={{ color: '#1f2937', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxWidth: 'fit-content' }}>{msg.content}</div>
          ) : (
            <div className="markdown-body" style={{ color: '#1f2937', lineHeight: 1.7 }}>
              <ReactMarkdown
                remarkPlugins={[remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  code({ inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || '')
                    const language = match ? match[1] : 'text'
                    
                    if (inline) {
                      return (
                        <code
                          style={{
                            background: '#f3f4f6',
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontSize: 14,
                            color: '#ef4444',
                          }}
                          {...props}
                        >
                          {children}
                        </code>
                      )
                    }
                    
                    return (
                      <div style={{ margin: '12px 0' }}>
                        <div
                          style={{
                            background: '#1e293b',
                            padding: '8px 16px',
                            borderRadius: '8px 8px 0 0',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: '#94a3b8', fontSize: 12 }}>{language}</span>
                          <CopyButton content={String(children)} />
                        </div>
                        <SyntaxHighlighter
                          style={oneDark}
                          language={language}
                          PreTag="div"
                          customStyle={{
                            margin: 0,
                            borderRadius: '0 0 8px 8px',
                            fontSize: 14,
                          }}
                        >
                          {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                      </div>
                    )
                  },
                  p({ children }) {
                    return <p style={{ margin: '8px 0' }}>{children}</p>
                  },
                  h1({ children }) {
                    return <h1 style={{ margin: '16px 0 8px', fontSize: 20, fontWeight: 600 }}>{children}</h1>
                  },
                  h2({ children }) {
                    return <h2 style={{ margin: '14px 0 8px', fontSize: 18, fontWeight: 600 }}>{children}</h2>
                  },
                  h3({ children }) {
                    return <h3 style={{ margin: '12px 0 8px', fontSize: 16, fontWeight: 600 }}>{children}</h3>
                  },
                  ul({ children }) {
                    return <ul style={{ margin: '8px 0', paddingLeft: 20 }}>{children}</ul>
                  },
                  ol({ children }) {
                    return <ol style={{ margin: '8px 0', paddingLeft: 20 }}>{children}</ol>
                  },
                  li({ children }) {
                    return <li style={{ margin: '4px 0' }}>{children}</li>
                  },
                  blockquote({ children }) {
                    return (
                      <blockquote
                        style={{
                          margin: '12px 0',
                          padding: '8px 16px',
                          borderLeft: '4px solid #10b981',
                          background: '#f0fdf4',
                          borderRadius: '0 8px 8px 0',
                        }}
                      >
                        {children}
                      </blockquote>
                    )
                  },
                  table({ children }) {
                    return (
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          margin: '12px 0',
                        }}
                      >
                        {children}
                      </table>
                    )
                  },
                  th({ children }) {
                    return (
                      <th
                        style={{
                          border: '1px solid #e5e7eb',
                          padding: '8px 12px',
                          background: '#f9fafb',
                          textAlign: 'left',
                          fontWeight: 600,
                        }}
                      >
                        {children}
                      </th>
                    )
                  },
                  td({ children }) {
                    return (
                      <td
                        style={{
                          border: '1px solid #e5e7eb',
                          padding: '8px 12px',
                        }}
                      >
                        {children}
                      </td>
                    )
                  },
                }}
              >
                {msg.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Message actions bar - Deepseek style */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 8,
            padding: '0 4px',
          }}
        >
          <Tooltip title={copied ? 'Copied!' : 'Copy'}>
            <button
              onClick={handleCopy}
              style={{
                padding: '4px 8px',
                border: 'none',
                borderRadius: 6,
                background: 'transparent',
                color: copied ? '#10b981' : '#6b7280',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f3f4f6'
                e.currentTarget.style.color = copied ? '#10b981' : '#374151'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = copied ? '#10b981' : '#6b7280'
              }}
            >
              {copied ? <CheckOutlined style={{ fontSize: 14 }} /> : <CopyOutlined style={{ fontSize: 14 }} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </Tooltip>

          {/* Citations */}
          {!isUser && msg.citations && msg.citations.length > 0 && (
            <div
              style={{
                marginLeft: 'auto',
                padding: '2px 8px',
                background: '#f0fdf4',
                borderRadius: 4,
                fontSize: 12,
                color: '#065f46',
              }}
            >
              References: {msg.citations.map(c => `Page ${c.page}`).join(', ')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const ChatPage = () => {
  const [documents, setDocuments] = useState<Document[]>([])
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSession, setCurrentSession] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  // Auto scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Handle scroll for show/hide scroll button
  const handleScroll = () => {
    if (messagesContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current
      setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 100)
    }
  }

  useEffect(() => {
    fetchDocuments()
  }, [])

  const fetchDocuments = async () => {
    try {
      const docs = await documentApi.list()
      const completedDocs = docs.filter(d => d.status === 'completed')
      setDocuments(completedDocs)
      if (completedDocs.length > 0 && !selectedDoc) {
        handleSelectDoc(completedDocs[0].id)
      }
    } catch (error) {
      message.error('Failed to fetch documents')
    }
  }

  const fetchSessions = async (docId: string) => {
    try {
      const sess = await chatApi.listSessions(docId)
      setSessions(sess)
      if (sess.length > 0) {
        handleSelectSession(sess[0].id)
      } else {
        setCurrentSession(null)
        setMessages([])
      }
    } catch (error) {
      message.error('Failed to fetch chat sessions')
    }
  }

  const fetchMessages = async (sessionId: string) => {
    setLoading(true)
    try {
      const msgs = await chatApi.getMessages(sessionId)
      setMessages(msgs)
    } catch (error) {
      message.error('Failed to fetch messages')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateSession = async () => {
    if (!selectedDoc) {
      message.warning('Please select a document first')
      return
    }

    try {
      const session = await chatApi.createSession(selectedDoc, 'New Chat')
      setSessions([session, ...sessions])
      setCurrentSession(session.id)
      setMessages([])
    } catch (error) {
      message.error('Failed to create session')
    }
  }

  const handleSelectSession = (sessionId: string) => {
    setCurrentSession(sessionId)
    fetchMessages(sessionId)
  }

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !currentSession) return

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputMessage,
      created_at: new Date().toISOString(),
    }

    setMessages(prev => [...prev, userMsg])
    setInputMessage('')
    setSending(true)

    try {
      const response = await chatApi.sendMessage(currentSession, inputMessage)
      setMessages(prev => [...prev, response])
    } catch (error) {
      message.error('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const handleSelectDoc = (docId: string) => {
    setSelectedDoc(docId)
    fetchSessions(docId)
  }

  const selectedDocInfo = documents.find(d => d.id === selectedDoc)

  return (
    <div 
      style={{ 
        height: 'calc(100vh - 88px)',
        display: 'flex',
        background: '#fff',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {/* Left Sidebar - Sessions */}
      <div 
        style={{ 
          width: 280, 
          background: '#f9fafb',
          borderRight: '1px solid #e5e7eb',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Document Selector */}
        <div style={{ padding: 16, borderBottom: '1px solid #e5e7eb' }}>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8, color: '#6b7280' }}>
            Based on Document
          </Text>
          <Select
            style={{ width: '100%' }}
            value={selectedDoc}
            onChange={handleSelectDoc}
            bordered={false}
            options={documents.map(doc => ({
              value: doc.id,
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileTextOutlined style={{ color: '#6366f1' }} />
                  <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.filename}
                  </span>
                </div>
              ),
            }))}
            dropdownStyle={{ borderRadius: 8 }}
          />
        </div>

        {/* New Chat Button */}
        <div style={{ padding: 12 }}>
          <Button 
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleCreateSession}
            block
            style={{ 
              borderRadius: 8,
              height: 40,
              background: '#111827',
            }}
          >
            New Chat
          </Button>
        </div>

        {/* Session List */}
        <div style={{ flex: 1, overflow: 'auto', padding: '0 12px 12px' }}>
          {sessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
              <MessageOutlined style={{ fontSize: 32, marginBottom: 12 }} />
              <div style={{ fontSize: 14 }}>No conversations yet</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Start a new chat</div>
            </div>
          ) : (
            sessions.map(session => (
              <div
                key={session.id}
                onClick={() => handleSelectSession(session.id)}
                style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  marginBottom: 4,
                  background: currentSession === session.id ? '#fff' : 'transparent',
                  border: currentSession === session.id ? '1px solid #e5e7eb' : '1px solid transparent',
                  boxShadow: currentSession === session.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.2s',
                }}
              >
                <div
                  style={{ 
                    fontWeight: currentSession === session.id ? 500 : 400,
                    color: currentSession === session.id ? '#111827' : '#374151',
                    fontSize: 14,
                    marginBottom: 4,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {session.title}
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af' }}>
                  {new Date(session.created_at).toLocaleDateString()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div 
        style={{ 
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background: '#fff',
        }}
      >
        {/* Header */}
        {selectedDocInfo && (
          <div 
            style={{ 
              padding: '16px 24px', 
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: '#f3f4f6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <FileTextOutlined style={{ color: '#6366f1' }} />
              </div>
              <div>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{selectedDocInfo.filename}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {selectedDocInfo.page_count} pages · {messages.length} messages
                </div>
              </div>
            </div>
            
            <Tooltip title="More options">
              <Button type="text" icon={<MoreOutlined />} />
            </Tooltip>
          </div>
        )}

        {/* Messages */}
        <div 
          ref={messagesContainerRef}
          onScroll={handleScroll}
          style={{ 
            flex: 1, 
            overflow: 'auto',
            background: '#fafafa',
          }}
        >
          {messages.length === 0 ? (
            <div 
              style={{ 
                height: '100%', 
                display: 'flex', 
                flexDirection: 'column',
                alignItems: 'center', 
                justifyContent: 'center',
                color: '#9ca3af',
              }}
            >
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 24,
                  fontSize: 32,
                  color: '#fff',
                }}
              >
                AI
              </div>
              <div style={{ fontSize: 18, fontWeight: 500, color: '#374151', marginBottom: 8 }}>
                How can I help you today?
              </div>
              <div style={{ fontSize: 14 }}>
                Ask questions about <strong>{selectedDocInfo?.filename}</strong>
              </div>
            </div>
          ) : (
            <div 
              style={{ 
                maxWidth: 900, 
                margin: '0 auto',
                padding: '24px 32px',
              }}
            >
              {messages.map((msg, index) => (
                <div 
                  key={msg.id} 
                  style={{ 
                    marginBottom: 24,
                    animation: 'fadeIn 0.3s ease-out',
                    display: 'flex',
                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    marginLeft: msg.role === 'user' ? 'auto' : 0,
                    marginRight: msg.role === 'user' ? 0 : 'auto',
                  }}
                >
                  <MessageBubble msg={msg} />
                </div>
              ))}
              {sending && (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      fontSize: 14,
                      color: '#fff',
                      fontWeight: 600,
                    }}
                  >
                    AI
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <span 
                      style={{ 
                        width: 8, 
                        height: 8, 
                        background: '#d1d5db', 
                        borderRadius: '50%',
                        animation: 'bounce 1.4s infinite ease-in-out both',
                      }} 
                    />
                    <span 
                      style={{ 
                        width: 8, 
                        height: 8, 
                        background: '#d1d5db', 
                        borderRadius: '50%',
                        animation: 'bounce 1.4s infinite ease-in-out both',
                        animationDelay: '0.16s',
                      }} 
                    />
                    <span 
                      style={{ 
                        width: 8, 
                        height: 8, 
                        background: '#d1d5db', 
                        borderRadius: '50%',
                        animation: 'bounce 1.4s infinite ease-in-out both',
                        animationDelay: '0.32s',
                      }} 
                    />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            style={{
              position: 'absolute',
              left: 'calc(50% + 140px)',
              transform: 'translateX(-50%)',
              bottom: 130,
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: '#fff',
              border: '1px solid #e5e7eb',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
            }}
          >
            <DownOutlined />
          </button>
        )}

        {/* Input Area */}
        <div 
          style={{ 
            padding: '16px 24px 24px', 
            borderTop: '1px solid #e5e7eb',
            background: '#fff',
          }}
        >
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <div 
              style={{ 
                display: 'flex', 
                gap: 12,
                background: '#f9fafb',
                borderRadius: 12,
                padding: 4,
                border: '1px solid #e5e7eb',
              }}
            >
              <textarea
                value={inputMessage}
                onChange={e => setInputMessage(e.target.value)}
                placeholder={currentSession ? "Message AI..." : "Select a chat to start"}
                disabled={!currentSession || sending}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendMessage()
                  }
                }}
                style={{
                  flex: 1,
                  border: 'none',
                  background: 'transparent',
                  padding: '12px 16px',
                  fontSize: 15,
                  resize: 'none',
                  outline: 'none',
                  minHeight: 24,
                  maxHeight: 200,
                  fontFamily: 'inherit',
                }}
                rows={1}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSendMessage}
                disabled={!currentSession || !inputMessage.trim() || sending}
                loading={sending}
                style={{
                  borderRadius: 10,
                  height: 44,
                  width: 44,
                  background: inputMessage.trim() ? '#111827' : '#d1d5db',
                  borderColor: 'transparent',
                }}
              />
            </div>
            <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block', textAlign: 'center', color: '#9ca3af' }}>
              AI may produce inaccurate information. Double-check important info.
            </Text>
          </div>
        </div>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }
      `}</style>
    </div>
  )
}

export default ChatPage
