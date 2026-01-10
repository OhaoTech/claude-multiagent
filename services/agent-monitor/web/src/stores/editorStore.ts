import { create } from 'zustand'
import type { FileTreeNode } from '../types'

interface EditorTab {
  path: string
  name: string
  content: string
  isDirty: boolean
  language: string
}

interface EditorState {
  fileTree: FileTreeNode[]
  openTabs: EditorTab[]
  activeTab: string | null
  loading: boolean
  error: string | null
  currentTreePath: string | null
  clipboard: { path: string; name: string; isDir: boolean } | null

  // Actions
  fetchFileTree: (path: string) => Promise<void>
  refreshTree: () => Promise<void>
  openFile: (path: string) => Promise<void>
  closeTab: (path: string) => void
  closeOtherTabs: (path: string) => void
  closeAllTabs: () => void
  closeSavedTabs: () => void
  closeTabsToRight: (path: string) => void
  setActiveTab: (path: string) => void
  updateContent: (path: string, content: string) => void
  saveFile: (path: string) => Promise<void>
  createFile: (parentPath: string, name: string, isDir: boolean) => Promise<boolean>
  deleteFile: (path: string) => Promise<boolean>
  renameFile: (oldPath: string, newName: string) => Promise<boolean>
  copyToClipboard: (path: string, name: string, isDir: boolean) => void
  pasteFile: (targetPath: string) => Promise<boolean>
}

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const langMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    json: 'json',
    html: 'html',
    css: 'css',
    scss: 'css',
    md: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
  }
  return langMap[ext] || 'text'
}

export const useEditorStore = create<EditorState>((set, get) => ({
  fileTree: [],
  openTabs: [],
  activeTab: null,
  loading: false,
  error: null,
  currentTreePath: null,
  clipboard: null,

  fetchFileTree: async (path: string) => {
    set({ loading: true, currentTreePath: path })
    try {
      const res = await fetch(`/api/files/tree?path=${encodeURIComponent(path)}`)
      const fileTree = await res.json()
      set({ fileTree: fileTree.children || [], loading: false })
    } catch {
      set({ error: 'Failed to load file tree', loading: false })
    }
  },

  refreshTree: async () => {
    const path = get().currentTreePath
    if (!path) return
    try {
      const res = await fetch(`/api/files/tree?path=${encodeURIComponent(path)}`)
      const fileTree = await res.json()
      set({ fileTree: fileTree.children || [] })
    } catch {
      set({ error: 'Failed to refresh file tree' })
    }
  },

  openFile: async (path: string) => {
    const existing = get().openTabs.find(t => t.path === path)
    if (existing) {
      set({ activeTab: path })
      return
    }

    try {
      const res = await fetch(`/api/files/content?path=${encodeURIComponent(path)}`)
      if (!res.ok) {
        const err = await res.text()
        console.error('Failed to fetch file:', err)
        set({ error: `Failed to open file: ${path}` })
        return
      }
      const data = await res.json()
      if (data.content === undefined) {
        console.error('No content in response:', data)
        set({ error: `No content for file: ${path}` })
        return
      }
      const name = path.split('/').pop() || path
      const tab: EditorTab = {
        path,
        name,
        content: data.content,
        isDirty: false,
        language: getLanguage(name),
      }
      set(state => ({
        openTabs: [...state.openTabs, tab],
        activeTab: path,
      }))
    } catch (err) {
      console.error('Error opening file:', err)
      set({ error: `Failed to open file: ${path}` })
    }
  },

  closeTab: (path: string) => {
    set(state => {
      const tabs = state.openTabs.filter(t => t.path !== path)
      let activeTab = state.activeTab
      if (activeTab === path) {
        activeTab = tabs.length > 0 ? tabs[tabs.length - 1].path : null
      }
      return { openTabs: tabs, activeTab }
    })
  },

  closeOtherTabs: (path: string) => {
    set(state => ({
      openTabs: state.openTabs.filter(t => t.path === path),
      activeTab: path,
    }))
  },

  closeAllTabs: () => {
    set({ openTabs: [], activeTab: null })
  },

  closeSavedTabs: () => {
    set(state => {
      const tabs = state.openTabs.filter(t => t.isDirty)
      let activeTab = state.activeTab
      if (activeTab && !tabs.find(t => t.path === activeTab)) {
        activeTab = tabs.length > 0 ? tabs[tabs.length - 1].path : null
      }
      return { openTabs: tabs, activeTab }
    })
  },

  closeTabsToRight: (path: string) => {
    set(state => {
      const idx = state.openTabs.findIndex(t => t.path === path)
      if (idx === -1) return state
      const tabs = state.openTabs.slice(0, idx + 1)
      let activeTab = state.activeTab
      if (activeTab && !tabs.find(t => t.path === activeTab)) {
        activeTab = path
      }
      return { openTabs: tabs, activeTab }
    })
  },

  setActiveTab: (path: string) => {
    set({ activeTab: path })
  },

  updateContent: (path: string, content: string) => {
    set(state => ({
      openTabs: state.openTabs.map(tab =>
        tab.path === path ? { ...tab, content, isDirty: true } : tab
      ),
    }))
  },

  saveFile: async (path: string) => {
    const tab = get().openTabs.find(t => t.path === path)
    if (!tab) return

    try {
      await fetch('/api/files/content', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: tab.content }),
      })
      set(state => ({
        openTabs: state.openTabs.map(t =>
          t.path === path ? { ...t, isDirty: false } : t
        ),
      }))
    } catch {
      set({ error: `Failed to save file: ${path}` })
    }
  },

  createFile: async (parentPath: string, name: string, isDir: boolean) => {
    const fullPath = parentPath ? `${parentPath}/${name}` : name
    try {
      const res = await fetch('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: fullPath, is_dir: isDir, content: '' }),
      })
      if (!res.ok) {
        const err = await res.text()
        set({ error: `Failed to create: ${err}` })
        return false
      }
      await get().refreshTree()
      return true
    } catch {
      set({ error: `Failed to create ${isDir ? 'folder' : 'file'}` })
      return false
    }
  },

  deleteFile: async (path: string) => {
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = await res.text()
        set({ error: `Failed to delete: ${err}` })
        return false
      }
      // Close tab if the deleted file was open
      const { openTabs, activeTab } = get()
      const affectedTabs = openTabs.filter(t => t.path === path || t.path.startsWith(path + '/'))
      if (affectedTabs.length > 0) {
        const remainingTabs = openTabs.filter(t => !affectedTabs.includes(t))
        let newActiveTab = activeTab
        if (affectedTabs.some(t => t.path === activeTab)) {
          newActiveTab = remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].path : null
        }
        set({ openTabs: remainingTabs, activeTab: newActiveTab })
      }
      await get().refreshTree()
      return true
    } catch {
      set({ error: 'Failed to delete' })
      return false
    }
  },

  renameFile: async (oldPath: string, newName: string) => {
    const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/'))
    const newPath = parentPath ? `${parentPath}/${newName}` : newName
    try {
      const res = await fetch('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_path: oldPath, new_path: newPath }),
      })
      if (!res.ok) {
        const err = await res.text()
        set({ error: `Failed to rename: ${err}` })
        return false
      }
      // Update open tabs with new path
      set(state => ({
        openTabs: state.openTabs.map(tab => {
          if (tab.path === oldPath) {
            return { ...tab, path: newPath, name: newName }
          }
          if (tab.path.startsWith(oldPath + '/')) {
            const newTabPath = newPath + tab.path.substring(oldPath.length)
            return { ...tab, path: newTabPath }
          }
          return tab
        }),
        activeTab: state.activeTab === oldPath ? newPath :
          state.activeTab?.startsWith(oldPath + '/') ? newPath + state.activeTab.substring(oldPath.length) :
          state.activeTab,
      }))
      await get().refreshTree()
      return true
    } catch {
      set({ error: 'Failed to rename' })
      return false
    }
  },

  copyToClipboard: (path: string, name: string, isDir: boolean) => {
    set({ clipboard: { path, name, isDir } })
  },

  pasteFile: async (targetPath: string) => {
    const { clipboard } = get()
    if (!clipboard) return false

    try {
      // Read source file content
      const sourceRes = await fetch(`/api/files/content?path=${encodeURIComponent(clipboard.path)}`)
      if (!sourceRes.ok) {
        set({ error: 'Failed to read source file' })
        return false
      }
      const sourceData = await sourceRes.json()

      // Generate unique name if file exists
      let newName = clipboard.name
      const destPath = targetPath ? `${targetPath}/${newName}` : newName

      // Create the copy
      const createRes = await fetch('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: destPath,
          is_dir: clipboard.isDir,
          content: sourceData.content || '',
        }),
      })

      if (!createRes.ok) {
        // Try with a different name if file exists
        const copyName = `${clipboard.name.replace(/(\.[^.]+)$/, '')}_copy${clipboard.name.match(/(\.[^.]+)$/)?.[1] || ''}`
        const copyPath = targetPath ? `${targetPath}/${copyName}` : copyName
        const retryRes = await fetch('/api/files/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: copyPath,
            is_dir: clipboard.isDir,
            content: sourceData.content || '',
          }),
        })
        if (!retryRes.ok) {
          set({ error: 'Failed to paste file' })
          return false
        }
      }

      await get().refreshTree()
      return true
    } catch {
      set({ error: 'Failed to paste file' })
      return false
    }
  },
}))
