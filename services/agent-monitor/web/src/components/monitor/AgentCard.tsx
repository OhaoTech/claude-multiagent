import { Crown, Play, Pause, AlertCircle } from 'lucide-react'
import type { AgentState } from '../../stores/wsStore'

interface AgentCardProps {
  agent: AgentState
  isSelected: boolean
  onClick: () => void
}

const statusColors = {
  idle: 'border-gray-500',
  running: 'border-green-500 animate-pulse',
  waiting: 'border-yellow-500',
  error: 'border-red-500',
}

const statusIcons = {
  idle: Pause,
  running: Play,
  waiting: Pause,
  error: AlertCircle,
}

export function AgentCard({ agent, isSelected, onClick }: AgentCardProps) {
  const StatusIcon = statusIcons[agent.state] || Pause

  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-lg border-2 transition-all text-left ${statusColors[agent.state]} ${
        isSelected ? 'bg-[var(--accent)]/20 ring-2 ring-[var(--accent)]' : 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{agent.agent}</span>
          {agent.is_leader && (
            <Crown size={14} className="text-yellow-500" />
          )}
        </div>
        <StatusIcon
          size={16}
          className={agent.state === 'running' ? 'text-green-500' : 'text-[var(--text-secondary)]'}
        />
      </div>

      <div className="text-xs text-[var(--text-secondary)] space-y-1">
        <div className="flex justify-between">
          <span>Status</span>
          <span className={`capitalize ${agent.state === 'running' ? 'text-green-400' : ''}`}>
            {agent.state}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Runs</span>
          <span>{agent.run_count || 0}</span>
        </div>
        {agent.current_task && (
          <div className="mt-2 truncate text-[var(--text-primary)]">
            {agent.current_task}
          </div>
        )}
      </div>
    </button>
  )
}
