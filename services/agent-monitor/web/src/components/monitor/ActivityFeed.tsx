import { Circle, CheckCircle, AlertCircle, MessageSquare } from 'lucide-react'
import { useWsStore, type ActivityItem } from '../../stores/wsStore'

const typeConfig = {
  state: {
    icon: Circle,
    color: 'text-blue-400',
    bgColor: 'bg-blue-900/20',
  },
  result: {
    icon: CheckCircle,
    color: 'text-green-400',
    bgColor: 'bg-green-900/20',
  },
  output: {
    icon: MessageSquare,
    color: 'text-gray-400',
    bgColor: 'bg-gray-900/20',
  },
  error: {
    icon: AlertCircle,
    color: 'text-red-400',
    bgColor: 'bg-red-900/20',
  },
}

export function ActivityFeed() {
  const { activityFeed } = useWsStore()

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  if (activityFeed.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)]">
        <p className="text-sm">No activity yet</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-2 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-primary)]">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">Activity Feed</h3>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {activityFeed.map((item) => (
          <ActivityRow key={item.id} item={item} formatTime={formatTime} />
        ))}
      </div>
    </div>
  )
}

function ActivityRow({
  item,
  formatTime,
}: {
  item: ActivityItem
  formatTime: (t: number) => string
}) {
  const config = typeConfig[item.type]
  const Icon = config.icon

  return (
    <div className={`px-4 py-2 ${config.bgColor} hover:bg-[var(--bg-secondary)] transition-colors`}>
      <div className="flex items-start gap-2">
        <Icon size={14} className={`mt-0.5 flex-shrink-0 ${config.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-medium">{item.agent}</span>
            <span className="text-xs text-[var(--text-secondary)]">
              {formatTime(item.timestamp)}
            </span>
          </div>
          <p className="text-sm text-[var(--text-secondary)] truncate">
            {item.content}
          </p>
        </div>
      </div>
    </div>
  )
}
