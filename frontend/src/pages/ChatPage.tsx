import React, { useState, useEffect, useRef } from 'react'
import { Button, Typography, TreeSelect, Tooltip, App, Dropdown } from 'antd'
import {
  SendOutlined,
  PlusOutlined,
  CopyOutlined,
  CheckOutlined,
  FileTextOutlined,
  FolderOutlined,
  MessageOutlined,
  MoreOutlined,
  DownOutlined,
  LeftOutlined,
  RightOutlined,
  MenuOutlined,
  CloseOutlined,
} from '@ant-design/icons'
import { chatApi, documentApi, folderApi } from '@/services/api'
import type { ChatSession, Document, Folder } from '@/types'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import ReferencePanel from '@/components/ReferencePanel'
import PDFViewer from '@/components/PDFViewer'

const { Text } = Typography

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
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
  const { message } = App.useApp()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    message.success('Copied to clipboard')
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

// Formula copy button for KaTeX display blocks
const FormulaCopyButton = ({ formulaText }: { formulaText: string }) => {
  const { message } = App.useApp()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(formulaText)
    setCopied(true)
    message.success('Formula copied!')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      style={{
        background: copied ? '#10b981' : '#f3f4f6',
        border: 'none',
        borderRadius: 4,
        padding: '4px 8px',
        cursor: 'pointer',
        fontSize: 12,
        color: copied ? '#fff' : '#6b7280',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        transition: 'all 0.2s',
      }}
    >
      {copied ? <CheckOutlined /> : <CopyOutlined />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// Session item component with rename and delete
const SessionItem: React.FC<{
  session: ChatSession
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (newTitle: string) => void
}> = ({ session, isActive, onSelect, onDelete, onRename }) => {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(session.title)
  const [showActions, setShowActions] = useState(false)

  const handleRename = () => {
    if (editTitle.trim() && editTitle !== session.title) {
      onRename(editTitle.trim())
    }
    setIsEditing(false)
  }

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      style={{
        padding: '12px 16px',
        borderRadius: 8,
        cursor: 'pointer',
        marginBottom: 4,
        background: isActive ? '#fff' : 'transparent',
        border: isActive ? '1px solid #e5e7eb' : '1px solid transparent',
        boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
        transition: 'all 0.2s',
        position: 'relative',
      }}
    >
      {isEditing ? (
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename()
              if (e.key === 'Escape') setIsEditing(false)
            }}
            autoFocus
            style={{
              flex: 1,
              border: '1px solid #e5e7eb',
              borderRadius: 4,
              padding: '2px 6px',
              fontSize: 14,
              outline: 'none',
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : (
        <>
          <div
            style={{ 
              fontWeight: isActive ? 500 : 400,
              color: isActive ? '#111827' : '#374151',
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
            {new Date(session.created_at).toLocaleString('zh-CN', { 
              year: 'numeric', 
              month: '2-digit', 
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false
            })}
          </div>
        </>
      )}
      
      {/* Action buttons */}
      {showActions && !isEditing && (
        <div
          style={{
            position: 'absolute',
            right: 8,
            top: 8,
            display: 'flex',
            gap: 4,
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsEditing(true)
              setEditTitle(session.title)
            }}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 2,
              color: '#6b7280',
              fontSize: 12,
            }}
          >
            <MoreOutlined />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 2,
              color: '#ef4444',
              fontSize: 12,
            }}
          >
            <CloseOutlined />
          </button>
        </div>
      )}
    </div>
  )
}

// Message bubble component - Deepseek style
interface MessageBubbleProps {
  msg: Message
  onCitationClick?: (citations: Array<{ page: number; text: string; node_title?: string }>, index: number) => void
  isSelected?: boolean
  onToggleSelect?: () => void
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ msg, onCitationClick, isSelected, onToggleSelect }) => {
  const { message } = App.useApp()
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
        alignItems: 'flex-start',
        gap: isUser ? 8 : 12,
        position: 'relative',
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

      {/* Selection checkbox - 放在 Avatar 和内容之间 */}
      {onToggleSelect && (
        <div
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect()
          }}
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            border: isSelected ? 'none' : '1px solid #d1d5db',
            background: isSelected ? '#6366f1' : '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            cursor: 'pointer',
          }}
        >
          {isSelected && (
            <CheckOutlined style={{ fontSize: 12, color: '#fff' }} />
          )}
        </div>
      )}

      {/* Content */}
      <div
        style={{
          flex: isUser ? '1 1 auto' : 1,
          maxWidth: isUser ? 'calc(100% - 80px)' : '100%',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: isUser ? 'flex-end' : 'flex-start',
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
            maxWidth: '100%',
          }}
        >
          {/* Render markdown for assistant, plain text for user */}
          {isUser ? (
            <div style={{ color: '#1f2937', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'keep-all' }}>{msg.content}</div>
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
                    // 检查是否包含 KaTeX 公式（块级公式应该独立成段）
                    const childArray = React.Children.toArray(children)
                    const hasKatexDisplay = childArray.some((child: any) => {
                      if (React.isValidElement(child)) {
                        const className = (child.props as any)?.className || ''
                        // 检查是否包含 katex-display 类（块级公式）
                        if (className.includes('katex-display')) {
                          return true
                        }
                        // 递归检查子元素
                        const innerChildren = React.Children.toArray((child.props as any)?.children || [])
                        return innerChildren.some((innerChild: any) => {
                          if (React.isValidElement(innerChild)) {
                            const innerClassName = (innerChild.props as any)?.className || ''
                            return innerClassName.includes('katex-display')
                          }
                          return false
                        })
                      }
                      return false
                    })
                    
                    if (hasKatexDisplay) {
                      // 包含块级公式，不包裹在 p 标签中
                      return <>{children}</>
                    }
                    
                    // Process children to find citation references [1], [2], etc.
                    const processChildren = (nodes: React.ReactNode): React.ReactNode => {
                      return React.Children.map(nodes, (child) => {
                        if (typeof child === 'string') {
                          // Split string by citation patterns like [1], [2]
                          const parts = child.split(/(\[\d+\])/g)
                          return parts.map((part, i) => {
                            const match = part.match(/^\[(\d+)\]$/)
                            if (match) {
                              const index = parseInt(match[1], 10) - 1
                              if (index >= 0 && msg.citations && index < msg.citations.length) {
                                return (
                                  <sup key={i}>
                                    <button
                                      onClick={() => onCitationClick?.(msg.citations || [], index)}
                                      style={{
                                        background: '#fef3c7',
                                        border: 'none',
                                        borderRadius: 3,
                                        padding: '0 4px',
                                        marginLeft: 2,
                                        color: '#d97706',
                                        fontWeight: 500,
                                        cursor: 'pointer',
                                        fontSize: 'inherit',
                                        transition: 'all 0.2s',
                                      }}
                                      title="查看引用原文"
                                    >
                                      {part}
                                    </button>
                                  </sup>
                                )
                              }
                            }
                            return part
                          })
                        }
                        if (React.isValidElement(child)) {
                          // Recursively process nested elements
                          const processed = processChildren((child.props as any).children)
                          return React.cloneElement(child, { ...child.props, children: processed })
                        }
                        return child
                      })
                    }
                    return <p style={{ margin: 0 }}>{processChildren(children)}</p>
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
                    return <ul style={{ margin: 0, paddingLeft: 20 }}>{children}</ul>
                  },
                  ol({ children }) {
                    return <ol style={{ margin: 0, paddingLeft: 20 }}>{children}</ol>
                  },
                  li({ children }) {
                    return <li style={{ margin: '4px 0' }}>{children}</li>
                  },
                  strong({ children }) {
                    return <strong style={{ fontWeight: 600 }}>{children}</strong>
                  },
                  em({ children }) {
                    return <em style={{ fontStyle: 'italic' }}>{children}</em>
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
                  html({ children }: any) {
                    // 普通 HTML，直接渲染
                    const htmlContent = String(children)
                    return <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
                  },
                  span({ children, ...props }: any) {
                    // 检查是否是块级公式（精确匹配 katex-display 类）
                    const className = props.className || ''
                    if (className === 'katex-display') {
                      // 块级公式，只显示 Copy 按钮，不带边框
                      
                      // 递归函数：只从 annotation 标签中提取原始公式文本
                      const extractAnnotationText = (node: any): string => {
                        if (!node) return ''
                        
                        if (Array.isArray(node)) {
                          for (const item of node) {
                            const result = extractAnnotationText(item)
                            if (result) return result
                          }
                          return ''
                        }
                        
                        if (React.isValidElement(node)) {
                          const elementProps = node.props as any
                          // 检查是否是 annotation 标签
                          if (node.type === 'annotation') {
                            // 提取 annotation 中的文本内容
                            const getAnnotationContent = (n: any): string => {
                              if (typeof n === 'string') return n
                              if (Array.isArray(n)) return n.map(getAnnotationContent).join('')
                              if (React.isValidElement(n)) {
                                return getAnnotationContent((n.props as any).children)
                              }
                              return ''
                            }
                            return getAnnotationContent(elementProps.children).trim()
                          }
                          // 递归查找 annotation
                          return extractAnnotationText(elementProps?.children)
                        }
                        
                        return ''
                      }
                      
                      const formulaText = extractAnnotationText(children)
                      
                      return (
                        <div style={{ position: 'relative', margin: '16px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ flex: 1, textAlign: 'center' }}>
                            <span {...props}>{children}</span>
                          </div>
                          <FormulaCopyButton formulaText={formulaText} />
                        </div>
                      )
                    }
                    
                    // 检查是否是行内公式（精确匹配 katex 类，排除 katex-display 和 katex-mathml）
                    if (className === 'katex') {
                      // 行内公式用简单边框样式，不显示 Copy 按钮
                      return (
                        <span 
                          style={{
                            display: 'inline-block',
                            border: '1px solid #e5e7eb',
                            borderRadius: 4,
                            padding: '2px 6px',
                            background: '#f9fafb',
                            margin: '0 2px',
                          }}
                          {...props}
                        >
                          {children}
                        </span>
                      )
                    }
                    return <span {...props}>{children}</span>
                  },
                  div({ children, ...props }: any) {
                    // 普通 div，直接渲染
                    return <div {...props}>{children}</div>
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

          {/* Citations - Hidden, only accessible via clicking in message content */}
        </div>
      </div>
    </div>
  )
}

const ChatPage = () => {
  const { message } = App.useApp()
  const [documents, setDocuments] = useState<Document[]>([])
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSession, setCurrentSession] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null)
  const [selectedDocs, setSelectedDocs] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  // Reference panel state - 默认折叠
  const [showReferencePanel, setShowReferencePanel] = useState(false)
  const [activeCitations, setActiveCitations] = useState<Array<{ page: number; text: string; node_title?: string }>>([])
  const [selectedCitationIndex, setSelectedCitationIndex] = useState<number | null>(null)
  // PDF 面板状态 - 用于无引用时显示 PDF
  const [showPdfOnly, setShowPdfOnly] = useState(false)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('chatSidebarCollapsed')
    return saved ? JSON.parse(saved) : false
  })
  const [chatWidth, setChatWidth] = useState(50) // percentage
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // PDF preview panel state
  const [pdfPage, setPdfPage] = useState(1)
  const [pdfPreviewDocId, setPdfPreviewDocId] = useState<string | null>(null)
  // 消息多选状态
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set())

  // Folder tree state
  const [folders, setFolders] = useState<Folder[]>([])
  const [treeData, setTreeData] = useState<any[]>([])

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
    fetchFoldersAndDocs()
    loadAllSessions()
  }, [])

  const fetchFoldersAndDocs = async () => {
    try {
      const [folderList, docs] = await Promise.all([
        folderApi.list(),
        documentApi.list(),
      ])
      const completedDocs = docs.filter(d => d.status === 'completed')
      setFolders(folderList)
      setDocuments(completedDocs)
      setTreeData(buildTreeData(folderList, completedDocs))
    } catch (error) {
      message.error('Failed to load data')
    }
  }

  const buildTreeData = (folderList: Folder[], docs: Document[]): any[] => {
    const buildNodes = (fl: Folder[]): any[] => {
      return fl.map(folder => {
        const childDocs = docs.filter(d => d.folder_id === folder.id)
        return {
          value: `folder:${folder.id}`,
          title: folder.name,
          icon: <FolderOutlined style={{ color: '#f59e0b' }} />,
          children: [
            ...buildNodes(folder.children || []),
            ...childDocs.map(doc => ({
              value: `doc:${doc.id}`,
              title: doc.filename,
              icon: <FileTextOutlined style={{ color: '#6366f1' }} />,
              isLeaf: true,
            })),
          ],
        }
      })
    }

    const rootDocs = docs.filter(d => !d.folder_id)
    const topLevelFolders = folderList.filter(f => !f.parent_id)

    return [
      ...buildNodes(topLevelFolders),
      ...rootDocs.map(doc => ({
        value: `doc:${doc.id}`,
        title: doc.filename,
        icon: <FileTextOutlined style={{ color: '#6366f1' }} />,
        isLeaf: true,
      })),
    ]
  }

  // 将 TreeSelect 的值（可能包含 folder:xxx）解析为纯文档 ID 列表
  const resolveTreeValues = (values: string[]): string[] => {
    const docIds: string[] = []
    const resolveFolder = (folder: Folder) => {
      // 递归收集该文件夹下所有文档（含子文件夹）
      for (const child of folder.children || []) {
        resolveFolder(child)
      }
      for (const doc of folder.documents || []) {
        if (doc.status === 'completed') {
          docIds.push(doc.id)
        }
      }
    }

    for (const val of values) {
      if (val.startsWith('doc:')) {
        docIds.push(val.replace('doc:', ''))
      } else if (val.startsWith('folder:')) {
        const folderId = val.replace('folder:', '')
        // 递归查找文件夹及其子文件夹中的所有文档
        const findFolder = (fl: Folder[]): Folder | null => {
          for (const f of fl) {
            if (f.id === folderId) return f
            const found = findFolder(f.children || [])
            if (found) return found
          }
          return null
        }
        const folder = findFolder(folders)
        if (folder) resolveFolder(folder)
      }
    }
    return [...new Set(docIds)]
  }

  const handleCreateSession = async () => {
    if (!selectedDoc) {
      message.warning('Please select a document first')
      return
    }

    try {
      const session = await chatApi.createSession(selectedDoc, 'New Chat', selectedDocs)
      setSessions([session, ...sessions])
      setCurrentSession(session.id)
      setMessages([])
      
      // 创建新会话后聚焦到输入框
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    } catch (error) {
      message.error('Failed to create session')
    }
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

    // 检查是否是第一条消息（用于自动重命名）
    const isFirstMessage = messages.length === 0

    try {
      const response = await chatApi.sendMessage(currentSession, inputMessage)
      setMessages(prev => [...prev, response as Message])
      
      // 自动重命名会话（类似 ChatGPT）
      // 只在第一条消息时自动重命名
      const session = sessions.find(s => s.id === currentSession)
      if (session && session.title === 'New Chat' && isFirstMessage) {
        // 使用用户消息的前 20 个字符作为标题
        const newTitle = inputMessage.slice(0, 20) + (inputMessage.length > 20 ? '...' : '')
        await handleRenameSession(currentSession, newTitle)
      }
    } catch (error) {
      message.error('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const loadAllSessions = async () => {
    try {
      const allSessions = await chatApi.listAllSessions()
      setSessions(allSessions)
      setCurrentSession(null)
      setMessages([])
    } catch {
      message.error('Failed to load sessions')
    }
  }

  const handleSelectSession = async (sessionId: string) => {
    setCurrentSession(sessionId)

    // 加载会话消息
    const msgs = await chatApi.getMessages(sessionId)
    setMessages(msgs as Message[])

    // 查找会话关联的文档
    const session = sessions.find(s => s.id === sessionId)
    if (session) {
      const docIds = session.document_ids || [session.document_id]
      setSelectedDoc(docIds[0])
      setSelectedDocs(docIds)

      // 切换会话时重置 PDF 预览状态，使其跟随新会话的文档
      setPdfPreviewDocId(null)
      setPdfPage(1)
      setShowReferencePanel(false)
      setShowPdfOnly(false)
      setActiveCitations([])
      setSelectedCitationIndex(null)
    }
  }

  const handleSelectDocs = async (docIds: string[]) => {
    if (docIds.length === 0) {
      // 清空选择时，加载全量历史会话
      setSelectedDoc(null)
      setSelectedDocs([])
      await loadAllSessions()
      return
    }

    const primaryDocId = docIds[0]
    setSelectedDoc(primaryDocId)

    // 尝试找到一个已有会话，其 document_ids 与当前选中完全匹配
    const allSessions = await chatApi.listSessions(primaryDocId)
    setSessions(allSessions)

    const matchSession = allSessions.find((s: any) => {
      const sessionDocIds = s.document_ids || [s.document_id]
      if (sessionDocIds.length !== docIds.length) return false
      return docIds.every(id => sessionDocIds.includes(id))
    })

    if (matchSession) {
      setCurrentSession(matchSession.id)
      const msgs = await chatApi.getMessages(matchSession.id)
      setMessages(msgs as Message[])
    } else {
      // 没有匹配的会话，创建新会话
      const session = await chatApi.createSession(primaryDocId, 'New Chat', docIds)
      setSessions([session, ...allSessions])
      setCurrentSession(session.id)
      setMessages([])
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  const handleCitationClick = (citations: Array<{ page: number; text: string; node_title?: string }>, index: number) => {
    setActiveCitations(citations)
    setSelectedCitationIndex(index)
    setShowReferencePanel(true)
    setShowPdfOnly(false)
  }

  const handleCloseReferencePanel = () => {
    setShowReferencePanel(false)
    setSelectedCitationIndex(null)
    setShowPdfOnly(false)
    setChatWidth(50) // 恢复聊天窗口宽度
  }

  const handleSelectCitation = (index: number) => {
    setSelectedCitationIndex(index)
  }

  const selectedDocsInfo = selectedDocs.map(id => documents.find(d => d.id === id)).filter(Boolean)

  // 删除选中的消息
  const handleDeleteMessages = async () => {
    if (!currentSession || selectedMessages.size === 0) return
    
    try {
      await chatApi.deleteMessages(currentSession, Array.from(selectedMessages))
      setMessages(prev => prev.filter(msg => !selectedMessages.has(msg.id)))
      setSelectedMessages(new Set())
      message.success('Messages deleted')
    } catch (error) {
      message.error('Failed to delete messages')
    }
  }

  // 删除会话
  const handleDeleteSession = async (sessionId: string) => {
    try {
      await chatApi.deleteSession(sessionId)
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      if (currentSession === sessionId) {
        setCurrentSession(null)
        setMessages([])
      }
      message.success('Session deleted')
    } catch (error) {
      message.error('Failed to delete session')
    }
  }

  // 重命名会话
  const handleRenameSession = async (sessionId: string, newTitle: string) => {
    try {
      await chatApi.updateSession(sessionId, newTitle)
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: newTitle } : s))
      message.success('Session renamed')
    } catch (error) {
      message.error('Failed to rename session')
    }
  }

  // 切换消息选中状态
  const toggleMessageSelection = (msgId: string) => {
    setSelectedMessages(prev => {
      const newSet = new Set(prev)
      if (newSet.has(msgId)) {
        newSet.delete(msgId)
      } else {
        newSet.add(msgId)
      }
      return newSet
    })
  }

  return (
    <div 
      className="chat-container"
      style={{ 
        height: 'calc(100vh - 88px)',
        display: 'flex',
        background: '#fff',
        borderRadius: 8,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Left Sidebar - Sessions */}
      <div 
        style={{ 
          width: sidebarCollapsed ? 0 : 280, 
          minWidth: sidebarCollapsed ? 0 : 280,
          background: '#f9fafb',
          borderRight: '1px solid #e5e7eb',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'width 0.2s, min-width 0.2s',
        }}
      >
        {/* Collapse Button */}
        <div style={{ padding: 8, borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            type="text"
            size="small"
            icon={<LeftOutlined />}
            onClick={() => {
              setSidebarCollapsed(true)
              localStorage.setItem('chatSidebarCollapsed', JSON.stringify(true))
              // 折叠后刷新 PDF
              setTimeout(() => {
                const refreshFn = (window as any).__pdfViewerRefresh
                if (refreshFn) refreshFn()
              }, 100)
            }}
            style={{ color: '#6b7280' }}
          />
        </div>

        {/* Document Selector - Tree Select (Multiple) */}
        <div style={{ padding: 16, borderBottom: '1px solid #e5e7eb' }}>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8, color: '#6b7280' }}>
            基于文档 (支持多选)
          </Text>
          <TreeSelect
            style={{ width: '100%' }}
            value={selectedDocs.map(id => `doc:${id}`)}
            treeData={treeData}
            placeholder="选择文件夹或文件"
            treeDefaultExpandAll
            showSearch
            multiple
            maxTagCount="responsive"
            filterTreeNode={(input, node) =>
              String(node?.title ?? '').toLowerCase().includes(input.toLowerCase())
            }
            onChange={(values: string[]) => {
              // 将 folder:xxx 和 doc:xxx 全部解析为纯文档 ID 列表
              const docIds = resolveTreeValues(values)

              // 检查是否有新增的文档
              const addedDocs = docIds.filter(id => !selectedDocs.includes(id))

              if (addedDocs.length > 0) {
                // 选择新文档时自动创建会话
                handleSelectDocs(docIds)
              } else if (docIds.length < selectedDocs.length) {
                // 取消选择某些文档
                handleSelectDocs(docIds)
              }
              setSelectedDocs(docIds)
            }}
            treeCheckable
            showCheckedStrategy={TreeSelect.SHOW_CHILD}
            styles={{ popup: { root: { borderRadius: 8 } } }}
          />
        </div>

        {/* New Chat Button */}
        <div style={{ padding: '8px 12px' }}>
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
              <SessionItem
                key={session.id}
                session={session}
                isActive={currentSession === session.id}
                onSelect={() => handleSelectSession(session.id)}
                onDelete={() => handleDeleteSession(session.id)}
                onRename={(newTitle) => handleRenameSession(session.id, newTitle)}
              />
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div 
        className="chat-main-area"
        style={{ 
          flex: (showReferencePanel || showPdfOnly) ? 'none' : 1,
          flexGrow: (showReferencePanel || showPdfOnly) ? 0 : 1,
          flexShrink: (showReferencePanel || showPdfOnly) ? 0 : 1,
          display: 'flex',
          flexDirection: 'column',
          background: '#fff',
          width: (showReferencePanel || showPdfOnly) ? `${chatWidth}%` : 'auto',
          minWidth: 300,
          position: 'relative',
        }}
      >
        {/* Header */}
        {(selectedDocsInfo.length > 0 || sidebarCollapsed) && (
          <div
            style={{
              padding: '16px 24px',
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              {sidebarCollapsed && (
                <Button
                  type="text"
                  icon={<MenuOutlined />}
                  onClick={() => {
                    setSidebarCollapsed(false)
                    localStorage.setItem('chatSidebarCollapsed', JSON.stringify(false))
                    setTimeout(() => {
                      const refreshFn = (window as any).__pdfViewerRefresh
                      if (refreshFn) refreshFn()
                    }, 100)
                  }}
                  style={{ marginRight: 4, flexShrink: 0 }}
                />
              )}
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: '#f3f4f6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <FileTextOutlined style={{ color: '#6366f1' }} />
              </div>
              <div style={{ minWidth: 0 }}>
                {selectedDocsInfo.length === 0 ? (
                  <div style={{ fontWeight: 500, fontSize: 14, color: '#6b7280' }}>全量历史会话</div>
                ) : selectedDocsInfo.length === 1 ? (
                  <>
                    <div style={{ fontWeight: 500, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedDocsInfo[0]!.filename}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {selectedDocsInfo[0]!.page_count} pages · {messages.length} messages
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{selectedDocsInfo.length} documents</div>
                    <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Dropdown
                        trigger={['hover', 'click']}
                        overlay={
                          <div style={{ background: '#fff', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: 8, maxWidth: 300 }}>
                            {selectedDocsInfo.map(d => (
                              <div key={d!.id} style={{ padding: '8px 12px', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {d!.filename} ({d!.page_count} pages)
                              </div>
                            ))}
                          </div>
                        }
                      >
                        <span style={{ cursor: 'pointer', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {selectedDocsInfo.map(d => d!.filename.split('.')[0]).join(', ')}
                        </span>
                      </Dropdown>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <Tooltip title="More options">
                <Button type="text" icon={<MoreOutlined />} />
              </Tooltip>
            </div>
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
                Ask questions about {selectedDocsInfo.length === 1
                  ? <strong>{selectedDocsInfo[0]?.filename}</strong>
                  : <strong>{selectedDocsInfo.length} documents</strong>
                }
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
              {messages.map((msg) => (
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
                  <MessageBubble msg={msg} onCitationClick={handleCitationClick} isSelected={selectedMessages.has(msg.id)} onToggleSelect={() => toggleMessageSelection(msg.id)} />
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
              left: '50%',
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
              transform: 'translateX(-50%)',
            }}
          >
            <DownOutlined />
          </button>
        )}

        {/* PDF Preview Toggle Button - 右侧中央折叠按钮 */}
        <Tooltip title={showPdfOnly || showReferencePanel ? "关闭 PDF 预览" : "显示 PDF 预览"}>
          <button
            onClick={() => {
              if (showPdfOnly || showReferencePanel) {
                setShowPdfOnly(false)
                setShowReferencePanel(false)
              } else {
                setShowPdfOnly(true)
              }
              // 折叠/展开后刷新 PDF
              setTimeout(() => {
                const refreshFn = (window as any).__pdfViewerRefresh
                if (refreshFn) {
                  refreshFn()
                }
              }, 100)
            }}
            style={{
              position: 'absolute',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 36,
              height: 72,
              borderRadius: '8px 0 0 8px',
              background: (showPdfOnly || showReferencePanel) ? '#6366f1' : '#fff',
              border: '1px solid #e5e7eb',
              borderRight: 'none',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              zIndex: 10,
              transition: 'all 0.2s',
            }}
          >
            <FileTextOutlined style={{ fontSize: 16, color: (showPdfOnly || showReferencePanel) ? '#fff' : '#6b7280' }} />
            <span style={{ fontSize: 10, color: (showPdfOnly || showReferencePanel) ? '#fff' : '#6b7280', writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
              PDF
            </span>
          </button>
        </Tooltip>

        {/* Selected messages action bar */}
        {selectedMessages.size > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: 130,
              left: '50%',
              transform: 'translateX(-50%)',
              background: '#1f2937',
              borderRadius: 8,
              padding: '8px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              zIndex: 20,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}
          >
            <span style={{ color: '#fff', fontSize: 13 }}>{selectedMessages.size} selected</span>
            <button
              onClick={handleDeleteMessages}
              style={{
                background: '#ef4444',
                border: 'none',
                borderRadius: 4,
                padding: '4px 12px',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Delete
            </button>
            <button
              onClick={() => setSelectedMessages(new Set())}
              style={{
                background: 'transparent',
                border: 'none',
                borderRadius: 4,
                padding: '4px 8px',
                color: '#9ca3af',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Cancel
            </button>
          </div>
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
                ref={inputRef}
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

      {/* Reference Panel - 默认折叠，有引用时显示引用，无引用时显示 PDF */}
      {(showReferencePanel || showPdfOnly) && selectedDoc && (
        <>
          {/* Resize Handle */}
          <div
            onPointerDown={(e) => {
              e.preventDefault()
              const target = e.currentTarget as HTMLElement
              target.setPointerCapture(e.pointerId)
              
              const startX = e.clientX
              const container = document.querySelector('.chat-container')
              if (!container) return
              const containerWidth = (container as HTMLElement).offsetWidth
              const startChatWidth = (container as HTMLElement).querySelector('.chat-main-area')?.getBoundingClientRect().width || containerWidth * 0.5
              
              const handlePointerMove = (moveEvent: PointerEvent) => {
                const delta = moveEvent.clientX - startX
                const newChatWidth = ((startChatWidth + delta) / containerWidth) * 100
                setChatWidth(Math.max(30, Math.min(80, newChatWidth)))
              }
              
              const handlePointerUp = (upEvent: PointerEvent) => {
                target.releasePointerCapture(upEvent.pointerId)
                target.removeEventListener('pointermove', handlePointerMove)
                target.removeEventListener('pointerup', handlePointerUp)

                // 拖拽结束后刷新 PDF
                const refreshFn = (window as any).__pdfViewerRefresh
                if (refreshFn) {
                  refreshFn()
                }
              }
              
              target.addEventListener('pointermove', handlePointerMove, { passive: true })
              target.addEventListener('pointerup', handlePointerUp)
            }}
            style={{
              width: 16,
              cursor: 'col-resize',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              position: 'relative',
              zIndex: 100,
            }}
          >
            <div style={{ width: 4, height: 60, background: '#9ca3af', borderRadius: 2, opacity: 0.6 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {showReferencePanel && activeCitations.length > 0 ? (
              <ReferencePanel
                citations={activeCitations}
                selectedIndex={selectedCitationIndex}
                onClose={handleCloseReferencePanel}
                onSelectCitation={handleSelectCitation}
                documentId={selectedDoc || undefined}
              />
            ) : (
              /* 无引用时显示 PDF */
              <div
                style={{
                  width: '100%',
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  borderLeft: '1px solid #e5e7eb',
                  background: '#fff',
                  overflow: 'hidden',
                }}
              >
                {/* PDF Panel Header */}
                <div
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid #e5e7eb',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>
                      PDF 预览
                    </div>
                    {selectedDocs.length > 1 && (
                      <select
                        value={pdfPreviewDocId || selectedDoc || ''}
                        onChange={(e) => {
                          setPdfPreviewDocId(e.target.value)
                          setPdfPage(1)
                        }}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 4,
                          border: '1px solid #e5e7eb',
                          fontSize: 12,
                          color: '#374151',
                          maxWidth: 150,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          cursor: 'pointer',
                          minWidth: 60,
                        }}
                      >
                        {selectedDocs.map(docId => {
                          const doc = documents.find(d => d.id === docId)
                          return (
                            <option key={docId} value={docId}>
                              {doc?.filename || docId}
                            </option>
                          )
                        })}
                      </select>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => setPdfPage(Math.max(1, pdfPage - 1))}
                      disabled={pdfPage <= 1}
                      style={{
                        border: 'none',
                        background: pdfPage <= 1 ? '#f3f4f6' : '#fff',
                        cursor: pdfPage <= 1 ? 'not-allowed' : 'pointer',
                        padding: '4px 8px',
                        borderRadius: 4,
                        color: pdfPage <= 1 ? '#d1d5db' : '#374151',
                        fontSize: 12,
                      }}
                    >
                      <LeftOutlined />
                    </button>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>第 {pdfPage} 页</span>
                    <button
                      onClick={() => setPdfPage(pdfPage + 1)}
                      style={{
                        border: 'none',
                        background: '#fff',
                        cursor: 'pointer',
                        padding: '4px 8px',
                        borderRadius: 4,
                        color: '#374151',
                        fontSize: 12,
                      }}
                    >
                      <RightOutlined />
                    </button>
                    <button
                      onClick={() => {
                        setShowPdfOnly(false)
                        setShowReferencePanel(false)
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        padding: 4,
                        color: '#6b7280',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <CloseOutlined />
                    </button>
                  </div>
                </div>
                {/* PDF Viewer */}
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <PDFViewer
                    url={documentApi.getFileUrl(pdfPreviewDocId || selectedDoc)}
                    page={pdfPage}
                    height={800}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}

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
