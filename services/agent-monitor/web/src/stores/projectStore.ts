import { create } from 'zustand'
import type { Project, Agent, GlobalSettings, ProjectSettings } from '../types'

interface ProjectState {
  projects: Project[]
  activeProject: Project | null
  agents: Agent[]
  settings: GlobalSettings | null
  projectSettings: ProjectSettings | null
  loading: boolean
  error: string | null

  // Actions
  fetchProjects: () => Promise<void>
  fetchActiveProject: () => Promise<void>
  selectProject: (projectId: string) => Promise<void>
  createProject: (name: string, rootPath: string, description?: string) => Promise<Project>
  deleteProject: (projectId: string) => Promise<void>
  fetchAgents: (projectId: string) => Promise<void>
  createAgent: (projectId: string, name: string, domain: string) => Promise<Agent>
  deleteAgent: (projectId: string, agentId: string) => Promise<void>
  syncWorktrees: (projectId: string) => Promise<{ created: number; skipped: number }>
  fetchSettings: () => Promise<void>
  updateSettings: (settings: Partial<GlobalSettings>) => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProject: null,
  agents: [],
  settings: null,
  projectSettings: null,
  loading: false,
  error: null,

  fetchProjects: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/projects')
      const projects = await res.json()
      set({ projects, loading: false })
    } catch (err) {
      set({ error: 'Failed to fetch projects', loading: false })
    }
  },

  fetchActiveProject: async () => {
    try {
      const res = await fetch('/api/projects/active')
      if (res.ok) {
        const project = await res.json()
        set({ activeProject: project })
        // Also fetch agents for active project
        get().fetchAgents(project.id)
      }
    } catch {
      // No active project
    }
  },

  selectProject: async (projectId: string) => {
    set({ loading: true })
    try {
      const res = await fetch(`/api/projects/${projectId}/select`, { method: 'POST' })
      const project = await res.json()
      set({ activeProject: project, loading: false })
      get().fetchAgents(project.id)
    } catch (err) {
      set({ error: 'Failed to select project', loading: false })
    }
  },

  createProject: async (name: string, rootPath: string, description = '') => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, root_path: rootPath, description }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.detail || 'Failed to create project')
    }
    const project = await res.json()
    set(state => ({ projects: [...state.projects, project], activeProject: project }))
    get().fetchAgents(project.id)
    return project
  },

  deleteProject: async (projectId: string) => {
    await fetch(`/api/projects/${projectId}`, { method: 'DELETE' })
    set(state => ({
      projects: state.projects.filter(p => p.id !== projectId),
      activeProject: state.activeProject?.id === projectId ? null : state.activeProject,
    }))
  },

  fetchAgents: async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/agents`)
      const agents = await res.json()
      set({ agents })
    } catch {
      set({ agents: [] })
    }
  },

  createAgent: async (projectId: string, name: string, domain: string) => {
    const res = await fetch(`/api/projects/${projectId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, domain }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.detail || 'Failed to create agent')
    }
    const agent = await res.json()
    set(state => ({ agents: [...state.agents, agent] }))
    return agent
  },

  deleteAgent: async (projectId: string, agentId: string) => {
    await fetch(`/api/projects/${projectId}/agents/${agentId}`, { method: 'DELETE' })
    set(state => ({ agents: state.agents.filter(a => a.id !== agentId) }))
  },

  syncWorktrees: async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}/sync-worktrees`, { method: 'POST' })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.detail || 'Failed to sync worktrees')
    }
    const result = await res.json()
    // Refresh agents after sync
    get().fetchAgents(projectId)
    return { created: result.created.length, skipped: result.skipped.length }
  },

  fetchSettings: async () => {
    try {
      const res = await fetch('/api/settings')
      const settings = await res.json()
      set({ settings })
    } catch {
      // Use defaults
    }
  },

  updateSettings: async (updates: Partial<GlobalSettings>) => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const settings = await res.json()
    set({ settings })
  },
}))
