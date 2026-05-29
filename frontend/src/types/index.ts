export interface Document {
  id: string
  filename: string
  doc_type: string
  status: 'pending' | 'processing' | 'completed' | 'error'
  doc_description?: string
  page_count?: number
  line_count?: number
  created_at: string
  updated_at?: string
}

export interface DocumentUploadResponse {
  id: string
  filename: string
  doc_type: string
  status: string
  created_at: string
}

export interface TreeNode {
  title: string
  node_id?: string
  start_index?: number
  end_index?: number
  summary?: string
  nodes?: TreeNode[]
}

export interface ChatSession {
  id: string
  document_id: string
  title: string
  created_at: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  citations?: Citation[]
  created_at: string
}

export interface Citation {
  page: number
  text: string
  node_title?: string
}
