import { useEffect, useRef, useState } from 'react'
import { Spin, Typography, message } from 'antd'

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
    <Spin spinning={loading} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div ref={containerRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }} />
    </Spin>
  )
}

interface SheetData {
  name: string
  allRows: string[][]  // 所有原始数据行
}

interface RawSheetData {
  name: string
  rows: string[][]  // 所有原始数据行（含标题行）
}

// 智能检测表头行：找非空单元格最多的行
function detectHeaderRowIndex(rows: string[][]): number {
  if (rows.length <= 1) return 0
  let maxCount = 0
  let bestIndex = 0
  // 最多检查前 5 行
  const limit = Math.min(rows.length, 5)
  for (let i = 0; i < limit; i++) {
    const count = rows[i].filter((c) => c !== '').length
    if (count > maxCount) {
      maxCount = count
      bestIndex = i
    }
  }
  return bestIndex
}

const BATCH_SIZE = 200

function XlsxViewer({ fileUrl }: { fileUrl: string }) {
  const [sheets, setSheets] = useState<RawSheetData[]>([])
  const [loading, setLoading] = useState(true)
  const [activeSheet, setActiveSheet] = useState(0)
  const [headerRowBySheet, setHeaderRowBySheet] = useState<Record<number, number>>({})
  const [filters, setFilters] = useState<Record<number, string>>({})
  const [showFilters, setShowFilters] = useState(false)
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const XLSX = await import('xlsx')
        const response = await fetch(fileUrl)
        const buffer = await response.arrayBuffer()
        const workbook = XLSX.read(buffer, { type: 'array' })
        const parsed: RawSheetData[] = workbook.SheetNames.map((name) => {
          const sheet = workbook.Sheets[name]
          const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })
          const rows = data.map((row) => row.map(String))
          return { name, rows }
        })
        setSheets(parsed)
        // 为每个 sheet 自动检测表头行
        const detected: Record<number, number> = {}
        parsed.forEach((sheet, index) => {
          detected[index] = detectHeaderRowIndex(sheet.rows)
        })
        setHeaderRowBySheet(detected)
      } catch {
        message.error('Failed to render XLSX')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [fileUrl])

  // 获取当前 sheet 的表头行索引
  const headerRowIndex = headerRowBySheet[activeSheet] ?? 0
  const currentSheet = sheets[activeSheet]
  // 构建 SheetData
  const sheetData: SheetData | null = currentSheet ? {
    name: currentSheet.name,
    allRows: currentSheet.rows,
  } : null
  const headers = sheetData ? (sheetData.allRows[headerRowIndex] || []).map(String) : []
  const dataRows = sheetData
    ? sheetData.allRows.slice(headerRowIndex + 1).map((row) => row.map(String))
    : []

  // 计算自动列宽
  const calculateColumnWidths = (): number[] => {
    if (!headers.length) return []
    return headers.map((h, i) => {
      let maxWidth = (h.length || 1) * 9 + 16
      dataRows.forEach((row) => {
        const cell = row[i] || ''
        const cellWidth = Math.min(cell.length, 40) * 9 + 16
        if (cellWidth > maxWidth) maxWidth = cellWidth
      })
      return Math.min(Math.max(maxWidth, 60), 300)
    })
  }

  // 根据筛选条件过滤行
  const getFilteredRows = () => {
    return dataRows.filter((row) => {
      return Object.entries(filters).every(([colIndex, filterValue]) => {
        if (!filterValue) return true
        const cellValue = row[parseInt(colIndex)] || ''
        return cellValue.toLowerCase().includes(filterValue.toLowerCase())
      })
    })
  }

  if (loading) return <Spin tip="Loading..." />
  if (!sheetData) return <Text type="secondary">No data</Text>

  const filteredRows = getFilteredRows()
  const columnWidths = calculateColumnWidths()

  // 滚动加载更多行
  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
      setVisibleCount((prev) => Math.min(prev + BATCH_SIZE, filteredRows.length))
    }
  }

  const handleFilterChange = (colIndex: number, value: string) => {
    setFilters((prev) => ({ ...prev, [colIndex]: value }))
    setVisibleCount(BATCH_SIZE)
  }

  const clearFilters = () => {
    setFilters({})
    setVisibleCount(BATCH_SIZE)
  }

  const setHeaderRow = (index: number) => {
    setHeaderRowBySheet((prev) => ({ ...prev, [activeSheet]: index }))
    setFilters({})
    setVisibleCount(BATCH_SIZE)
  }

  // 可选表头行数（最多显示前 10 行供选择）
  const maxHeaderOptions = Math.min(sheetData.allRows.length, 10)

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* 工具栏 */}
      <div style={{ 
        padding: '8px 12px', 
        borderBottom: '1px solid #e5e7eb',
        display: 'flex', 
        alignItems: 'center', 
        gap: 8,
        background: '#fafafa',
        flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        {sheets.length > 1 && (
          <div style={{ display: 'flex', gap: 4 }}>
            {sheets.map((sheet, index) => (
              <button
                key={sheet.name}
                onClick={() => {
                  setActiveSheet(index)
                  setFilters({})
                  setVisibleCount(BATCH_SIZE)
                }}
                style={{
                  padding: '4px 12px',
                  border: '1px solid #d9d9d9',
                  borderRadius: 4,
                  background: activeSheet === index ? '#1890ff' : '#fff',
                  color: activeSheet === index ? '#fff' : '#333',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: activeSheet === index ? 600 : 400,
                }}
              >
                {sheet.name}
              </button>
            ))}
          </div>
        )}

        {/* 表头行选择 */}
        {maxHeaderOptions > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#666', whiteSpace: 'nowrap' }}>表头行:</span>
            <select
              value={headerRowIndex}
              onChange={(e) => setHeaderRow(parseInt(e.target.value))}
              style={{
                padding: '3px 6px',
                border: '1px solid #d9d9d9',
                borderRadius: 4,
                fontSize: 12,
                cursor: 'pointer',
                background: '#fff',
              }}
            >
              {Array.from({ length: maxHeaderOptions }, (_, i) => {
                const preview = (sheetData.allRows[i] || []).slice(0, 3).filter(Boolean).join(', ')
                return (
                  <option key={i} value={i}>
                    第{i + 1}行 {preview ? `- ${preview}${(sheetData.allRows[i] || []).length > 3 ? '...' : ''}` : '(空)'}
                  </option>
                )
              })}
            </select>
          </div>
        )}

        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowFilters(!showFilters)}
          style={{
            padding: '4px 8px',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            background: showFilters ? '#1890ff' : '#fff',
            color: showFilters ? '#fff' : '#666',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          {showFilters ? '隐藏筛选' : '显示筛选'}
        </button>
        {Object.keys(filters).some((k) => filters[parseInt(k)]) && (
          <button
            onClick={clearFilters}
            style={{
              padding: '4px 8px',
              border: '1px solid #ff4d4f',
              borderRadius: 4,
              background: '#fff',
              color: '#ff4d4f',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            清除筛选
          </button>
        )}
        <span style={{ fontSize: 12, color: '#999', whiteSpace: 'nowrap' }}>
          {filteredRows.length > visibleCount
            ? `显示 ${visibleCount} / ${filteredRows.length} 行（滚动加载更多）`
            : `${filteredRows.length} / ${dataRows.length} 行`}
        </span>
      </div>

      {/* 表格内容 */}
      <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, tableLayout: 'fixed' }}>
          <thead>
            {/* 筛选行 */}
            {showFilters && (
              <tr style={{ background: '#e8f4fd' }}>
                {headers.map((_, i) => (
                  <th
                    key={`filter-${i}`}
                    style={{
                      border: '1px solid #91d5ff',
                      padding: '6px 6px',
                      background: '#e8f4fd',
                      position: 'sticky',
                      top: 0,
                      zIndex: 3,
                      width: columnWidths[i],
                      minWidth: 60,
                      maxWidth: 300,
                    }}
                  >
                    <input
                      type="text"
                      value={filters[i] || ''}
                      onChange={(e) => handleFilterChange(i, e.target.value)}
                      placeholder="筛选..."
                      style={{
                        width: '100%',
                        padding: '4px 6px',
                        border: '1px solid #91d5ff',
                        borderRadius: 4,
                        fontSize: 12,
                        boxSizing: 'border-box',
                        background: '#fff',
                        outline: 'none',
                      }}
                    />
                  </th>
                ))}
              </tr>
            )}
            {/* 列字母行 */}
            <tr>
              {headers.map((_, i) => {
                let label = ''
                let n = i
                do {
                  label = String.fromCharCode(65 + (n % 26)) + label
                  n = Math.floor(n / 26) - 1
                } while (n >= 0)
                return (
                  <th
                    key={`col-${i}`}
                    style={{
                      border: '1px solid #d9d9d9',
                      padding: '2px 8px',
                      background: '#f5f5f5',
                      fontWeight: 500,
                      textAlign: 'center',
                      fontSize: 11,
                      color: '#999',
                      position: 'sticky',
                      top: showFilters ? 36 : 0,
                      zIndex: 2,
                      width: columnWidths[i],
                      minWidth: 60,
                      maxWidth: 300,
                    }}
                  >
                    {label}
                  </th>
                )
              })}
            </tr>
            {/* 表头行 */}
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  style={{
                    border: '1px solid #d9d9d9',
                    padding: '8px 10px',
                    background: '#e6f7ff',
                    fontWeight: 600,
                    textAlign: 'left',
                    position: 'sticky',
                    top: showFilters ? 62 : 26,
                    zIndex: 1,
                    width: columnWidths[i],
                    minWidth: 60,
                    maxWidth: 300,
                  }}
                >
                  {h || <span style={{ color: '#ccc', fontStyle: 'italic' }}>空</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const visibleRows = filteredRows.slice(0, visibleCount)
              return visibleRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={headers.length || 1}
                    style={{
                      border: '1px solid #d9d9d9',
                      padding: '20px',
                      textAlign: 'center',
                      color: '#999',
                    }}
                  >
                    没有匹配的数据
                  </td>
                </tr>
              ) : (
                visibleRows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#fafafa' }}>
                    {headers.map((_, ci) => (
                      <td
                        key={ci}
                        style={{
                          border: '1px solid #d9d9d9',
                          padding: '6px 10px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          width: columnWidths[ci],
                          minWidth: 60,
                          maxWidth: 300,
                        }}
                        title={row[ci] || ''}
                      >
                        {row[ci] || ''}
                      </td>
                    ))}
                  </tr>
                ))
              )
            })()}
          </tbody>
        </table>
      </div>
    </div>
  )
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
  const containerStyle = { flex: 1, display: 'flex', flexDirection: 'column' as const, minHeight: 0, overflow: 'hidden' }

  switch (fileType) {
    case 'docx':
      return <div style={containerStyle}><DocxViewer fileUrl={fileUrl} /></div>
    case 'xlsx':
      return <div style={containerStyle}><XlsxViewer fileUrl={fileUrl} /></div>
    case 'pptx':
      return <div style={containerStyle}><PptxViewer fileUrl={fileUrl} /></div>
    default:
      return <Text type="secondary">Unsupported file type</Text>
  }
}
