import { useEffect, useRef, useState } from 'react'
import { Spin, Typography, message } from 'antd'
import { fileCache } from '@/utils/fileCache'

const { Text } = Typography

interface OfficeViewerProps {
  fileUrl: string
  fileType: 'docx' | 'xlsx' | 'pptx'
  docId?: string
}

function extractDocId(fileUrl: string): string | undefined {
  const match = fileUrl.match(/\/api\/documents\/([^/]+)\/file/)
  return match?.[1]
}

function DocxViewer({ fileUrl, docId }: { fileUrl: string; docId?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const resolvedDocId = docId || extractDocId(fileUrl)

  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false

    const render = async () => {
      setLoading(true)
      try {
        const { renderAsync } = await import('docx-preview')
        let blob: Blob
        if (resolvedDocId) {
          blob = await fileCache.fetch(resolvedDocId, fileUrl)
        } else {
          const response = await fetch(fileUrl)
          blob = await response.blob()
        }
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = ''
          // 先通过 arrayBuffer 渲染（与测试页面一致）
          const arrayBuffer = await blob.arrayBuffer()
          // 选项与 docx-preview-test.html 完全一致
          await renderAsync(arrayBuffer, containerRef.current, null, {
            className: 'docx-wrapper',
            ignoreHeight: true,
            ignoreWidth: true,
            ignoreFonts: false,
            breakPages: true,
            debug: false,
            experimentalMode: true,
            inWrapper: true,
            hideWrapperOnPrint: true,
            trimXmlDeclaration: true,
            ignoreLastRenderedPageBreak: false,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true,
            useBase64URL: false,
            renderChanges: false,
            renderComments: false,
            renderAltChunks: true,
          })
          // 添加页码浮层徽章（与 docx-preview-test.html 方案一致）
          const docxSections = containerRef.current.querySelectorAll('section.docx-wrapper, section')
          docxSections.forEach((section, index) => {
            if (section.querySelector(':scope > .page-number')) return
            const pageNum = document.createElement('div')
            pageNum.className = 'page-number'
            pageNum.textContent = `第 ${index + 1} / ${docxSections.length} 页`
            section.appendChild(pageNum)
          })
        }
      } catch (err) {
        console.error('DOCX rendering error:', err)
        if (!cancelled) message.error('Failed to render DOCX')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    render()
    return () => { cancelled = true }
  }, [fileUrl, resolvedDocId])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      <style>{`
        .docx-chat-viewer {
          width: 100%;
          max-width: 900px;
          margin: 0 auto;
          min-height: 400px;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 24px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
          overflow: auto;
        }
        .docx-chat-viewer .docx-wrapper {
          background: #fff !important;
          width: 100% !important;
          max-width: 100% !important;
        }
        .docx-chat-viewer .docx-wrapper section {
          position: relative;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 100% !important;
          box-sizing: border-box !important;
          margin: 0 !important;
          padding: 0 !important;
          padding-bottom: 36px !important;
          overflow: visible !important;
          background: #fff !important;
        }
        /* 页码浮层徽章（与 docx-preview-test.html 方案一致） */
        .docx-chat-viewer .page-number {
          position: absolute;
          bottom: 8px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 11px;
          color: #fff;
          background: rgba(0,0,0,0.45);
          padding: 2px 10px;
          border-radius: 10px;
          z-index: 10;
          pointer-events: none;
          white-space: nowrap;
          user-select: none;
        }
        .docx-chat-viewer .docx-wrapper section + section {
          margin-top: 24px !important;
          padding-top: 12px !important;
          border-top: 2px dashed #e5e7eb !important;
        }
      `}</style>
      {loading && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,255,255,0.8)', zIndex: 10,
        }}>
          <Spin tip="Loading..." fullscreen />
        </div>
      )}
      <div
        ref={containerRef}
        className="docx-chat-viewer"
        style={{ flex: 1, minHeight: 0 }}
      />
    </div>
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

function XlsxViewer({ fileUrl, docId }: { fileUrl: string; docId?: string }) {
  const [sheets, setSheets] = useState<RawSheetData[]>([])
  const [loading, setLoading] = useState(true)
  const [activeSheet, setActiveSheet] = useState(0)
  const [headerRowBySheet, setHeaderRowBySheet] = useState<Record<number, number>>({})
  const [filters, setFilters] = useState<Record<number, string>>({})
  const [showFilters, setShowFilters] = useState(false)
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const resolvedDocId = docId || extractDocId(fileUrl)

  useEffect(() => {
    const load = async () => {
      try {
        const XLSX = await import('xlsx')
        let arrayBuffer: ArrayBuffer
        if (resolvedDocId) {
          const blob = await fileCache.fetch(resolvedDocId, fileUrl)
          arrayBuffer = await blob.arrayBuffer()
        } else {
          const response = await fetch(fileUrl)
          arrayBuffer = await response.arrayBuffer()
        }
        const workbook = XLSX.read(arrayBuffer, { type: 'array' })
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
  }, [fileUrl, resolvedDocId])

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

  if (loading) return <Spin tip="Loading..." fullscreen />
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
            <span style={{ fontSize: 12, color: '#666', whiteSpace: 'nowrap' }}>Header row:</span>
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
                    Row {i + 1} {preview ? `- ${preview}${(sheetData.allRows[i] || []).length > 3 ? '...' : ''}` : '(empty)'}
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
          {showFilters ? 'Hide filters' : 'Show filters'}
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
            Clear filters
          </button>
        )}
        <span style={{ fontSize: 12, color: '#999', whiteSpace: 'nowrap' }}>
          {filteredRows.length > visibleCount
            ? `Showing ${visibleCount} / ${filteredRows.length} rows (scroll for more)`
            : `${filteredRows.length} / ${dataRows.length} rows`}
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
                      placeholder="Filter..."
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
                  {h || <span style={{ color: '#ccc', fontStyle: 'italic' }}>(empty)</span>}
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
                    No matching data
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

function PptxViewer({ fileUrl, docId }: { fileUrl: string; docId?: string }) {
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [scale, setScale] = useState(1)
  const [baseWidth, setBaseWidth] = useState(0)
  const [contentHeight, setContentHeight] = useState(0)
  const resolvedDocId = docId || extractDocId(fileUrl)
  const previewerRef = useRef<any>(null)
  const baseWidthRef = useRef(0)

  useEffect(() => {
    if (!contentRef.current) return
    let cancelled = false

    const render = async () => {
      setLoading(true)
      try {
        const { init } = await import('pptx-preview')
        let blob: Blob
        if (resolvedDocId) {
          blob = await fileCache.fetch(resolvedDocId, fileUrl)
        } else {
          const response = await fetch(fileUrl)
          blob = await response.blob()
        }
        if (!cancelled && contentRef.current) {
          contentRef.current.innerHTML = ''
          // 必须传 width：库依赖它计算 renderPort 和缩放，不传则幻灯片尺寸为 NaN/undefined 导致不可见
          const previewer = init(contentRef.current, { mode: 'list', width: 960 })
          previewerRef.current = previewer
          const arrayBuffer = await blob.arrayBuffer()
          await previewer.preview(arrayBuffer)
          // 渲染完成后测量实际尺寸并计算初始缩放比
          requestAnimationFrame(() => {
            if (cancelled) return
            const wrapper = contentRef.current?.querySelector('.pptx-preview-wrapper') as HTMLElement
            if (wrapper) {
              const w = wrapper.scrollWidth
              const h = wrapper.scrollHeight
              baseWidthRef.current = w > 0 ? w : 960
              setBaseWidth(baseWidthRef.current)
              setContentHeight(h || 0)
              if (scrollRef.current && baseWidthRef.current > 0) {
                const cw = scrollRef.current.clientWidth
                setScale(cw / baseWidthRef.current)
              }
            }
          })
        }
      } catch (err) {
        if (!cancelled) message.error('Failed to render PPTX')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    render()

    // ResizeObserver 监听容器宽度变化，只更新 scale 不重建 DOM
    const observer = new ResizeObserver((entries) => {
      if (cancelled) return
      const cw = entries[0]?.contentRect?.width
      if (!cw || cw <= 0) return
      if (baseWidthRef.current > 0) {
        setScale(cw / baseWidthRef.current)
      }
    })

    if (scrollRef.current) {
      observer.observe(scrollRef.current)
    }

    return () => {
      cancelled = true
      observer.disconnect()
      if (previewerRef.current) {
        try { previewerRef.current.destroy() } catch {}
        previewerRef.current = null
      }
    }
  }, [fileUrl, resolvedDocId])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      <style>{`
        .pptx-container {
          background-color: #f0f0f0;
        }
        .pptx-container .pptx-preview-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
          background: #f0f0f0 !important;
          padding: 16px 0;
          counter-reset: slide-counter;
        }
        .pptx-container .pptx-preview-slide-wrapper {
          counter-increment: slide-counter;
        }
        .pptx-container .pptx-preview-slide-wrapper::after {
          content: counter(slide-counter);
          position: absolute;
          bottom: 10px;
          left: 50%;
          transform: translateX(-50%);
          color: #999;
          font-size: 13px;
          font-weight: 500;
          background: rgba(0,0,0,0.06);
          padding: 2px 12px;
          border-radius: 10px;
          z-index: 10;
          pointer-events: none;
        }
      `}</style>
      {loading && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,255,255,0.8)', zIndex: 10,
        }}>
          <Spin tip="Loading..." fullscreen />
        </div>
      )}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {/* 外层锚定 div：给滚动容器提供正确的缩放后尺寸 */}
        <div
          style={{
            width: baseWidth > 0 ? `${baseWidth * scale}px` : '100%',
            minHeight: baseWidth > 0 && contentHeight > 0 ? `${contentHeight * scale}px` : '100%',
            position: 'relative',
          }}
        >
          <div
            ref={contentRef}
            className="pptx-container"
            style={{
              transform: baseWidth > 0 ? `scale(${scale})` : undefined,
              transformOrigin: 'top left',
              position: baseWidth > 0 ? 'absolute' : 'relative',
              top: 0,
              left: 0,
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default function OfficeViewer({ fileUrl, fileType, docId }: OfficeViewerProps) {
  const containerStyle = { flex: 1, display: 'flex', flexDirection: 'column' as const, minHeight: 0 }

  switch (fileType) {
    case 'docx':
      return <DocxViewer fileUrl={fileUrl} docId={docId} />
    case 'xlsx':
      return <div style={containerStyle}><XlsxViewer fileUrl={fileUrl} docId={docId} /></div>
    case 'pptx':
      return <div style={containerStyle}><PptxViewer fileUrl={fileUrl} docId={docId} /></div>
    default:
      return <Text type="secondary">Unsupported file type</Text>
  }
}
