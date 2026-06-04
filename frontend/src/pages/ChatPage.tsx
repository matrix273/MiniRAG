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
  PauseOutlined,
  DownloadOutlined,
} from '@ant-design/icons'
import { chatApi, documentApi, folderApi } from '@/services/api'
import type { ChatSession, Document, Folder } from '@/types'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import ReferencePanel from '@/components/ReferencePanel'
import PDFViewer from '@/components/PDFViewer'
import OfficeViewer from '@/components/OfficeViewer'
import MDViewer from '@/components/MDViewer'
import GenericFileViewer from '@/components/GenericFileViewer'

const { Text } = Typography

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  citations?: Array<{
    page: number
    text: string
    node_title?: string
    document_id?: string
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
            {new Date(session.created_at).toLocaleString('en-US', { 
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
  onCitationClick?: (citations: Array<{ page: number; text: string; node_title?: string; document_id?: string }>, index: number) => void
  isSelected?: boolean
  onToggleSelect?: () => void
  selectedDoc?: string | null
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ msg, onCitationClick, isSelected, onToggleSelect, selectedDoc }) => {
  const { message } = App.useApp()
  const isUser = msg.role === 'user'
  const [copied, setCopied] = useState(false)


  // 预处理 markdown 内容：确保 $$ 块级公式被 remark-math 正确识别为 flow math
  const preprocessMarkdown = (content: string): string => {
    let result = content
    // 将同行的 $$ formula $$ 转为 flow math 格式（$$ 独占一行）
    // remark-math v6 中，$$ formula $$ 在同一行会被视为 mathText（行内），而非 math（块级）
    result = result.replace(/\$\$\s*([\s\S]+?)\s*\$\$/g, (_match, formula) => {
      return `\n\n$$\n${formula.trim()}\n$$\n\n`
    })
    return result
  }

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
        flexDirection: 'row',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        alignItems: 'flex-start',
        gap: 0,
        position: 'relative',
        width: '100%',
      }}
    >
      {/* Selection checkbox - AI messages: left side (before avatar), User messages: right side */}
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
            opacity: 1,
            transition: 'opacity 0.2s',
            marginTop: 6,
            order: isUser ? 999 : -1, // AI 消息在左侧，用户消息在右侧
            marginRight: isUser ? 8 : 0, // AI 消息 checkbox 最左侧，不设 margin
          }}
        >
          {isSelected && (
            <CheckOutlined style={{ fontSize: 12, color: '#fff' }} />
          )}
        </div>
      )}

      {/* Avatar - only for AI messages */}
      {!isUser && (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: '#e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontSize: 14,
            color: '#374151',
            fontWeight: 600,
            marginRight: 16,
            marginTop: 2,
          }}
        >
          A
        </div>
      )}

      {/* Content wrapper */}
      <div
        style={{
          minWidth: 0,
          maxWidth: isUser ? 'max-content' : '100%',
          position: 'relative',
          borderRadius: isUser ? 12 : 0,
        }}
      >
        {/* Message content */}
        <div
          style={{
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
          }}
        >
          {/* Render markdown for assistant, plain text for user */}
          {isUser ? (
            <div style={{ color: '#343541', lineHeight: 1.6, whiteSpace: 'pre-wrap', fontSize: 16, background: '#f3f4f6', padding: '8px 12px', borderRadius: 12 }}>{msg.content}</div>
          ) : (
            <div className="markdown-body" style={{ color: '#343541', lineHeight: 1.7 }}>
              <ReactMarkdown
                remarkPlugins={[remarkMath, remarkGfm]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  pre({ children }) {
                    // 保留 <pre> 标签，避免行内 code 被错误匹配到块级渲染路径
                    return <pre style={{ margin: 0, padding: 0, background: 'transparent', border: 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit' }}>{children}</pre>
                  },
                  code({ className, children, ...props }: any) {
                    // react-markdown v9 不再传递 inline prop，
                    // 改为通过 className 是否包含 language- 前缀来区分块级/行内代码
                    const match = /language-(\w+)/.exec(className || '')
                    
                    if (!match) {
                      // 没有 language- 类 → 行内代码（单反引号）
                      const isLongCode = String(children).includes('\n')
                      return (
                        <code
                          style={{
                            background: '#f3f4f6',
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontSize: 14,
                            color: '#1e293b',
                            whiteSpace: isLongCode ? 'pre-wrap' : 'nowrap',
                          }}
                          {...props}
                        >
                          {children}
                        </code>
                      )
                    }
                    
                    const language = match[1]
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
                    
                    return <p style={{ margin: 0 }}>{children}</p>
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
                  a({ href, children, ...props }: any) {
                    // 检查是否是 citation 链接: #citation-page-N
                    const citationMatch = href?.match(/^#citation-page-(\d+)$/)
                    if (citationMatch) {
                      const pageNum = parseInt(citationMatch[1], 10)
                      const citationIndex = msg.citations?.findIndex(c => c.page === pageNum) ?? -1
                      
                      return (
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            if (citationIndex >= 0 && msg.citations) {
                              onCitationClick?.(msg.citations, citationIndex)
                            } else {
                              const tempCitation = {
                                page: pageNum,
                                text: '',
                                node_title: children?.toString() || `Page ${pageNum}`,
                                document_id: selectedDoc || undefined,
                              }
                              onCitationClick?.([tempCitation], 0)
                            }
                          }}
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
                          title="View citation source"
                        >
                          {children}
                        </button>
                      )
                    }
                    
                    // 普通链接
                    return (
                      <a 
                        href={href} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        style={{ color: '#3b82f6', textDecoration: 'underline' }}
                        {...props}
                      >
                        {children}
                      </a>
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
                        <div style={{ position: 'relative', margin: '16px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                          <div style={{ textAlign: 'center' }}>
                            <span>{children}</span>
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
                {preprocessMarkdown(msg.content)}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Action buttons - show on hover */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginTop: 4,
            opacity: 1,
            pointerEvents: 'auto',
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
        </div>
      </div>

    </div>
  )
}

const ChatPage = () => {
  const { message } = App.useApp()
  const [documents, setDocuments] = useState<Document[]>([])
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSession, setCurrentSession] = useState<string | null>(() => {
    const saved = localStorage.getItem('chatCurrentSession')
    return saved || null
  })
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
  const panelMountedRef = useRef(false) // 面板是否已挂载过（用于保持 DOM 不变、保留 iframe 滚动位置）
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
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

  // 知识库树状态
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

  // 注意：文档选择变化时，由 TreeSelect onChange 显式调用 handleSelectDocs
  // 不再通过 useEffect 自动触发，避免 handleSelectSession 恢复会话时误过滤会话列表

  // 键盘快捷键：q 折叠/展开聊天记录侧边栏
  useEffect(() => {
    const isFormField = (target: EventTarget | null) => {
      if (!target || !(target instanceof HTMLElement)) return false
      const tag = target.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // 表单元素中输入时跳过
      if (isFormField(e.target)) return
      if (e.key === 'q') {
        e.preventDefault()
        const newCollapsed = !sidebarCollapsed
        setSidebarCollapsed(newCollapsed)
        localStorage.setItem('chatSidebarCollapsed', JSON.stringify(newCollapsed))
        // 折叠/展开后刷新 PDF
        setTimeout(() => {
          const refreshFn = (window as any).__pdfViewerRefresh
          if (refreshFn) refreshFn()
        }, 100)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sidebarCollapsed])

  // 键盘快捷键：w 切换知识库预览，Esc 关闭预览
  useEffect(() => {
    const isFormField = (target: EventTarget | null) => {
      if (!target || !(target instanceof HTMLElement)) return false
      const tag = target.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
    }

    const togglePreview = () => {
      if (showPdfOnly || showReferencePanel) {
        setShowPdfOnly(false)
        setShowReferencePanel(false)
      } else {
        setShowPdfOnly(true)
      }
      // 折叠/展开后刷新 PDF
      setTimeout(() => {
        const refreshFn = (window as any).__pdfViewerRefresh
        if (refreshFn) refreshFn()
      }, 100)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Esc 关闭预览（始终生效，方便退出预览）
      if (e.key === 'Escape' && (showPdfOnly || showReferencePanel)) {
        // 如果焦点在表单元素上，让浏览器/组件自行处理 Esc（例如关闭自动补全）
        if (isFormField(e.target)) return
        e.preventDefault()
        setShowPdfOnly(false)
        setShowReferencePanel(false)
        return
      }

      // 表单元素中输入时，不触发全局快捷键，避免冲突
      if (isFormField(e.target)) return

      // w：切换知识库预览
      if (e.key === 'w') {
        e.preventDefault()
        togglePreview()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPdfOnly, showReferencePanel])


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
      // 递归收集该知识库下所有文档（含子知识库）
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
        // 递归查找知识库及其子知识库中的所有文档
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
    try {
      if (selectedDoc) {
        // 有选中文档 → 按现有逻辑创建 session
        const session = await chatApi.createSession(selectedDoc, 'New Chat', selectedDocs)
        setSessions([session, ...sessions])
        setCurrentSession(session.id)
        setMessages([])
      } else {
        // 无选中文档 → 直接创建 auto session（不再检查向量数据库）
        const session = await chatApi.createAutoSession('New Chat')
        setSessions([session, ...sessions])
        setCurrentSession(session.id)
        setMessages([])
      }

      // 创建新会话后聚焦到输入框
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    } catch (error) {
      message.error('Failed to create session')
    }
  }

  const handleStopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setSending(false)
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

    // 创建 AbortController 用于取消流式请求
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    // 检查是否是第一条消息（用于自动重命名）
    const isFirstMessage = messages.length === 0

    // 创建一个临时的 AI 消息，用于流式更新
    const aiMsgId = Date.now().toString() + '-ai'
    const aiMsg: Message = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, aiMsg])

    try {
      await chatApi.sendMessageStream(
        currentSession,
        inputMessage,
        // onDelta: 收到文本增量
        (text) => {
          setMessages(prev => prev.map(msg => 
            msg.id === aiMsgId 
              ? { ...msg, content: msg.content + text }
              : msg
          ))
        },
        // onToolCall: 工具调用
        (tool) => {
          console.log('Tool call:', tool)
        },
        // onDone: 完成 — 将格式化的 citations 设置到消息中，如果提供 full_text 则用它替换累积的文本
        (citations, fullText) => {
          setMessages(prev => prev.map(msg => 
            msg.id === aiMsgId 
              ? { 
                  ...msg, 
                  citations: citations && citations.length > 0 ? citations : msg.citations,
                  content: fullText || msg.content
                }
              : msg
          ))
        },
        // onError: 错误
        (error) => {
          message.error(error)
          // 移除空的 AI 消息
          setMessages(prev => prev.filter(msg => msg.id !== aiMsgId))
        },
        // signal: 用于取消流式请求
        abortController.signal,
      )
      
      // 自动重命名会话（类似 ChatGPT）
      // 只在第一条消息时自动重命名
      const session = sessions.find(s => s.id === currentSession)
      if (session && session.title === 'New Chat' && isFirstMessage) {
        // 使用用户消息的前 20 个字符作为标题
        const newTitle = inputMessage.slice(0, 20) + (inputMessage.length > 20 ? '...' : '')
        await handleRenameSession(currentSession, newTitle)
      }
    } catch (error: any) {
      // 用户主动停止（abort）时不报错
      if (error?.name === 'AbortError' || error?.message?.includes('abort')) {
        // 静默处理：保留已收到的部分文本
      } else {
        message.error('Failed to send message')
        // 移除空的 AI 消息
        setMessages(prev => prev.filter(msg => msg.id !== aiMsgId))
      }
    } finally {
      setSending(false)
    }
  }

  // 持久化 currentSession 到 localStorage
  useEffect(() => {
    if (currentSession) {
      localStorage.setItem('chatCurrentSession', currentSession)
    } else {
      localStorage.removeItem('chatCurrentSession')
    }
  }, [currentSession])

  const loadAllSessions = async (restore = true) => {
    try {
      const allSessions = await chatApi.listAllSessions()
      setSessions(allSessions)
      setMessages([])
      if (restore) {
        // 尝试恢复上次激活的会话——模拟点击会话
        const savedSessionId = localStorage.getItem('chatCurrentSession')
        const savedSession = allSessions.find(s => s.id === savedSessionId)
        if (savedSession) {
          await handleSelectSession(savedSession.id, savedSession)
          return
        }
      }
      setCurrentSession(null)
    } catch {
      message.error('Failed to load sessions')
    }
  }

  const handleSelectSession = async (sessionId: string, sessionOverride?: ChatSession) => {
    setCurrentSession(sessionId)

    // 加载会话消息
    const msgs = await chatApi.getMessages(sessionId)
    setMessages(msgs as Message[])

    // 查找会话关联的文档
    const session = sessionOverride || sessions.find(s => s.id === sessionId)
    if (session) {
      const docIds = session.document_ids || (session.document_id ? [session.document_id] : [])
      if (docIds.length > 0) {
        setSelectedDoc(docIds[0])
        setSelectedDocs(docIds)
      } else {
        // auto 会话无关联文档，仅重置 selectedDoc
        setSelectedDoc(null)
        // 避免 setSelectedDocs([]) 触发 useEffect → loadAllSessions 清掉刚选中的会话
        // 只有当 selectedDocs 非空时才清空，否则保持不变（已经是 []）
        setSelectedDocs(prev => prev.length > 0 ? [] : prev)
      }

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
      await loadAllSessions(false)
      return
    }

    const primaryDocId = docIds[0]
    setSelectedDoc(primaryDocId)

    // 尝试找到一个已有会话，其 document_ids 与当前选中完全匹配
    const allSessions = await chatApi.listSessions(primaryDocId)
    setSessions(allSessions)

    const matchSession = allSessions.find((s: any) => {
      const sessionDocIds = s.document_ids || (s.document_id ? [s.document_id] : [])
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

  // 导出聊天记录为 Markdown
  const exportChatToMarkdown = (onlySelected = false) => {
    const msgsToExport = onlySelected
      ? messages.filter(m => selectedMessages.has(m.id))
      : messages

    if (msgsToExport.length === 0) {
      message.info('No messages to export')
      return
    }

    // 构建文档标题和已选文档列表
    let docTitle: string
    let docListLines: string[] = []

    if (selectedDocs.length > 0) {
      const names = selectedDocsInfo.map(d => d!.filename)
      docTitle = names.length === 1 ? names[0] : `${names.length} documents`
      docListLines = ['', '**Selected documents:**', ...names.map(n => `- ${n}`), '']
    } else {
      // 自动匹配模式：从消息 citations 中收集实际引用的文档
      const referencedDocIds = new Set<string>()
      const refDocNames: string[] = []
      for (const msg of msgsToExport) {
        for (const c of msg.citations || []) {
          if (c.document_id && !referencedDocIds.has(c.document_id)) {
            referencedDocIds.add(c.document_id)
            const doc = documents.find(d => d.id === c.document_id)
            if (doc) refDocNames.push(doc.filename)
          }
        }
      }
      if (refDocNames.length > 0) {
        docTitle = `Auto-matched — ${refDocNames.length} documents`
        docListLines = ['', '**Auto-matched documents:**', ...refDocNames.map(n => `- ${n}`), '']
      } else {
        docTitle = 'auto match file'
        docListLines = ['', '*Auto-match mode — no knowledge base specified*', '']
      }
    }

    const lines: string[] = []
    lines.push(`# Chat History — ${docTitle}`)
    lines.push('')
    lines.push(`> Exported: ${new Date().toLocaleString('en-US')}`)
    if (docListLines.length > 0) {
      lines.push(...docListLines)
    }
    lines.push('---')
    lines.push('')

    for (const msg of msgsToExport) {
      const roleLabel = msg.role === 'user' ? '👤 User' : msg.role === 'assistant' ? '🤖 AI' : '⚙️ System'
      const time = new Date(msg.created_at).toLocaleString('en-US')
      const hasCitationLinks = msg.role === 'assistant' && /\(#citation-page-\d+\)/.test(msg.content)

      // 消息分隔符 + 角色标识
      lines.push('---')
      lines.push(`### ${roleLabel} — *${time}*`)
      lines.push('')

      if (msg.role === 'assistant') {
        // 处理 AI 消息：将 citation 链接转为纯文本引用
        let content = msg.content
        // 匹配 [text](#citation-page-N) 格式的 citation 链接
        content = content.replace(
          /\[([^\]]*)\]\(#citation-page-(\d+)\)/g,
          (_match, displayText, pageNum) => {
            const pNum = parseInt(pageNum, 10)
            // 尝试在 citations 数组中找到对应条目获取引用原文
            const citation = msg.citations?.find(c => c.page === pNum)
            const snippet = citation?.text
              ? `: "${citation.text.slice(0, 80)}${citation.text.length > 80 ? '...' : ''}"`
              : ''
            return `**${displayText || `p.${pageNum}`}** *(引用 p.${pageNum}${snippet})*`
          }
        )
        lines.push(content)
      } else {
        lines.push(msg.content)
      }

      // 仅当 AI 回答中实际包含可点击的引用链接时，才追加参考引用列表
      if (hasCitationLinks && msg.citations && msg.citations.length > 0) {
        lines.push('')
        lines.push('> 📖 **参考引用**')
        const seen = new Set<string>()
        for (const c of msg.citations) {
          const key = `${c.page}-${c.text.slice(0, 30)}`
          if (seen.has(key)) continue
          seen.add(key)
          const snippet = c.text ? ` — "${c.text.slice(0, 100)}${c.text.length > 100 ? '...' : ''}"` : ''
          lines.push(`> - Page ${c.page}${snippet}`)
        }
      }
    }

    const markdown = lines.join('\n')
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeTitle = docTitle.replace(/[^\w\u4e00-\u9fa5.-]/g, '_')
    const now = new Date()
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
    a.download = `chat_${safeTitle}_${timestamp}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    message.success(`Exported ${msgsToExport.length} messages`)
    if (onlySelected) {
      setSelectedMessages(new Set())
    }
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
          <Tooltip title="Collapse chat history (q)">
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
          </Tooltip>
        </div>

        {/* Document Selector - Tree Select (Multiple, Optional) */}
        <div style={{ padding: 16, borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text type="secondary" style={{ fontSize: 12, color: '#6b7280' }}>
              Based on knowledge base (optional, leave empty for auto-match)
            </Text>
              {selectedDocs.length > 0 && (
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                onClick={async () => {
                  setSelectedDoc(null)
                  setSelectedDocs([])
                  await loadAllSessions(false)
                }}
                style={{
                  fontSize: 11,
                  color: '#ef4444',
                  height: 22,
                  padding: '0 6px',
                  borderRadius: 4,
                }}
              >
                Clear
              </Button>
            )}
          </div>
          <TreeSelect
            style={{ width: '100%' }}
            value={selectedDocs.map(id => ({ value: `doc:${id}`, checked: true }))}
            treeData={treeData}
            placeholder="Select knowledge base (optional, leave empty for auto-match)"
            treeDefaultExpandAll
            showSearch
            multiple
            maxTagCount="responsive"
            treeCheckStrictly
            allowClear
            getPopupContainer={() => document.body}
            filterTreeNode={(input, node) =>
              String(node?.title ?? '').toLowerCase().includes(input.toLowerCase())
            }
            onChange={async (values: any[]) => {
              // treeCheckStrictly 模式下 values 为 { value: string, checked: boolean }[]，提取 value 字符串
              const stringValues = values.map(v => (typeof v === 'string' ? v : v.value))
              const docIds = resolveTreeValues(stringValues)
              if (docIds.length === 0) {
                // TreeSelect 自带的 X/tag 关闭等操作清空时，同步重置 selectedDoc 并刷新全量会话
                setSelectedDoc(null)
                setSelectedDocs([])
                await loadAllSessions(false)
              } else {
                await handleSelectDocs(docIds)
              }
            }}
            treeCheckable
            showCheckedStrategy={TreeSelect.SHOW_CHILD}
            styles={{ popup: { root: { borderRadius: 8 } } }}
          />
        </div>

        {/* New Chat Button */}
        <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
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
            {selectedDocs.length > 0 ? `Chat with ${selectedDocs.length} knowledge base(s)` : 'New Chat (Auto-match)'}
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
                <Tooltip title="Expand chat history (q)">
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
                </Tooltip>
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
                  <div style={{ fontWeight: 500, fontSize: 14, color: '#6b7280' }}>auto match file</div>
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
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    {
                      key: 'export-all',
                      icon: <DownloadOutlined />,
                      label: 'Export all chat history',
                      disabled: messages.length === 0,
                      onClick: () => exportChatToMarkdown(false),
                    },
                    {
                      key: 'export-selected',
                      icon: <DownloadOutlined />,
                      label: `Export selected messages (${selectedMessages.size})`,
                      disabled: selectedMessages.size === 0,
                      onClick: () => exportChatToMarkdown(true),
                    },
                    { type: 'divider' },
                    {
                      key: 'clear-selection',
                      label: selectedMessages.size > 0 ? 'Deselect all' : 'Select all messages',
                      onClick: () => {
                        if (selectedMessages.size > 0) {
                          setSelectedMessages(new Set())
                        } else {
                          setSelectedMessages(new Set(messages.map(m => m.id)))
                        }
                      },
                    },
                  ],
                }}
              >
                <Tooltip title="More options">
                  <Button type="text" icon={<MoreOutlined />} />
                </Tooltip>
              </Dropdown>
            </div>
          </div>

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
              <div style={{ fontSize: 14, textAlign: 'center', maxWidth: 480 }}>
                {selectedDocsInfo.length === 0 ? (
                  <>
                    Ask questions directly, I'll auto-match the most relevant knowledge base to answer.<br />
                    <span style={{ color: '#9ca3af' }}>You can also select a specific knowledge base on the left.</span>
                  </>
                ) : selectedDocsInfo.length === 1 ? (
                  <>Ask questions about <strong>{selectedDocsInfo[0]?.filename}</strong></>
                ) : (
                  <>Ask questions about <strong>{selectedDocsInfo.length} documents</strong></>
                )}
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: '24px 32px',
                maxWidth: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
              }}
            >
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    marginBottom: 24,
                    animation: 'fadeIn 0.3s ease-out',
                  }}
                >
                  <MessageBubble msg={msg} onCitationClick={handleCitationClick} isSelected={selectedMessages.has(msg.id)} onToggleSelect={() => toggleMessageSelection(msg.id)} selectedDoc={selectedDoc} />
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
        <Tooltip title={(showPdfOnly || showReferencePanel ? "Close knowledge base preview" : "Show knowledge base preview") + " (w, Esc)"}>
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
              KB
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
              onClick={() => exportChatToMarkdown(true)}
              style={{
                background: '#6366f1',
                border: 'none',
                borderRadius: 4,
                padding: '4px 12px',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <DownloadOutlined style={{ fontSize: 12 }} />
              Export
            </button>
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
              {sending ? (
                <Button
                  type="primary"
                  icon={<PauseOutlined />}
                  onClick={handleStopStreaming}
                  style={{
                    borderRadius: 10,
                    height: 44,
                    width: 44,
                    background: '#ef4444',
                    borderColor: 'transparent',
                  }}
                />
              ) : (
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={handleSendMessage}
                  disabled={!currentSession || !inputMessage.trim()}
                  style={{
                    borderRadius: 10,
                    height: 44,
                    width: 44,
                    background: inputMessage.trim() ? '#111827' : '#d1d5db',
                    borderColor: 'transparent',
                  }}
                />
              )}
            </div>
            <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block', textAlign: 'center', color: '#9ca3af' }}>
              AI may produce inaccurate information. Double-check important info.
            </Text>
          </div>
        </div>
      </div>

      {/* Reference Panel - 默认折叠，有引用时显示引用，无引用时显示 PDF */}
      {/* 保持 DOM 不变，用 display 控制显隐，保留 iframe 页面和滚动位置 */}
      {(() => {
        const visible = (showPdfOnly && selectedDoc) || (showReferencePanel && activeCitations.length > 0)
        if (visible) panelMountedRef.current = true
        if (!panelMountedRef.current) return null
        return (
        <div style={{ display: visible ? 'flex' : 'none', flex: 1, minWidth: 0 }}>
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
                      Knowledge Base Preview
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
                    {(() => {
                      const previewDocId = pdfPreviewDocId || selectedDoc
                      const previewDoc = documents.find(d => d.id === previewDocId)
                      const isOfficeFile = previewDoc && ['docx', 'xlsx', 'pptx'].includes(previewDoc.doc_type)
                      if (!isOfficeFile) {
                        return (
                          <>
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
                            <span style={{ fontSize: 12, color: '#6b7280' }}>Page {pdfPage}</span>
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
                          </>
                        )
                      }
                      return null
                    })()}
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
                  {(() => {
                    const previewDocId = pdfPreviewDocId || selectedDoc
                    if (!previewDocId) {
                      return <div style={{ padding: 20, color: '#9ca3af', textAlign: 'center' }}>Select a document</div>
                    }
                    const previewDoc = documents.find(d => d.id === previewDocId)
                    const docType = previewDoc?.doc_type || 'pdf'
                    
                    // PDF files
                    if (docType === 'pdf') {
                      return (
                        <PDFViewer
                          url={documentApi.getFileUrl(previewDocId)}
                          page={pdfPage}
                          height={800}
                          docId={previewDocId}
                        />
                      )
                    }
                    
                    // Markdown files
                    if (docType === 'md') {
                      return (
                        <MDViewer
                          fileUrl={documentApi.getFileUrl(previewDocId)}
                          docId={previewDocId}
                        />
                      )
                    }
                    
                    // Office files
                    if (['docx', 'xlsx', 'pptx'].includes(docType)) {
                      return (
                        <OfficeViewer
                          fileUrl={documentApi.getFileUrl(previewDocId)}
                          fileType={docType as 'docx' | 'xlsx' | 'pptx'}
                          docId={previewDocId}
                        />
                      )
                    }
                    
                    // Other unsupported formats
                    return (
                      <GenericFileViewer
                        fileUrl={documentApi.getFileUrl(previewDocId)}
                        fileType={docType}
                        filename={previewDoc?.filename || 'file'}
                      />
                    )
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
        )
      })()}

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
