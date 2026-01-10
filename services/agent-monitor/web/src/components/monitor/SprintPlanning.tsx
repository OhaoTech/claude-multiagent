import { useEffect, useState } from 'react'
import {
  Plus,
  Play,
  CheckCircle,
  Target,
  Clock,
  ChevronRight,
  X,
  Trash2
} from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'

interface Sprint {
  id: string
  project_id: string
  name: string
  goal: string | null
  status: 'planning' | 'active' | 'completed' | 'cancelled'
  start_date: string | null
  end_date: string | null
  created_at: string
  updated_at: string
}

interface SprintStats {
  pending: number
  blocked: number
  running: number
  completed: number
  failed: number
  total: number
  completion_percent: number
}

interface Task {
  id: string
  title: string
  status: string
  priority: number
  sprint_id: string | null
}

export function SprintPlanning() {
  const { activeProject } = useProjectStore()
  const [sprints, setSprints] = useState<Sprint[]>([])
  const [selectedSprint, setSelectedSprint] = useState<Sprint | null>(null)
  const [sprintStats, setSprintStats] = useState<SprintStats | null>(null)
  const [sprintTasks, setSprintTasks] = useState<Task[]>([])
  const [backlogTasks, setBacklogTasks] = useState<Task[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [loading, setLoading] = useState(true)

  const projectId = activeProject?.id

  // Fetch sprints
  useEffect(() => {
    if (!projectId) return
    fetchSprints()
    fetchBacklogTasks()
  }, [projectId])

  // Fetch sprint stats and tasks when sprint selected
  useEffect(() => {
    if (selectedSprint) {
      fetchSprintStats(selectedSprint.id)
      fetchSprintTasks(selectedSprint.id)
    }
  }, [selectedSprint])

  const fetchSprints = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/sprints`)
      if (res.ok) {
        const data = await res.json()
        setSprints(data)
        // Auto-select active sprint or first one
        const active = data.find((s: Sprint) => s.status === 'active')
        setSelectedSprint(active || data[0] || null)
      }
    } catch (err) {
      console.error('Failed to fetch sprints:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchSprintStats = async (sprintId: string) => {
    if (!projectId) return
    try {
      const res = await fetch(`/api/projects/${projectId}/sprints/${sprintId}/stats`)
      if (res.ok) {
        const data = await res.json()
        setSprintStats(data)
      }
    } catch (err) {
      console.error('Failed to fetch sprint stats:', err)
    }
  }

  const fetchSprintTasks = async (sprintId: string) => {
    if (!projectId) return
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks?sprint_id=${sprintId}`)
      if (res.ok) {
        const data = await res.json()
        setSprintTasks(data)
      }
    } catch (err) {
      console.error('Failed to fetch sprint tasks:', err)
    }
  }

  const fetchBacklogTasks = async () => {
    if (!projectId) return
    try {
      // Tasks without a sprint
      const res = await fetch(`/api/projects/${projectId}/tasks?sprint_id=`)
      if (res.ok) {
        const data = await res.json()
        setBacklogTasks(data.filter((t: Task) => !t.sprint_id))
      }
    } catch (err) {
      console.error('Failed to fetch backlog:', err)
    }
  }

  const startSprint = async (sprintId: string) => {
    if (!projectId) return
    try {
      const res = await fetch(`/api/projects/${projectId}/sprints/${sprintId}/start`, {
        method: 'POST'
      })
      if (res.ok) {
        fetchSprints()
      }
    } catch (err) {
      console.error('Failed to start sprint:', err)
    }
  }

  const completeSprint = async (sprintId: string) => {
    if (!projectId) return
    try {
      const res = await fetch(`/api/projects/${projectId}/sprints/${sprintId}/complete`, {
        method: 'POST'
      })
      if (res.ok) {
        fetchSprints()
      }
    } catch (err) {
      console.error('Failed to complete sprint:', err)
    }
  }

  const deleteSprint = async (sprintId: string) => {
    if (!projectId) return
    if (!confirm('Delete this sprint? Tasks will move to backlog.')) return
    try {
      const res = await fetch(`/api/projects/${projectId}/sprints/${sprintId}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        setSelectedSprint(null)
        fetchSprints()
        fetchBacklogTasks()
      }
    } catch (err) {
      console.error('Failed to delete sprint:', err)
    }
  }

  const moveTaskToSprint = async (taskId: string, sprintId: string | null) => {
    if (!projectId) return
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sprint_id: sprintId })
      })
      if (res.ok) {
        fetchBacklogTasks()
        if (selectedSprint) {
          fetchSprintTasks(selectedSprint.id)
          fetchSprintStats(selectedSprint.id)
        }
      }
    } catch (err) {
      console.error('Failed to move task:', err)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-400 bg-green-900/30'
      case 'completed': return 'text-blue-400 bg-blue-900/30'
      case 'cancelled': return 'text-red-400 bg-red-900/30'
      default: return 'text-yellow-400 bg-yellow-900/30'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <Play size={12} />
      case 'completed': return <CheckCircle size={12} />
      default: return <Clock size={12} />
    }
  }

  if (loading && sprints.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">
        Loading sprints...
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sprint List Sidebar */}
      <div className="w-64 border-r border-[var(--border)] flex flex-col">
        <div className="p-3 border-b border-[var(--border)] flex items-center justify-between">
          <h3 className="font-medium text-sm">Sprints</h3>
          <button
            onClick={() => setShowCreateModal(true)}
            className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
            title="Create Sprint"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sprints.length === 0 ? (
            <div className="text-center text-[var(--text-secondary)] text-sm py-4">
              No sprints yet
            </div>
          ) : (
            sprints.map(sprint => (
              <button
                key={sprint.id}
                onClick={() => setSelectedSprint(sprint)}
                className={`w-full text-left p-2 rounded transition-colors ${
                  selectedSprint?.id === sprint.id
                    ? 'bg-[var(--accent)] text-white'
                    : 'hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-1 ${getStatusColor(sprint.status)}`}>
                    {getStatusIcon(sprint.status)}
                    {sprint.status}
                  </span>
                </div>
                <div className="font-medium mt-1 truncate">{sprint.name}</div>
                {sprint.end_date && (
                  <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                    Ends: {new Date(sprint.end_date).toLocaleDateString()}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedSprint ? (
          <>
            {/* Sprint Header */}
            <div className="p-4 border-b border-[var(--border)]">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">{selectedSprint.name}</h2>
                    <span className={`text-xs px-2 py-0.5 rounded ${getStatusColor(selectedSprint.status)}`}>
                      {selectedSprint.status}
                    </span>
                  </div>
                  {selectedSprint.goal && (
                    <p className="text-sm text-[var(--text-secondary)] mt-1 flex items-center gap-1">
                      <Target size={14} />
                      {selectedSprint.goal}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedSprint.status === 'planning' && (
                    <button
                      onClick={() => startSprint(selectedSprint.id)}
                      className="px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-sm flex items-center gap-1"
                    >
                      <Play size={14} />
                      Start Sprint
                    </button>
                  )}
                  {selectedSprint.status === 'active' && (
                    <button
                      onClick={() => completeSprint(selectedSprint.id)}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm flex items-center gap-1"
                    >
                      <CheckCircle size={14} />
                      Complete
                    </button>
                  )}
                  <button
                    onClick={() => deleteSprint(selectedSprint.id)}
                    className="p-1.5 hover:bg-red-900/30 rounded text-red-400"
                    title="Delete Sprint"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* Progress Bar */}
              {sprintStats && sprintStats.total > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-[var(--text-secondary)]">Progress</span>
                    <span className="text-green-400">{sprintStats.completion_percent}%</span>
                  </div>
                  <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all"
                      style={{ width: `${sprintStats.completion_percent}%` }}
                    />
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-[var(--text-secondary)]">
                    <span>{sprintStats.completed} completed</span>
                    <span>{sprintStats.running} running</span>
                    <span>{sprintStats.pending + sprintStats.blocked} remaining</span>
                  </div>
                </div>
              )}
            </div>

            {/* Sprint Tasks */}
            <div className="flex-1 overflow-y-auto p-4">
              <h3 className="font-medium text-sm mb-2">Sprint Tasks ({sprintTasks.length})</h3>
              {sprintTasks.length === 0 ? (
                <div className="text-center text-[var(--text-secondary)] text-sm py-8 bg-[var(--bg-tertiary)] rounded">
                  No tasks in this sprint. Drag tasks from backlog or create new ones.
                </div>
              ) : (
                <div className="space-y-1">
                  {sprintTasks.map(task => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between p-2 bg-[var(--bg-tertiary)] rounded hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${
                          task.status === 'completed' ? 'bg-green-500' :
                          task.status === 'running' ? 'bg-blue-500' :
                          task.status === 'failed' ? 'bg-red-500' :
                          'bg-gray-500'
                        }`} />
                        <span className="text-sm">{task.title}</span>
                      </div>
                      <button
                        onClick={() => moveTaskToSprint(task.id, null)}
                        className="text-xs text-[var(--text-secondary)] hover:text-white px-2 py-1 rounded hover:bg-[var(--bg-primary)]"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)]">
            Select a sprint or create a new one
          </div>
        )}
      </div>

      {/* Backlog Panel */}
      <div className="w-64 border-l border-[var(--border)] flex flex-col">
        <div className="p-3 border-b border-[var(--border)]">
          <h3 className="font-medium text-sm">Backlog ({backlogTasks.length})</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {backlogTasks.length === 0 ? (
            <div className="text-center text-[var(--text-secondary)] text-xs py-4">
              No tasks in backlog
            </div>
          ) : (
            backlogTasks.map(task => (
              <div
                key={task.id}
                className="p-2 bg-[var(--bg-tertiary)] rounded text-sm hover:bg-[var(--bg-secondary)] transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="truncate flex-1">{task.title}</span>
                  {selectedSprint && (
                    <button
                      onClick={() => moveTaskToSprint(task.id, selectedSprint.id)}
                      className="ml-2 p-1 hover:bg-[var(--accent)] rounded"
                      title="Add to sprint"
                    >
                      <ChevronRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Create Sprint Modal */}
      {showCreateModal && (
        <CreateSprintModal
          projectId={projectId!}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false)
            fetchSprints()
          }}
        />
      )}
    </div>
  )
}

function CreateSprintModal({
  projectId,
  onClose,
  onCreated
}: {
  projectId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [endDate, setEndDate] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (!name.trim()) return
    setCreating(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/sprints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          goal: goal.trim() || null,
          end_date: endDate || null
        })
      })
      if (res.ok) {
        onCreated()
      }
    } catch (err) {
      console.error('Failed to create sprint:', err)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-secondary)] rounded-lg w-96 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Create Sprint</h3>
          <button onClick={onClose} className="p-1 hover:bg-[var(--bg-tertiary)] rounded">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm text-[var(--text-secondary)] mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sprint 1"
              className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded focus:outline-none focus:border-[var(--accent)]"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--text-secondary)] mb-1">Goal</label>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Complete user authentication"
              className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded focus:outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--text-secondary)] mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm hover:bg-[var(--bg-tertiary)] rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            className="px-3 py-1.5 text-sm bg-[var(--accent)] rounded disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
