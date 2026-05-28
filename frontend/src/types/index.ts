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
  folder_id?: string | null
}

export interface DocumentUploadResponse {
  id: string
  filename: string
  doc_type: string
  status: string
  created_at: string
  folder_id?: string | null
}

export interface Folder {
  id: string
  name: string
  description?: string
  parent_id: string | null
  created_at: string
  updated_at?: string
  children: Folder[]
  documents: Document[]
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
  document_id?: string
  document_ids?: string[]
  title: string
  is_auto?: boolean
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
  document_id?: string
}

export interface PromptConfig {
  id: string
  category: string
  name: string
  content: string
  version: number
  is_active: boolean
  description?: string
  created_at: string
}

export interface SystemConfig {
  key: string
  value: string
  description?: string
  updated_at: string
}

export interface User {
  id: string
  email: string
  username: string
  is_active: boolean
  created_at: string
  roles: string[]
  permissions: string[]
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  email: string
  username: string
  password: string
}

export interface AuthResponse {
  access_token: string
  refresh_token: string
  token_type: string
}

export interface Role {
  id: string
  name: string
  description?: string
  is_system: boolean
  permissions: string[]
}
