import { useEffect, useRef, useState } from 'react'
import { Spin, Typography, Tabs, message } from 'antd'

const { Text } = Typography

interface OfficeViewerProps {
  fileUrl: string
  fileType: 'docx' | 'xlsx' | 'pptx'
}

function DocxViewer({ fileUrl }: { fileUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false

    const render = async () => {
      try {
        const { renderAsync } = await import('docx-preview')
        const response = await fetch(fileUrl)
        const blob = await response.blob()
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = ''
          await renderAsync(blob, containerRef.current, undefined, {
            debug: false,
            inWrapper: true,
          })
        }
      } catch (err) {
        if (!cancelled) message.error('Failed to render DOCX')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    render()
    return () => { cancelled = true }
  }, [fileUrl])

  return (
    <Spin spinning={loading}>
      <div ref={containerRef} style={{ minHeight: 200 }} />
    </Spin>
  )
}

interface SheetData {
  name: string
  headers: string[]
  rows: string[][]
}

function XlsxViewer({ fileUrl }: { fileUrl: string }) {
  const [sheets, setSheets] = useState<SheetData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const XLSX = await import('xlsx')
        const response = await fetch(fileUrl)
        const buffer = await response.arrayBuffer()
        const workbook = XLSX.read(buffer, { type: 'array' })
        const parsed: SheetData[] = workbook.SheetNames.map((name) => {
          const sheet = workbook.Sheets[name]
          const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })
          const headers = (data[0] || []).map(String)
          const rows = data.slice(1).map((row) => row.map(String))
          return { name, headers, rows }
        })
        setSheets(parsed)
      } catch {
        message.error('Failed to render XLSX')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [fileUrl])

  if (loading) return <Spin tip="Loading..." />
  if (sheets.length === 0) return <Text type="secondary">No data</Text>

  const tabItems = sheets.map((sheet) => ({
    key: sheet.name,
    label: sheet.name,
    children: (
      <div style={{ overflow: 'auto', maxHeight: 500 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {sheet.headers.map((h, i) => (
                <th key={i} style={{ border: '1px solid #d9d9d9', padding: '6px 8px', background: '#fafafa', fontWeight: 600, textAlign: 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{ border: '1px solid #d9d9d9', padding: '6px 8px' }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  }))

  return sheets.length === 1
    ? tabItems[0].children
    : <Tabs items={tabItems} size="small" />
}

function PptxViewer({ fileUrl }: { fileUrl: string }) {
  return (
    <div style={{ textAlign: 'center', padding: 40 }}>
      <Text type="secondary">
        PowerPoint preview is not available in browser.{' '}
        <a href={fileUrl} target="_blank" rel="noopener noreferrer">
          Download file
        </a>
      </Text>
    </div>
  )
}

export default function OfficeViewer({ fileUrl, fileType }: OfficeViewerProps) {
  switch (fileType) {
    case 'docx':
      return <DocxViewer fileUrl={fileUrl} />
    case 'xlsx':
      return <XlsxViewer fileUrl={fileUrl} />
    case 'pptx':
      return <PptxViewer fileUrl={fileUrl} />
    default:
      return <Text type="secondary">Unsupported file type</Text>
  }
}
