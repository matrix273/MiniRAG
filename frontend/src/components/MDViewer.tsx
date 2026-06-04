import { useEffect, useState } from 'react'
import { Typography, Spin } from 'antd'
import { fileCache } from '@/utils/fileCache'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

const { Text } = Typography

interface MDViewerProps {
  fileUrl: string
  docId?: string
}

function extractDocId(url: string): string | undefined {
  const match = url.match(/\/api\/documents\/([^/]+)\/file/)
  return match?.[1]
}

export default function MDViewer({ fileUrl, docId }: MDViewerProps) {
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const resolvedDocId = docId || extractDocId(fileUrl)

  useEffect(() => {
    const loadContent = async () => {
      setLoading(true)
      setError(null)
      
      try {
        let text: string
        
        if (resolvedDocId) {
          const blob = await fileCache.fetch(resolvedDocId, fileUrl)
          text = await blob.text()
        } else {
          const response = await fetch(fileUrl)
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
          }
          text = await response.text()
        }
        
        setContent(text)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load markdown')
      } finally {
        setLoading(false)
      }
    }

    loadContent()
  }, [fileUrl, resolvedDocId])

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        height: '100%',
        padding: 20 
      }}>
        <Spin tip="Loading..." fullscreen />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <Text type="danger">{error}</Text>
      </div>
    )
  }

  return (
    <div style={{ 
      flex: 1, 
      overflow: 'auto', 
      padding: '24px',
      background: '#fff',
      minHeight: 0,
    }}>
      <div className="markdown-body" style={{ color: '#24292f', lineHeight: 1.7, fontSize: 15 }}>
        <ReactMarkdown
          remarkPlugins={[remarkMath, remarkGfm]}
          rehypePlugins={[rehypeKatex]}
          components={{
            pre({ children }) {
              return <pre style={{ margin: 0, padding: 0, background: 'transparent', border: 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit' }}>{children}</pre>
            },
            code({ className, children, ...props }: any) {
              const match = /language-(\w+)/.exec(className || '')
              
              if (!match) {
                return (
                  <code
                    style={{
                      background: '#f3f4f6',
                      padding: '2px 6px',
                      borderRadius: 4,
                      fontSize: 13,
                      color: '#1e293b',
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
                  </div>
                  <SyntaxHighlighter
                    style={oneDark}
                    language={language}
                    PreTag="div"
                    customStyle={{
                      margin: 0,
                      borderRadius: '0 0 8px 8px',
                      fontSize: 13,
                    }}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                </div>
              )
            },
            h1({ children }) {
              return <h1 style={{ margin: '24px 0 12px', fontSize: 24, fontWeight: 600, borderBottom: '1px solid #e5e7eb', paddingBottom: 8 }}>{children}</h1>
            },
            h2({ children }) {
              return <h2 style={{ margin: '20px 0 10px', fontSize: 20, fontWeight: 600, borderBottom: '1px solid #e5e7eb', paddingBottom: 6 }}>{children}</h2>
            },
            h3({ children }) {
              return <h3 style={{ margin: '16px 0 8px', fontSize: 17, fontWeight: 600 }}>{children}</h3>
            },
            p({ children }) {
              return <p style={{ margin: '8px 0' }}>{children}</p>
            },
            ul({ children }) {
              return <ul style={{ margin: '8px 0', paddingLeft: 24 }}>{children}</ul>
            },
            ol({ children }) {
              return <ol style={{ margin: '8px 0', paddingLeft: 24 }}>{children}</ol>
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
                    borderLeft: '4px solid #6366f1',
                    background: '#f5f3ff',
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
              return (
                <a 
                  href={href} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{ color: '#6366f1', textDecoration: 'underline' }}
                  {...props}
                >
                  {children}
                </a>
              )
            },
            hr() {
              return <hr style={{ margin: '20px 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />
            },
            img({ src, alt }: any) {
              return <img src={src} alt={alt} style={{ maxWidth: '100%', borderRadius: 8, margin: '8px 0' }} />
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}
