import { useState, useEffect, useMemo } from 'react'
import { MessageSquare, DollarSign, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import type { SessionInfo } from '../../types'

type SortField = 'date' | 'messages' | 'cost'
type SortOrder = 'asc' | 'desc'

interface SessionsListProps {
  agentName: string | null
  onSelectSession: (sessionId: string) => void
}

export function SessionsList({ agentName, onSelectSession }: SessionsListProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [showFilters, setShowFilters] = useState(false)
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all')
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

  // Filter and sort sessions
  const filteredSessions = useMemo(() => {
    let result = [...sessions]

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(session =>
        session.session_id.toLowerCase().includes(query) ||
        (session.last_message_preview?.toLowerCase().includes(query))
      )
    }

    // Date filter
    if (dateFilter !== 'all') {
      const now = Date.now()
      const cutoffs = {
        today: now - 24 * 60 * 60 * 1000,
        week: now - 7 * 24 * 60 * 60 * 1000,
        month: now - 30 * 24 * 60 * 60 * 1000,
      }
      const cutoff = cutoffs[dateFilter]
      result = result.filter(session =>
        session.last_timestamp && (session.last_timestamp * 1000) > cutoff
      )
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0
      switch (sortField) {
        case 'date':
          comparison = (a.last_timestamp || 0) - (b.last_timestamp || 0)
          break
        case 'messages':
          comparison = a.message_count - b.message_count
          break
        case 'cost':
          comparison = a.cost_usd - b.cost_usd
          break
      }
      return sortOrder === 'desc' ? -comparison : comparison
    })

    return result
  }, [sessions, searchQuery, dateFilter, sortField, sortOrder])

  const clearFilters = () => {
    setSearchQuery('')
    setDateFilter('all')
    setSortField('date')
    setSortOrder('desc')
  }

  const hasActiveFilters = searchQuery || dateFilter !== 'all' || sortField !== 'date' || sortOrder !== 'desc'

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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-1.5 rounded transition-colors ${
              showFilters || hasActiveFilters
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-tertiary)]'
            }`}
            title="Filters"
          >
            <SlidersHorizontal size={14} />
          </button>
          <button
            onClick={handleNewChat}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--accent)] hover:opacity-90 rounded transition-opacity"
          >
            <Plus size={12} />
            New Chat
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      {showFilters && (
        <div className="px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border)] space-y-2">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sessions..."
              className="w-full pl-8 pr-3 py-1.5 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--accent)]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Filter Row */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Date filter */}
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}
              className="px-2 py-1 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-xs"
            >
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
            </select>

            {/* Sort */}
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
              className="px-2 py-1 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-xs"
            >
              <option value="date">Sort by Date</option>
              <option value="messages">Sort by Messages</option>
              <option value="cost">Sort by Cost</option>
            </select>

            <button
              onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
              className="px-2 py-1 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-xs hover:bg-[var(--bg-secondary)] transition-colors"
            >
              {sortOrder === 'desc' ? '↓ Desc' : '↑ Asc'}
            </button>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-white"
              >
                Clear
              </button>
            )}
          </div>

          {/* Results count */}
          <div className="text-xs text-[var(--text-secondary)]">
            {filteredSessions.length} of {sessions.length} sessions
          </div>
        </div>
      )}

      <div className="max-h-[200px] overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-[var(--text-secondary)]">
            <p className="text-sm">Loading sessions...</p>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="p-4 text-center text-[var(--text-secondary)]">
            <p className="text-sm">
              {sessions.length === 0 ? 'No sessions yet' : 'No matching sessions'}
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-xs text-[var(--accent)] hover:underline mt-1"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filteredSessions.slice(0, 20).map((session) => (
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
