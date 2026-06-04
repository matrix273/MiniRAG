import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ChatState {
  /** 当前激活的会话 ID */
  currentSession: string | null
  /** 主要选中的文档 ID（兼容旧逻辑） */
  selectedDoc: string | null
  /** 多选文档 ID 列表 */
  selectedDocs: string[]
  /** 侧边栏折叠状态 */
  sidebarCollapsed: boolean

  setCurrentSession: (id: string | null) => void
  setSelectedDoc: (id: string | null) => void
  setSelectedDocs: (ids: string[]) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  /** 清空文档选择 */
  clearDocSelection: () => void
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      currentSession: null,
      selectedDoc: null,
      selectedDocs: [],
      sidebarCollapsed: false,

      setCurrentSession: (id) => set({ currentSession: id }),
      setSelectedDoc: (id) => set({ selectedDoc: id }),
      setSelectedDocs: (ids) => set({ selectedDocs: ids, selectedDoc: ids.length > 0 ? ids[0] : null }),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      clearDocSelection: () => set({ selectedDoc: null, selectedDocs: [] }),
    }),
    {
      name: 'kb-chat-store',
      // 只持久化这四个字段
      partialize: (state) => ({
        currentSession: state.currentSession,
        selectedDoc: state.selectedDoc,
        selectedDocs: state.selectedDocs,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
)
