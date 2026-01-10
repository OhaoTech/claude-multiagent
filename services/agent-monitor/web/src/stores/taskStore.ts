import { create } from 'zustand'

export interface Task {
  id: string
  project_id: string
  agent_id: string | null
  title: string
  description: string | null
  status: 'pending' | 'blocked' | 'assigned' | 'running' | 'completed' | 'failed'
  priority: number
  retry_count: number
  max_retries: number
  depends_on: string[]
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
  result: Record<string, unknown> | null
  error: string | null
}

export interface QueueStats {
  pending: number
  blocked: number
  assigned: number
  running: number
  completed: number
  failed: number
  total: number
}

export interface SchedulerStatus {
  is_running: boolean
  last_run: string | null
  project_id: string | null
}

interface TaskState {
  tasks: Task[]
  stats: QueueStats | null
  schedulerStatus: SchedulerStatus | null
  loading: boolean
  error: string | null

  // Actions
  fetchTasks: (projectId: string, status?: string) => Promise<void>
  fetchStats: (projectId: string) => Promise<void>
  fetchSchedulerStatus: () => Promise<void>
  createTask: (projectId: string, task: { title: string; description?: string; priority?: number; depends_on?: string[]; agent_id?: string }) => Promise<Task>
  updateTask: (projectId: string, taskId: string, updates: Partial<Task>) => Promise<void>
  deleteTask: (projectId: string, taskId: string) => Promise<void>
  retryTask: (projectId: string, taskId: string) => Promise<void>
  cancelTask: (projectId: string, taskId: string) => Promise<void>
  startScheduler: (projectId: string) => Promise<void>
  stopScheduler: () => Promise<void>
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  stats: null,
  schedulerStatus: null,
  loading: false,
  error: null,

  fetchTasks: async (projectId: string, status?: string) => {
    set({ loading: true, error: null })
    try {
      const url = status
        ? `/api/projects/${projectId}/tasks?status=${status}`
        : `/api/projects/${projectId}/tasks`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch tasks')
      const tasks = await res.json()
      set({ tasks, loading: false })
    } catch (err: any) {
      set({ error: err.message, loading: false })
    }
  },

  fetchStats: async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/queue/stats`)
      if (!res.ok) throw new Error('Failed to fetch stats')
      const stats = await res.json()
      set({ stats })
    } catch (err: any) {
      console.error('Failed to fetch queue stats:', err)
    }
  },

  fetchSchedulerStatus: async () => {
    try {
      const res = await fetch('/api/scheduler/status')
      if (!res.ok) throw new Error('Failed to fetch scheduler status')
      const status = await res.json()
      set({ schedulerStatus: status })
    } catch (err: any) {
      console.error('Failed to fetch scheduler status:', err)
    }
  },

  createTask: async (projectId: string, task) => {
    const res = await fetch(`/api/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.detail || 'Failed to create task')
    }
    const newTask = await res.json()
    set((state) => ({ tasks: [newTask, ...state.tasks] }))
    get().fetchStats(projectId)
    return newTask
  },

  updateTask: async (projectId: string, taskId: string, updates) => {
    const res = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (!res.ok) throw new Error('Failed to update task')
    const updated = await res.json()
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? updated : t)),
    }))
    get().fetchStats(projectId)
  },

  deleteTask: async (projectId: string, taskId: string) => {
    const res = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error('Failed to delete task')
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
    }))
    get().fetchStats(projectId)
  },

  retryTask: async (projectId: string, taskId: string) => {
    const res = await fetch(`/api/projects/${projectId}/tasks/${taskId}/retry`, {
      method: 'POST',
    })
    if (!res.ok) throw new Error('Failed to retry task')
    get().fetchTasks(projectId)
    get().fetchStats(projectId)
  },

  cancelTask: async (projectId: string, taskId: string) => {
    const res = await fetch(`/api/projects/${projectId}/tasks/${taskId}/cancel`, {
      method: 'POST',
    })
    if (!res.ok) throw new Error('Failed to cancel task')
    get().fetchTasks(projectId)
    get().fetchStats(projectId)
  },

  startScheduler: async (projectId: string) => {
    const res = await fetch('/api/scheduler/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId }),
    })
    if (!res.ok) throw new Error('Failed to start scheduler')
    get().fetchSchedulerStatus()
  },

  stopScheduler: async () => {
    const res = await fetch('/api/scheduler/stop', {
      method: 'POST',
    })
    if (!res.ok) throw new Error('Failed to stop scheduler')
    get().fetchSchedulerStatus()
  },
}))
