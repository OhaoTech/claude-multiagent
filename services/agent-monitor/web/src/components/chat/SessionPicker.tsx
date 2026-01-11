import { useState, useEffect } from 'react'
import { X, MessageSquare, Clock, DollarSign, Plus, Trash2, RotateCcw, Pencil, Check, Trash } from 'lucide-react'

interface SessionWithMeta {
  session_id: string
  agent_id: string
  agent: string
  message_count: number
  first_timestamp: number | null
  last_timestamp: number | null
  cost_usd: number
  last_message_preview: string
  cwd: string
  nickname?: string | null
  deleted_at?: string | null
}

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
  const [sessions, setSessions] = useState<SessionWithMeta[]>([])
  const [trashedSessions, setTrashedSessions] = useState<SessionWithMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'sessions' | 'trash'>('sessions')
  const [editingNickname, setEditingNickname] = useState<string | null>(null)
  const [nicknameInput, setNicknameInput] = useState('')

  const fetchSessions = async () => {
    try {
      // Add cache-busting timestamp
      const res = await fetch(`/api/sessions/${agentName}?_t=${Date.now()}`)
      const data = await res.json()
      setSessions(data)
    } catch {
      setSessions([])
    } finally {
      setLoading(false)
    }
  }

  const fetchTrashedSessions = async () => {
    try {
      // Add cache-busting timestamp
      const res = await fetch(`/api/sessions/trash?_t=${Date.now()}`)
      const data = await res.json()
      setTrashedSessions(data)
    } catch {
      setTrashedSessions([])
    }
  }

  useEffect(() => {
    fetchSessions()
    fetchTrashedSessions()
  }, [agentName])

  const handleDelete = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await fetch(`/api/session/${sessionId}`, { method: 'DELETE' })
      setSessions(prev => prev.filter(s => s.session_id !== sessionId))
      fetchTrashedSessions()
    } catch (err) {
      console.error('Failed to delete session:', err)
    }
  }

  const handleRestore = async (sessionId: string) => {
    try {
      await fetch(`/api/session/${sessionId}/restore`, { method: 'POST' })
      setTrashedSessions(prev => prev.filter(s => s.session_id !== sessionId))
      fetchSessions()
    } catch (err) {
      console.error('Failed to restore session:', err)
    }
  }

  const handlePermanentDelete = async (sessionId: string) => {
    try {
      await fetch(`/api/session/${sessionId}/permanent`, { method: 'DELETE' })
      setTrashedSessions(prev => prev.filter(s => s.session_id !== sessionId))
    } catch (err) {
      console.error('Failed to permanently delete session:', err)
    }
  }

  const handleNicknameEdit = (session: SessionWithMeta, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingNickname(session.session_id)
    setNicknameInput(session.nickname || '')
  }

  const handleNicknameSave = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await fetch(`/api/session/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nicknameInput || null }),
      })
      setSessions(prev =>
        prev.map(s =>
          s.session_id === sessionId ? { ...s, nickname: nicknameInput || null } : s
        )
      )
      setEditingNickname(null)
    } catch (err) {
      console.error('Failed to save nickname:', err)
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

  const formatDeletedAt = (deletedAt: string | null) => {
    if (!deletedAt) return ''
    const date = new Date(deletedAt)
    const daysRemaining = Math.ceil(
      (date.getTime() + 30 * 24 * 60 * 60 * 1000 - Date.now()) / (24 * 60 * 60 * 1000)
    )
    return `${daysRemaining} days left`
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

        {/* Tabs */}
        <div className="flex border-b border-[var(--border)]">
          <button
            onClick={() => setActiveTab('sessions')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'sessions'
                ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Sessions ({sessions.length})
          </button>
          <button
            onClick={() => setActiveTab('trash')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-1 ${
              activeTab === 'trash'
                ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Trash size={14} />
            Trash ({trashedSessions.length})
          </button>
        </div>

        {activeTab === 'sessions' && (
          <>
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
                    <div
                      key={session.session_id}
                      onClick={() => {
                        onSelectSession(session.session_id)
                        onClose()
                      }}
                      className={`w-full p-4 text-left hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer ${
                        session.session_id === currentSessionId ? 'bg-[var(--accent)]/20' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        {editingNickname === session.session_id ? (
                          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                            <input
                              type="text"
                              value={nicknameInput}
                              onChange={(e) => setNicknameInput(e.target.value)}
                              placeholder="Session nickname"
                              className="bg-[var(--bg-tertiary)] border border-[var(--border)] rounded px-2 py-1 text-sm w-40"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleNicknameSave(session.session_id, e as any)
                                } else if (e.key === 'Escape') {
                                  setEditingNickname(null)
                                }
                              }}
                            />
                            <button
                              onClick={(e) => handleNicknameSave(session.session_id, e)}
                              className="p-1 hover:bg-[var(--accent)] rounded transition-colors"
                            >
                              <Check size={14} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">
                              {session.nickname || (
                                <span className="font-mono text-[var(--text-secondary)]">
                                  {session.session_id.slice(0, 12)}...
                                </span>
                              )}
                            </span>
                            <button
                              onClick={(e) => handleNicknameEdit(session, e)}
                              className="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors text-[var(--text-secondary)]"
                              title="Edit nickname"
                            >
                              <Pencil size={12} />
                            </button>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[var(--text-secondary)] flex items-center gap-1">
                            <Clock size={12} />
                            {formatTimeAgo(session.last_timestamp)}
                          </span>
                          <button
                            onClick={(e) => handleDelete(session.session_id, e)}
                            className="p-1 hover:bg-red-600/20 rounded transition-colors text-[var(--text-secondary)] hover:text-red-400"
                            title="Move to trash"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
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
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'trash' && (
          <div className="overflow-y-auto max-h-[60vh]">
            {trashedSessions.length === 0 ? (
              <div className="p-8 text-center text-[var(--text-secondary)]">
                <Trash size={32} className="mx-auto mb-2 opacity-50" />
                <p>Trash is empty</p>
                <p className="text-xs mt-1">Deleted sessions are kept for 30 days</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {trashedSessions.map((session) => (
                  <div
                    key={session.session_id}
                    className="p-4 hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">
                        {session.nickname || (
                          <span className="font-mono text-[var(--text-secondary)]">
                            {session.session_id.slice(0, 12)}...
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-orange-400">
                          {formatDeletedAt(session.deleted_at ?? null)}
                        </span>
                        <button
                          onClick={() => handleRestore(session.session_id)}
                          className="p-1 hover:bg-green-600/20 rounded transition-colors text-[var(--text-secondary)] hover:text-green-400"
                          title="Restore"
                        >
                          <RotateCcw size={14} />
                        </button>
                        <button
                          onClick={() => handlePermanentDelete(session.session_id)}
                          className="p-1 hover:bg-red-600/20 rounded transition-colors text-[var(--text-secondary)] hover:text-red-400"
                          title="Delete permanently"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <p className="text-sm text-[var(--text-secondary)] truncate mb-2">
                      {session.last_message_preview || 'No messages'}
                    </p>

                    <div className="flex items-center gap-4 text-xs text-[var(--text-secondary)]">
                      <span className="flex items-center gap-1">
                        <MessageSquare size={12} />
                        {session.message_count} messages
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
