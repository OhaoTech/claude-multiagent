import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Crown, User, Play, Pause, AlertCircle, Clock, CheckCircle } from 'lucide-react'

export interface AgentNodeData {
  label: string
  status: 'idle' | 'working' | 'blocked' | 'done' | 'waiting'
  task?: string | null
  isLeader?: boolean
  domain?: string
  blockers?: string[]
  [key: string]: unknown  // Index signature for React Flow compatibility
}

const statusConfig: Record<string, {
  borderColor: string
  bgColor: string
  icon: typeof Play
  iconColor: string
  label: string
  animation: string
}> = {
  idle: {
    borderColor: 'border-gray-500',
    bgColor: 'bg-gray-500/10',
    icon: Pause,
    iconColor: 'text-gray-400',
    label: 'Idle',
    animation: '',
  },
  working: {
    borderColor: 'border-green-500',
    bgColor: 'bg-green-500/10',
    icon: Play,
    iconColor: 'text-green-400',
    label: 'Working',
    animation: 'animate-pulse',
  },
  blocked: {
    borderColor: 'border-red-500',
    bgColor: 'bg-red-500/10',
    icon: AlertCircle,
    iconColor: 'text-red-400',
    label: 'Blocked',
    animation: '',
  },
  waiting: {
    borderColor: 'border-orange-500',
    bgColor: 'bg-orange-500/10',
    icon: Clock,
    iconColor: 'text-orange-400',
    label: 'Waiting',
    animation: '',
  },
  done: {
    borderColor: 'border-blue-500',
    bgColor: 'bg-blue-500/10',
    icon: CheckCircle,
    iconColor: 'text-blue-400',
    label: 'Done',
    animation: '',
  },
}

interface AgentNodeComponentProps {
  data: AgentNodeData
  selected?: boolean
}

function AgentNodeComponent({ data, selected }: AgentNodeComponentProps) {
  const status = data.status || 'idle'
  const config = statusConfig[status] || statusConfig.idle
  const StatusIcon = config.icon

  return (
    <div
      className={`
        px-4 py-3 rounded-lg border-2 min-w-[140px]
        ${config.borderColor} ${config.bgColor} ${config.animation}
        ${selected ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-primary)]' : ''}
        ${status === 'waiting' ? 'border-dashed' : ''}
        transition-all duration-200
      `}
    >
      {/* Handles for edges */}
      <Handle type="target" position={Position.Top} className="!bg-[var(--accent)]" />
      <Handle type="source" position={Position.Bottom} className="!bg-[var(--accent)]" />

      {/* Agent icon and name */}
      <div className="flex items-center gap-2 mb-2">
        {data.isLeader ? (
          <Crown size={16} className="text-yellow-500" />
        ) : (
          <User size={16} className="text-[var(--text-secondary)]" />
        )}
        <span className="font-semibold text-sm">{data.label}</span>
      </div>

      {/* Status */}
      <div className="flex items-center gap-1.5 text-xs">
        <StatusIcon size={14} className={config.iconColor} />
        <span className={config.iconColor}>{config.label}</span>
      </div>

      {/* Current task */}
      {data.task && (
        <div className="mt-2 text-xs text-[var(--text-secondary)] truncate max-w-[120px]" title={data.task}>
          {data.task}
        </div>
      )}

      {/* Domain (small) */}
      {data.domain && (
        <div className="mt-1 text-[10px] text-[var(--text-secondary)] opacity-60 truncate">
          {data.domain}
        </div>
      )}
    </div>
  )
}

export const AgentNode = memo(AgentNodeComponent)
