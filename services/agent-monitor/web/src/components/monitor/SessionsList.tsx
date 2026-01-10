import { useState, useEffect } from 'react'
import { MessageSquare, DollarSign, Plus } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import type { SessionInfo } from '../../types'

interface SessionsListProps {
  agentName: string | null
  onSelectSession: (sessionId: string) => void
}

export function SessionsList({ agentName, onSelectSession }: SessionsListProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const { setAgent, clearMessages } = useChatStore()

  useEffect(() => {
    if (!agentName) {
      setSessions([])
      return
    }

    const fetchSessions = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/sessions/${agentName}`)
        const data = await res.json()
        setSessions(data)
      } catch {
        setSessions([])
      } finally {
        setLoading(false)
      }
    }

    fetchSessions()
  }, [agentName])

  const handleNewChat = () => {
    if (agentName) {
      setAgent(agentName)
      clearMessages()
    }
  }

  const formatTimeAgo = (timestamp: number | null) => {
    if (!timestamp) return 'Never'
    const seconds = Math.floor((Date.now() - timestamp * 1000) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  if (!agentName) {
    return (
      <div className="p-4 text-center text-[var(--text-secondary)]">
        <p className="text-sm">Select an agent to view sessions</p>
      </div>
    )
  }

  return (
    <div className="border-t border-[var(--border)]">
      <div className="px-4 py-2 border-b border-[var(--border)] flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">
          Sessions - {agentName}
        </h3>
        <button
          onClick={handleNewChat}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--accent)] hover:opacity-90 rounded transition-opacity"
        >
          <Plus size={12} />
          New Chat
        </button>
      </div>

      <div className="max-h-[200px] overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-[var(--text-secondary)]">
            <p className="text-sm">Loading sessions...</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-4 text-center text-[var(--text-secondary)]">
            <p className="text-sm">No sessions yet</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {sessions.slice(0, 10).map((session) => (
              <button
                key={session.session_id}
                onClick={() => onSelectSession(session.session_id)}
                className="w-full px-4 py-3 text-left hover:bg-[var(--bg-secondary)] transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-mono text-[var(--text-secondary)]">
                    {session.session_id.slice(0, 8)}...
                  </span>
                  <span className="text-xs text-[var(--text-secondary)]">
                    {formatTimeAgo(session.last_timestamp)}
                  </span>
                </div>

                <p className="text-sm truncate text-[var(--text-secondary)] mb-2">
                  {session.last_message_preview || 'No messages'}
                </p>

                <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                  <span className="flex items-center gap-1">
                    <MessageSquare size={10} />
                    {session.message_count}
                  </span>
                  {session.cost_usd > 0 && (
                    <span className="flex items-center gap-1">
                      <DollarSign size={10} />
                      {session.cost_usd.toFixed(4)}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
