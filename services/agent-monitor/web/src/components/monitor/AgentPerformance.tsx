import { useEffect, useState } from 'react'
import {
  BarChart3,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  User,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'

interface AgentMetrics {
  agent_id: string
  agent_name: string
  domain: string
  status: string
  total_tasks: number
  completed_tasks: number
  failed_tasks: number
  running_tasks: number
  success_rate: number
  avg_duration_minutes: number
}

interface TaskHistory {
  id: string
  title: string
  status: string
  priority: number
  started_at: string | null
  completed_at: string | null
}

export function AgentPerformance() {
  const { activeProject } = useProjectStore()
  const [metrics, setMetrics] = useState<AgentMetrics[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)
  const [agentHistory, setAgentHistory] = useState<Record<string, TaskHistory[]>>({})

  const projectId = activeProject?.id

  const fetchMetrics = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/performance`)
      if (res.ok) {
        setMetrics(await res.json())
      }
    } catch (err) {
      console.error('Failed to fetch metrics:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchAgentHistory = async (agentId: string) => {
    if (!projectId || agentHistory[agentId]) return
    try {
      const res = await fetch(`/api/projects/${projectId}/agents/${agentId}/history`)
      if (res.ok) {
        const data = await res.json()
        setAgentHistory(prev => ({ ...prev, [agentId]: data }))
      }
    } catch (err) {
      console.error('Failed to fetch agent history:', err)
    }
  }

  useEffect(() => {
    fetchMetrics()
  }, [projectId])

  const toggleExpand = (agentId: string) => {
    if (expandedAgent === agentId) {
      setExpandedAgent(null)
    } else {
      setExpandedAgent(agentId)
      fetchAgentHistory(agentId)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-400'
      case 'inactive': return 'text-gray-400'
      default: return 'text-yellow-400'
    }
  }

  const getTaskStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 size={12} className="text-green-400" />
      case 'failed': return <XCircle size={12} className="text-red-400" />
      case 'running': return <Clock size={12} className="text-blue-400 animate-pulse" />
      default: return <Clock size={12} className="text-gray-400" />
    }
  }

  const formatDuration = (minutes: number) => {
    if (minutes < 1) return '<1m'
    if (minutes < 60) return `${Math.round(minutes)}m`
    const hours = Math.floor(minutes / 60)
    const mins = Math.round(minutes % 60)
    return `${hours}h ${mins}m`
  }

  if (loading && metrics.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-[var(--text-secondary)]" />
      </div>
    )
  }

  // Calculate summary stats
  const totalCompleted = metrics.reduce((sum, m) => sum + m.completed_tasks, 0)
  const totalFailed = metrics.reduce((sum, m) => sum + m.failed_tasks, 0)
  const totalTasks = metrics.reduce((sum, m) => sum + m.total_tasks, 0)
  const overallSuccessRate = totalTasks > 0 ? (totalCompleted / totalTasks * 100) : 0

  return (
    <div className="p-4 space-y-6 overflow-y-auto max-h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <BarChart3 size={20} className="text-[var(--accent)]" />
          Agent Performance
        </h2>
        <button
          onClick={fetchMetrics}
          className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          icon={<User size={18} />}
          label="Agents"
          value={metrics.length.toString()}
          subtext={`${metrics.filter(m => m.status === 'active').length} active`}
          color="text-blue-400"
        />
        <SummaryCard
          icon={<CheckCircle2 size={18} />}
          label="Completed"
          value={totalCompleted.toString()}
          subtext={`${totalTasks} total`}
          color="text-green-400"
        />
        <SummaryCard
          icon={<XCircle size={18} />}
          label="Failed"
          value={totalFailed.toString()}
          subtext={totalTasks > 0 ? `${(totalFailed / totalTasks * 100).toFixed(1)}%` : '0%'}
          color="text-red-400"
        />
        <SummaryCard
          icon={<TrendingUp size={18} />}
          label="Success Rate"
          value={`${overallSuccessRate.toFixed(1)}%`}
          subtext="overall"
          color="text-purple-400"
        />
      </div>

      {/* Agent List */}
      <div className="space-y-2">
        {metrics.length === 0 ? (
          <div className="text-center text-[var(--text-secondary)] py-8">
            No agents found. Add agents to track performance.
          </div>
        ) : (
          metrics.map(agent => (
            <div
              key={agent.agent_id}
              className="bg-[var(--bg-tertiary)] rounded-lg overflow-hidden"
            >
              {/* Agent Header */}
              <button
                onClick={() => toggleExpand(agent.agent_id)}
                className="w-full p-3 flex items-center justify-between hover:bg-[var(--bg-secondary)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  {expandedAgent === agent.agent_id ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{agent.agent_name}</span>
                      <span className={`text-xs ${getStatusColor(agent.status)}`}>
                        {agent.status}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      {agent.domain}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-sm">
                  {/* Success Rate */}
                  <div className="text-right">
                    <div className={agent.success_rate >= 80 ? 'text-green-400' : agent.success_rate >= 50 ? 'text-yellow-400' : 'text-red-400'}>
                      {agent.success_rate}%
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">success</div>
                  </div>

                  {/* Task Count */}
                  <div className="text-right w-16">
                    <div>{agent.completed_tasks}/{agent.total_tasks}</div>
                    <div className="text-xs text-[var(--text-secondary)]">tasks</div>
                  </div>

                  {/* Avg Duration */}
                  <div className="text-right w-16">
                    <div>{formatDuration(agent.avg_duration_minutes)}</div>
                    <div className="text-xs text-[var(--text-secondary)]">avg</div>
                  </div>
                </div>
              </button>

              {/* Success Rate Bar */}
              <div className="px-3 pb-3">
                <div className="h-1.5 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      agent.success_rate >= 80 ? 'bg-green-500' :
                      agent.success_rate >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${agent.success_rate}%` }}
                  />
                </div>
              </div>

              {/* Expanded Task History */}
              {expandedAgent === agent.agent_id && (
                <div className="border-t border-[var(--border)] p-3">
                  <h4 className="text-xs font-medium text-[var(--text-secondary)] mb-2">
                    Recent Tasks
                  </h4>
                  {!agentHistory[agent.agent_id] ? (
                    <div className="text-center py-2">
                      <RefreshCw size={14} className="animate-spin mx-auto text-[var(--text-secondary)]" />
                    </div>
                  ) : agentHistory[agent.agent_id].length === 0 ? (
                    <div className="text-center text-[var(--text-secondary)] text-xs py-2">
                      No tasks found
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {agentHistory[agent.agent_id].slice(0, 10).map(task => (
                        <div
                          key={task.id}
                          className="flex items-center gap-2 text-xs p-1.5 bg-[var(--bg-secondary)] rounded"
                        >
                          {getTaskStatusIcon(task.status)}
                          <span className="flex-1 truncate">{task.title}</span>
                          {task.completed_at && (
                            <span className="text-[var(--text-secondary)]">
                              {new Date(task.completed_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  subtext,
  color
}: {
  icon: React.ReactNode
  label: string
  value: string
  subtext: string
  color: string
}) {
  return (
    <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
      <div className="flex items-center gap-2 text-[var(--text-secondary)] text-xs mb-1">
        <span className={color}>{icon}</span>
        {label}
      </div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {subtext && (
        <div className="text-xs text-[var(--text-secondary)]">{subtext}</div>
      )}
    </div>
  )
}
