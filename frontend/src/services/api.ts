import axios from 'axios'
import type { Document, DocumentUploadResponse, TreeNode, ChatSession, ChatMessage } from '@/types'

const API_BASE_URL = '/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Documents
export const documentApi = {
  // Upload multiple documents
  uploadMultiple: async (files: File[]): Promise<{ uploaded: DocumentUploadResponse[]; errors: string[] | null; total_uploaded: number; total_errors: number }> => {
    const formData = new FormData()
    files.forEach(file => {
      formData.append('files', file)
    })
    
    const response = await api.post('/documents/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
    return response.data
  },
  
  // Legacy: Upload a single document (kept for compatibility)
  upload: async (file: File): Promise<DocumentUploadResponse> => {
    const result = await documentApi.uploadMultiple([file])
    return result.uploaded[0]
  },
  
  // List all documents
  list: async (): Promise<Document[]> => {
    const response = await api.get('/documents')
    return response.data
  },
  
  // Get document details
  get: async (id: string): Promise<Document> => {
    const response = await api.get(`/documents/${id}`)
    return response.data
  },
  
  // Get document structure
  getStructure: async (id: string): Promise<{ structure: TreeNode[] }> => {
    const response = await api.get(`/documents/${id}/structure`)
    return response.data
  },
  
  // Get document content for page range
  getContent: async (id: string, startPage: number, endPage: number): Promise<{ content: string }> => {
    const response = await api.get(`/documents/${id}/content`, {
      params: { start_page: startPage, end_page: endPage },
    })
    return response.data
  },
  
  // Get original page content
  getPageContent: async (id: string, pageNum: number): Promise<{ page: number; content: string; doc_type?: string }> => {
    const response = await api.get(`/documents/${id}/page/${pageNum}`)
    return response.data
  },
  
  // Get document file URL for preview
  getFileUrl: (id: string) => `/api/documents/${id}/file`,
  
  // Reprocess a document
  reprocess: async (id: string): Promise<{ message: string; doc_id: string; status: string }> => {
    const response = await api.post(`/documents/${id}/reindex`)
    return response.data
  },
  
  // Delete document
  delete: async (id: string): Promise<void> => {
    await api.delete(`/documents/${id}`)
  },
}

// Chat
export const chatApi = {
  // Create new chat session
  createSession: async (docId: string, title?: string): Promise<ChatSession> => {
    const response = await api.post(`/documents/${docId}/chat`, { title })
    return response.data
  },
  
  // List chat sessions for document
  listSessions: async (docId: string): Promise<ChatSession[]> => {
    const response = await api.get(`/documents/${docId}/chat`)
    return response.data
  },
  
  // Get messages in session
  getMessages: async (sessionId: string): Promise<ChatMessage[]> => {
    const response = await api.get(`/chat/${sessionId}/messages`)
    return response.data
  },
  
  // Send message
  sendMessage: async (sessionId: string, content: string): Promise<ChatMessage> => {
    const response = await api.post(`/chat/${sessionId}/message`, { content })
    return response.data
  },
  
  // Update session title
  updateSession: async (sessionId: string, title: string): Promise<ChatSession> => {
    const response = await api.put(`/chat/${sessionId}`, { title })
    return response.data
  },
  
  // Delete session
  deleteSession: async (sessionId: string): Promise<void> => {
    await api.delete(`/chat/${sessionId}`)
  },
  
  // Delete messages
  deleteMessages: async (sessionId: string, messageIds: string[]): Promise<void> => {
    await api.delete(`/chat/${sessionId}/messages`, { data: { message_ids: messageIds } })
  },
}

// Health check
export const healthApi = {
  check: async (): Promise<{ status: string; service: string }> => {
    const response = await api.get('/health')
    return response.data
  },
}

export default api
