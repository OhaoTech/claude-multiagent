import { useState, useEffect } from 'react'
import { X, MessageSquare, Clock, DollarSign, Plus } from 'lucide-react'
import type { SessionInfo } from '../../types'

interface SessionPickerProps {
  agentName: string
  currentSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onNewSession: () => void
  onClose: () => void
}

export function SessionPicker({
  agentName,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onClose,
}: SessionPickerProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchSessions = async () => {
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-secondary)] rounded-lg w-[500px] max-h-[70vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold">Sessions - {agentName}</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 border-b border-[var(--border)]">
          <button
            onClick={() => {
              onNewSession()
              onClose()
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[var(--accent)] hover:opacity-90 rounded font-medium transition-opacity"
          >
            <Plus size={16} />
            New Session
          </button>
        </div>

        <div className="overflow-y-auto max-h-[50vh]">
          {loading ? (
            <div className="p-8 text-center text-[var(--text-secondary)]">
              Loading sessions...
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-8 text-center text-[var(--text-secondary)]">
              No sessions yet
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {sessions.map((session) => (
                <button
                  key={session.session_id}
                  onClick={() => {
                    onSelectSession(session.session_id)
                    onClose()
                  }}
                  className={`w-full p-4 text-left hover:bg-[var(--bg-tertiary)] transition-colors ${
                    session.session_id === currentSessionId ? 'bg-[var(--accent)]/20' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm">
                      {session.session_id.slice(0, 12)}...
                    </span>
                    <span className="text-xs text-[var(--text-secondary)] flex items-center gap-1">
                      <Clock size={12} />
                      {formatTimeAgo(session.last_timestamp)}
                    </span>
                  </div>

                  <p className="text-sm text-[var(--text-secondary)] truncate mb-2">
                    {session.last_message_preview || 'No messages'}
                  </p>

                  <div className="flex items-center gap-4 text-xs text-[var(--text-secondary)]">
                    <span className="flex items-center gap-1">
                      <MessageSquare size={12} />
                      {session.message_count} messages
                    </span>
                    {session.cost_usd > 0 && (
                      <span className="flex items-center gap-1">
                        <DollarSign size={12} />
                        ${session.cost_usd.toFixed(4)}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
