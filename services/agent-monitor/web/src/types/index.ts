// Project types
export interface Project {
  id: string
  name: string
  root_path: string
  description: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Agent {
  id: string
  project_id: string
  name: string
  domain: string
  worktree_path: string | null
  status: 'active' | 'inactive'
  is_leader: boolean
  created_at: string
}

// Settings types
export interface GlobalSettings {
  theme: string
  default_mode: string
  editor_font_size: number
  editor_tab_size: number
  auto_save: boolean
  sidebar_width: number
  chat_panel_width: number
  last_project_id: string | null
}

export interface ProjectSettings {
  default_agent: string
  git_auto_commit: boolean
  file_excludes: string[]
}

// File system types
export interface FileTreeNode {
  name: string
  path: string
  is_dir: boolean
  children?: FileTreeNode[]
  size?: number
  modified?: number
  git_status?: 'M' | 'A' | 'D' | 'U' | '?'
}

// Chat types
export interface ChatMessage {
  type: 'user' | 'assistant' | 'system' | 'tool_result'
  content: string
  timestamp?: number
  uuid?: string
}

export interface SessionInfo {
  session_id: string
  agent_id: string
  agent: string
  message_count: number
  first_timestamp: number | null
  last_timestamp: number | null
  cost_usd: number
  last_message_preview: string
  cwd: string
}
