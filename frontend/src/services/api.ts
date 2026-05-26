import axios from 'axios'
import type { Document, DocumentUploadResponse, TreeNode, ChatSession, ChatMessage, Folder, PromptConfig, SystemConfig } from '@/types'

const API_BASE_URL = '/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor: attach JWT token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor: handle 401 with refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    if (error.response?.status === 401 && !originalRequest._retry) {
      const refreshToken = localStorage.getItem('refresh_token')
      if (refreshToken) {
        originalRequest._retry = true
        try {
          const response = await axios.post('/api/auth/refresh', {
            refresh_token: refreshToken,
          })
          const { access_token, refresh_token } = response.data
          localStorage.setItem('access_token', access_token)
          localStorage.setItem('refresh_token', refresh_token)
          originalRequest.headers.Authorization = `Bearer ${access_token}`
          return api(originalRequest)
        } catch {
          localStorage.removeItem('access_token')
          localStorage.removeItem('refresh_token')
          window.location.href = '/login'
        }
      } else {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

// Documents
export const documentApi = {
  // Upload multiple documents
  uploadMultiple: async (files: File[], folderId?: string): Promise<{ uploaded: DocumentUploadResponse[]; errors: string[] | null; total_uploaded: number; total_errors: number }> => {
    const formData = new FormData()
    files.forEach(file => {
      formData.append('files', file)
    })
    if (folderId) {
      formData.append('folder_id', folderId)
    }

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
  list: async (folderId?: string): Promise<Document[]> => {
    const response = await api.get('/documents', { params: folderId ? { folder_id: folderId } : {} })
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

  // Move document to folder
  move: async (docId: string, folderId: string | null): Promise<void> => {
    await api.put(`/documents/${docId}/move`, { name: '', parent_id: folderId })
  },
}

// Chat
export const chatApi = {
  // Create new chat session
  createSession: async (docId: string, title?: string, documentIds?: string[]): Promise<ChatSession> => {
    const response = await api.post(`/documents/${docId}/chat`, { title, document_ids: documentIds })
    return response.data
  },

  // List chat sessions for document
  listSessions: async (docId: string): Promise<ChatSession[]> => {
    const response = await api.get(`/documents/${docId}/chat`)
    return response.data
  },

  // List all chat sessions
  listAllSessions: async (): Promise<ChatSession[]> => {
    const response = await api.get('/chat/sessions')
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

  // Create auto-inference chat session (no document selection needed)
  createAutoSession: async (title?: string): Promise<ChatSession> => {
    const response = await api.post('/chat/auto', null, { params: { title: title || 'New Chat' } })
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

// Vector DB
export const vectorDbApi = {
  getStatus: async (): Promise<{ row_count: number; has_data: boolean }> => {
    const response = await api.get('/vector-db/status')
    return response.data
  },
}

// Vision
export const visionApi = {
  // Get page images for visual analysis
  getPageImages: async (docId: string, pages: string, dpi: number = 150): Promise<{ images: Array<{ page: number; image_path: string }> }> => {
    const response = await api.get(`/documents/${docId}/page-images`, {
      params: { pages, dpi },
    })
    return response.data
  },

  // Get page images as base64 encoded strings
  getPageImagesBase64: async (docId: string, pages: string, dpi: number = 150): Promise<{ images: Array<{ page: number; base64: string }> }> => {
    const response = await api.get(`/documents/${docId}/page-images-base64`, {
      params: { pages, dpi },
    })
    return response.data
  },
}

// Folders
export const folderApi = {
  // Get all folders (tree structure)
  list: async (): Promise<Folder[]> => {
    const response = await api.get('/folders')
    return response.data
  },

  // Create folder
  create: async (name: string, parentId?: string): Promise<Folder> => {
    const response = await api.post('/folders', { name, parent_id: parentId })
    return response.data
  },

  // Rename folder
  rename: async (id: string, name: string): Promise<Folder> => {
    const response = await api.put(`/folders/${id}`, { name })
    return response.data
  },

  // Delete folder
  delete: async (id: string): Promise<void> => {
    await api.delete(`/folders/${id}`)
  },

  // Move folder to another parent
  move: async (id: string, newParentId: string | null): Promise<void> => {
    await api.put(`/folders/${id}/move`, { name: newParentId })
  },
}

// Health check
export const healthApi = {
  check: async (): Promise<{ status: string; service: string }> => {
    const response = await api.get('/health')
    return response.data
  },
}

// Prompts
export const promptApi = {
  listAll: async (): Promise<Record<string, string>> => {
    const response = await api.get('/prompts')
    return response.data
  },

  get: async (category: string): Promise<{ category: string; content: string }> => {
    const response = await api.get(`/prompts/${category}`)
    return response.data
  },

  listVersions: async (category: string): Promise<PromptConfig[]> => {
    const response = await api.get(`/prompts/${category}/versions`)
    return response.data
  },

  create: async (category: string, name: string, content: string, description?: string): Promise<PromptConfig> => {
    const response = await api.post(`/prompts/${category}`, { name, content, description })
    return response.data
  },

  activate: async (category: string, promptId: string): Promise<void> => {
    await api.put(`/prompts/${category}/active/${promptId}`)
  },

  delete: async (category: string, promptId: string): Promise<void> => {
    await api.delete(`/prompts/${category}/versions/${promptId}`)
  },
}

// System Configs
export const systemConfigApi = {
  list: async (): Promise<SystemConfig[]> => {
    const response = await api.get('/system-configs')
    return response.data
  },

  update: async (key: string, value: string): Promise<SystemConfig> => {
    const response = await api.put(`/system-configs/${key}`, { value })
    return response.data
  },
}

export default api
