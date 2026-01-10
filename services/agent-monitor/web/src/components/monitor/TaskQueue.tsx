import { useEffect, useState } from 'react'
import {
  Plus,
  Play,
  Square,
  RefreshCw,
  Trash2,
  RotateCcw,
  XCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ArrowUpCircle,
  Link2,
  FileText,
  DollarSign,
  ExternalLink,
} from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useTaskStore, type Task } from '../../stores/taskStore'
import { useProjectStore } from '../../stores/projectStore'

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: 'Low', color: 'text-gray-400' },
  1: { label: 'Normal', color: 'text-blue-400' },
  2: { label: 'High', color: 'text-orange-400' },
  3: { label: 'Urgent', color: 'text-red-400' },
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  pending: { icon: <Clock size={14} />, color: 'text-gray-400', bg: 'bg-gray-500/20' },
  blocked: { icon: <Link2 size={14} />, color: 'text-orange-400', bg: 'bg-orange-500/20' },
  assigned: { icon: <ArrowUpCircle size={14} />, color: 'text-blue-400', bg: 'bg-blue-500/20' },
  running: { icon: <Loader2 size={14} className="animate-spin" />, color: 'text-green-400', bg: 'bg-green-500/20' },
  completed: { icon: <CheckCircle2 size={14} />, color: 'text-green-400', bg: 'bg-green-500/20' },
  failed: { icon: <AlertCircle size={14} />, color: 'text-red-400', bg: 'bg-red-500/20' },
}

interface TaskQueueProps {
  compact?: boolean
}

export function TaskQueue({ compact = false }: TaskQueueProps) {
  const { activeProject, agents } = useProjectStore()
  const {
    tasks,
    stats,
    schedulerStatus,
    loading,
    fetchTasks,
    fetchStats,
    fetchSchedulerStatus,
    createTask,
    deleteTask,
    retryTask,
    cancelTask,
    startScheduler,
    stopScheduler,
  } = useTaskStore()

  const [showAddForm, setShowAddForm] = useState(false)
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const [filterStatus, setFilterStatus] = useState<string>('all')

  // Fetch data on mount and when project changes
  useEffect(() => {
    if (activeProject?.id) {
      fetchTasks(activeProject.id)
      fetchStats(activeProject.id)
      fetchSchedulerStatus()
    }
  }, [activeProject?.id])

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (!activeProject?.id) return
    const interval = setInterval(() => {
      fetchTasks(activeProject.id)
      fetchStats(activeProject.id)
      fetchSchedulerStatus()
    }, 10000)
    return () => clearInterval(interval)
  }, [activeProject?.id])

  const handleRefresh = () => {
    if (activeProject?.id) {
      fetchTasks(activeProject.id)
      fetchStats(activeProject.id)
      fetchSchedulerStatus()
    }
  }

  const handleToggleScheduler = async () => {
    if (!activeProject?.id) return
    try {
      if (schedulerStatus?.is_running) {
        await stopScheduler()
      } else {
        await startScheduler(activeProject.id)
      }
    } catch (err) {
      console.error('Failed to toggle scheduler:', err)
    }
  }

  const toggleExpand = (taskId: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) {
        next.delete(taskId)
      } else {
        next.add(taskId)
      }
      return next
    })
  }

  const filteredTasks = filterStatus === 'all'
    ? tasks
    : tasks.filter((t) => t.status === filterStatus)

  // Group tasks by status for display
  const tasksByStatus = {
    running: filteredTasks.filter((t) => t.status === 'running'),
    assigned: filteredTasks.filter((t) => t.status === 'assigned'),
    pending: filteredTasks.filter((t) => t.status === 'pending'),
    blocked: filteredTasks.filter((t) => t.status === 'blocked'),
    completed: filteredTasks.filter((t) => t.status === 'completed'),
    failed: filteredTasks.filter((t) => t.status === 'failed'),
  }

  if (!activeProject) {
    return (
      <div className="p-4 text-center text-[var(--text-secondary)]">
        Select a project to view tasks
      </div>
    )
  }

  return (
    <div className={`flex flex-col h-full overflow-hidden ${compact ? '' : 'p-4'}`}>
      {/* Header */}
      <div className={`flex items-center justify-between ${compact ? 'p-3' : 'mb-4'} border-b border-[var(--border)]`}>
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold">Task Queue</h3>
          {stats && (
            <div className="flex items-center gap-2 text-xs">
              <span className="px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400">
                {stats.pending} pending
              </span>
              <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
                {stats.running} running
              </span>
              {stats.failed > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                  {stats.failed} failed
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Scheduler Toggle */}
          <button
            onClick={handleToggleScheduler}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
              schedulerStatus?.is_running
                ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                : 'bg-gray-500/20 text-gray-400 hover:bg-gray-500/30'
            }`}
            title={schedulerStatus?.is_running ? 'Stop Scheduler' : 'Start Scheduler'}
          >
            {schedulerStatus?.is_running ? (
              <>
                <Square size={12} />
                Stop
              </>
            ) : (
              <>
                <Play size={12} />
                Start
              </>
            )}
          </button>

          <button
            onClick={handleRefresh}
            className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1 px-2 py-1 bg-[var(--accent)] hover:opacity-90 rounded text-xs font-medium transition-opacity"
          >
            <Plus size={12} />
            Add
          </button>
        </div>
      </div>

      {/* Filter */}
      {!compact && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-[var(--text-secondary)]">Filter:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-2 py-1 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-xs"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="blocked">Blocked</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      )}

      {/* Task List */}
      <div className="flex-1 overflow-y-auto">
        {loading && tasks.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[var(--text-secondary)]">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-[var(--text-secondary)]">
            <Clock size={24} className="mb-2 opacity-50" />
            <span className="text-sm">No tasks in queue</span>
          </div>
        ) : (
          <div className="space-y-1">
            {/* Show running tasks first, then by priority */}
            {[...tasksByStatus.running, ...tasksByStatus.assigned, ...tasksByStatus.pending, ...tasksByStatus.blocked, ...tasksByStatus.failed, ...tasksByStatus.completed].map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                expanded={expandedTasks.has(task.id)}
                onToggle={() => toggleExpand(task.id)}
                onDelete={() => activeProject && deleteTask(activeProject.id, task.id)}
                onRetry={() => activeProject && retryTask(activeProject.id, task.id)}
                onCancel={() => activeProject && cancelTask(activeProject.id, task.id)}
                agents={agents}
                compact={compact}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add Task Modal */}
      {showAddForm && activeProject && (
        <AddTaskModal
          agents={agents}
          tasks={tasks}
          onClose={() => setShowAddForm(false)}
          onCreate={async (task) => {
            await createTask(activeProject.id, task)
            setShowAddForm(false)
          }}
        />
      )}
    </div>
  )
}

interface TaskItemProps {
  task: Task
  expanded: boolean
  onToggle: () => void
  onDelete: () => void
  onRetry: () => void
  onCancel: () => void
  agents: Array<{ id: string; name: string }>
  compact?: boolean
}

function TaskItem({ task, expanded, onToggle, onDelete, onRetry, onCancel, agents, compact }: TaskItemProps) {
  const statusConfig = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending
  const priorityConfig = PRIORITY_LABELS[task.priority] || PRIORITY_LABELS[1]
  const agent = agents.find((a) => a.id === task.agent_id)

  return (
    <div className={`border border-[var(--border)] rounded ${statusConfig.bg}`}>
      {/* Main row */}
      <div
        className={`flex items-center gap-2 ${compact ? 'p-2' : 'p-3'} cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors`}
        onClick={onToggle}
      >
        <button className="text-[var(--text-secondary)]">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <span className={statusConfig.color}>{statusConfig.icon}</span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs px-1.5 py-0.5 rounded ${priorityConfig.color} bg-[var(--bg-tertiary)]`}>
              P{task.priority}
            </span>
            <span className="text-sm font-medium truncate">{task.title}</span>
          </div>
          {!compact && task.description && (
            <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">
              {task.description}
            </p>
          )}
        </div>

        {agent && (
          <span className="text-xs px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
            {agent.name}
          </span>
        )}

        <span className={`text-xs ${statusConfig.color}`}>{task.status}</span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-[var(--border)] bg-[var(--bg-tertiary)]/50">
          <div className="grid grid-cols-2 gap-2 text-xs mt-2">
            <div>
              <span className="text-[var(--text-secondary)]">Created:</span>{' '}
              {new Date(task.created_at).toLocaleString()}
            </div>
            {task.started_at && (
              <div>
                <span className="text-[var(--text-secondary)]">Started:</span>{' '}
                {new Date(task.started_at).toLocaleString()}
              </div>
            )}
            {task.completed_at && (
              <div>
                <span className="text-[var(--text-secondary)]">Completed:</span>{' '}
                {new Date(task.completed_at).toLocaleString()}
              </div>
            )}
            {task.retry_count > 0 && (
              <div>
                <span className="text-[var(--text-secondary)]">Retries:</span>{' '}
                {task.retry_count}/{task.max_retries}
              </div>
            )}
            {task.depends_on.length > 0 && (
              <div className="col-span-2">
                <span className="text-[var(--text-secondary)]">Depends on:</span>{' '}
                {task.depends_on.join(', ')}
              </div>
            )}
            {task.error && (
              <div className="col-span-2 text-red-400">
                <span className="text-[var(--text-secondary)]">Error:</span> {task.error}
              </div>
            )}
          </div>

          {/* Running indicator */}
          {task.status === 'running' && task.started_at && (
            <div className="mt-3 p-2 bg-green-900/20 rounded border border-green-800/50">
              <div className="flex items-center gap-2 text-xs text-green-300">
                <Loader2 size={12} className="animate-spin" />
                <span>In progress...</span>
                <span className="text-[var(--text-secondary)]">
                  ({Math.round((Date.now() - new Date(task.started_at).getTime()) / 1000)}s)
                </span>
              </div>
            </div>
          )}

          {/* Result output */}
          {task.result && (
            <TaskResult result={task.result} />
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 mt-3">
            {task.status === 'failed' && (
              <button
                onClick={(e) => { e.stopPropagation(); onRetry() }}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded transition-colors"
              >
                <RotateCcw size={12} />
                Retry
              </button>
            )}
            {task.status === 'running' && (
              <button
                onClick={(e) => { e.stopPropagation(); onCancel() }}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 rounded transition-colors"
              >
                <XCircle size={12} />
                Cancel
              </button>
            )}
            {!['running', 'assigned'].includes(task.status) && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete() }}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded transition-colors"
              >
                <Trash2 size={12} />
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface AddTaskModalProps {
  agents: Array<{ id: string; name: string }>
  tasks: Task[]
  onClose: () => void
  onCreate: (task: { title: string; description?: string; priority?: number; depends_on?: string[]; agent_id?: string }) => Promise<void>
}

function AddTaskModal({ agents, tasks, onClose, onCreate }: AddTaskModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState(1)
  const [agentId, setAgentId] = useState<string>('')
  const [dependsOn, setDependsOn] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('Title is required')
      return
    }

    setLoading(true)
    setError('')
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        agent_id: agentId || undefined,
        depends_on: dependsOn,
      })
    } catch (err: any) {
      setError(err.message || 'Failed to create task')
      setLoading(false)
    }
  }

  // Available tasks for dependencies (exclude completed/failed)
  const availableDeps = tasks.filter((t) => !['completed', 'failed'].includes(t.status))

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--bg-secondary)] rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold">Add Task</h2>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-white text-xl"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-800 rounded text-red-200 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Implement user authentication"
              className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded focus:outline-none focus:border-[var(--accent)]"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed task description..."
              rows={3}
              className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded focus:outline-none focus:border-[var(--accent)] resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value))}
                className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded"
              >
                <option value={0}>Low</option>
                <option value={1}>Normal</option>
                <option value={2}>High</option>
                <option value={3}>Urgent</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Assign to</label>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded"
              >
                <option value="">Auto-assign</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {availableDeps.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1">Depends On</label>
              <div className="max-h-32 overflow-y-auto border border-[var(--border)] rounded p-2 space-y-1">
                {availableDeps.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-[var(--bg-tertiary)] p-1 rounded">
                    <input
                      type="checkbox"
                      checked={dependsOn.includes(t.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setDependsOn([...dependsOn, t.id])
                        } else {
                          setDependsOn(dependsOn.filter((id) => id !== t.id))
                        }
                      }}
                      className="rounded"
                    />
                    <span className="truncate">{t.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="px-4 py-2 bg-[var(--accent)] hover:opacity-90 rounded text-sm font-medium disabled:opacity-50 transition-opacity"
            >
              {loading ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Rich task result display
function TaskResult({ result }: { result: Record<string, unknown> }) {
  const { loadSession } = useChatStore()
  const r = result as {
    summary?: string
    files_changed?: string[]
    session_id?: string
    cost_usd?: number
    duration_ms?: number
    num_turns?: number
    status?: string
    needs?: string[]
    file?: string
    output?: string
  }

  // If it's just a simple output string
  if (r.output && !r.summary && !r.session_id) {
    return (
      <div className="mt-3 p-2 bg-[var(--bg-primary)] rounded border border-[var(--border)]">
        <div className="text-xs text-[var(--text-secondary)] mb-1">Output:</div>
        <pre className="text-xs text-green-300 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
          {r.output}
        </pre>
      </div>
    )
  }

  const handleViewSession = () => {
    if (r.session_id) {
      loadSession(r.session_id)
    }
  }

  return (
    <div className="mt-3 space-y-2">
      {/* Summary */}
      {r.summary && (
        <div className="p-2 bg-[var(--bg-primary)] rounded border border-[var(--border)]">
          <div className="text-xs text-[var(--text-secondary)] mb-1 flex items-center gap-1">
            <FileText size={10} />
            Summary
          </div>
          <div className="text-xs text-[var(--text-primary)] whitespace-pre-wrap">
            {r.summary}
          </div>
        </div>
      )}

      {/* Files changed */}
      {r.files_changed && r.files_changed.length > 0 && (
        <div className="p-2 bg-[var(--bg-primary)] rounded border border-[var(--border)]">
          <div className="text-xs text-[var(--text-secondary)] mb-1">
            Files changed ({r.files_changed.length})
          </div>
          <div className="text-xs font-mono text-blue-300 max-h-24 overflow-y-auto">
            {r.files_changed.map((file, i) => (
              <div key={i} className="truncate">{file}</div>
            ))}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {r.duration_ms && (
          <span className="text-[var(--text-secondary)]">
            <Clock size={10} className="inline mr-1" />
            {Math.round(r.duration_ms / 1000)}s
          </span>
        )}
        {r.num_turns && (
          <span className="text-[var(--text-secondary)]">
            {r.num_turns} turns
          </span>
        )}
        {r.cost_usd && (
          <span className="text-green-400">
            <DollarSign size={10} className="inline" />
            {r.cost_usd.toFixed(2)}
          </span>
        )}
        {r.session_id && (
          <button
            onClick={handleViewSession}
            className="flex items-center gap-1 text-[var(--accent)] hover:underline"
          >
            <ExternalLink size={10} />
            View session
          </button>
        )}
      </div>

      {/* Needs/blockers */}
      {r.needs && r.needs.length > 0 && (
        <div className="text-xs text-orange-400">
          Needs: {r.needs.join(', ')}
        </div>
      )}
    </div>
  )
}
