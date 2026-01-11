import { useEffect, useState } from 'react'
import {
  DollarSign,
  MessageSquare,
  Clock,
  Zap,
  TrendingUp,
  RefreshCw,
  Cpu
} from 'lucide-react'

interface ModelUsage {
  model_id: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  estimated_cost_usd: number
}

interface DailyActivity {
  date: string
  message_count: number
  session_count: number
  tool_call_count: number
  tokens_by_model: Record<string, number>
}

interface UsageData {
  total_sessions: number
  total_messages: number
  first_session_date: string | null
  models: ModelUsage[]
  daily_activity: DailyActivity[]
  total_estimated_cost_usd: number
  period_days: number
}

interface RealtimeUsage {
  date: string
  today: {
    messages: number
    tool_calls: number
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    cache_creation_tokens: number
    total_tokens: number
    sessions: number
    estimated_cost_usd: number
  }
  models: Record<string, { input: number; output: number }>
  recent_sessions: Array<{
    session_id: string
    project: string
    messages: number
    tool_calls: number
    tokens: number
  }>
}

export function UsageAnalytics() {
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [realtimeUsage, setRealtimeUsage] = useState<RealtimeUsage | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)

  const fetchUsage = async () => {
    setLoading(true)
    try {
      // Use the accurate endpoint that scans all session files
      const [accurateRes, realtimeRes] = await Promise.all([
        fetch(`/api/usage/accurate?days=${days}`),
        fetch('/api/usage/realtime')
      ])

      if (accurateRes.ok) {
        const data = await accurateRes.json()
        setUsage(data)
      }

      if (realtimeRes.ok) {
        const data = await realtimeRes.json()
        setRealtimeUsage(data)
      }
    } catch (err) {
      console.error('Failed to fetch usage:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsage()
  }, [days])

  // Auto-refresh realtime data every 30 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/usage/realtime')
        if (res.ok) {
          const data = await res.json()
          setRealtimeUsage(data)
        }
      } catch {
        // Ignore errors on auto-refresh
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  if (loading && !usage) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-[var(--text-secondary)]" />
      </div>
    )
  }

  if (!usage) {
    return (
      <div className="text-center text-[var(--text-secondary)] py-8">
        No usage data available
      </div>
    )
  }

  // Data is now accurate from the /api/usage/accurate endpoint
  const todayDate = new Date().toISOString().split('T')[0]

  // Calculate daily averages
  const recentDays = usage.daily_activity.length
  const avgMessagesPerDay = recentDays > 0
    ? Math.round(usage.daily_activity.reduce((sum, d) => sum + d.message_count, 0) / recentDays)
    : 0
  const avgToolCallsPerDay = recentDays > 0
    ? Math.round(usage.daily_activity.reduce((sum, d) => sum + d.tool_call_count, 0) / recentDays)
    : 0

  // Calculate token totals
  const totalInputTokens = usage.models.reduce((sum, m) => sum + m.input_tokens, 0)
  const totalOutputTokens = usage.models.reduce((sum, m) => sum + m.output_tokens, 0)
  const totalCacheReadTokens = usage.models.reduce((sum, m) => sum + m.cache_read_tokens, 0)
  const totalCacheCreationTokens = usage.models.reduce((sum, m) => sum + m.cache_creation_tokens, 0)

  // Format model name for display
  const formatModelName = (modelId: string): string => {
    if (modelId.includes('opus-4-5')) return 'Opus 4.5'
    if (modelId.includes('sonnet-4-5')) return 'Sonnet 4.5'
    if (modelId.includes('opus-4-1')) return 'Opus 4.1'
    return modelId.split('-').slice(1, 3).join(' ')
  }

  // Format large numbers
  const formatNumber = (n: number): string => {
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return n.toString()
  }

  // Format cost
  const formatCost = (cost: number): string => {
    if (cost >= 1000) return `$${(cost / 1000).toFixed(2)}K`
    return `$${cost.toFixed(2)}`
  }

  // Get model color
  const getModelColor = (modelId: string): string => {
    if (modelId.includes('opus')) return 'text-purple-400'
    if (modelId.includes('sonnet')) return 'text-blue-400'
    return 'text-gray-400'
  }

  return (
    <div className="p-4 space-y-6 overflow-y-auto max-h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <TrendingUp size={20} className="text-[var(--accent)]" />
          Usage Analytics
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-xs bg-[var(--bg-tertiary)] border border-[var(--border)] rounded px-2 py-1"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={fetchUsage}
            className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Today's Usage - Real-time from session files */}
      {realtimeUsage && (
        <RealtimeUsageCard data={realtimeUsage} />
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<DollarSign size={18} />}
          label="Total Est. Cost"
          value={formatCost(usage.total_estimated_cost_usd)}
          subtext={`last ${days} days`}
          color="text-green-400"
        />
        <StatCard
          icon={<MessageSquare size={18} />}
          label="Messages"
          value={formatNumber(usage.total_messages)}
          subtext={`${usage.total_sessions} sessions`}
          color="text-blue-400"
        />
        <StatCard
          icon={<Zap size={18} />}
          label="Avg/Day"
          value={formatNumber(avgMessagesPerDay)}
          subtext={`${formatNumber(avgToolCallsPerDay)} tools`}
          color="text-yellow-400"
        />
        <StatCard
          icon={<Clock size={18} />}
          label="First Session"
          value={usage.first_session_date ? new Date(usage.first_session_date).toLocaleDateString() : 'N/A'}
          subtext=""
          color="text-purple-400"
        />
      </div>

      {/* Model Breakdown */}
      <div className="bg-[var(--bg-tertiary)] rounded-lg p-4">
        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Cpu size={16} />
          Cost by Model
          <span className="text-[10px] px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">ACCURATE</span>
        </h3>
        <div className="space-y-3">
          {usage.models.map((model) => {
            const percentage = usage.total_estimated_cost_usd > 0
              ? (model.estimated_cost_usd / usage.total_estimated_cost_usd) * 100
              : 0
            return (
              <div key={model.model_id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className={`font-medium ${getModelColor(model.model_id)}`}>
                    {formatModelName(model.model_id)}
                  </span>
                  <span className="text-green-400">{formatCost(model.estimated_cost_usd)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                    <div
                      className={`h-full ${model.model_id.includes('opus') ? 'bg-purple-500' : 'bg-blue-500'} rounded-full`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="text-xs text-[var(--text-secondary)] w-12 text-right">
                    {percentage.toFixed(1)}%
                  </span>
                </div>
                <div className="flex gap-4 text-xs text-[var(--text-secondary)]">
                  <span>In: {formatNumber(model.input_tokens)}</span>
                  <span>Out: {formatNumber(model.output_tokens)}</span>
                  <span>Cache: {formatNumber(model.cache_read_tokens)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Daily Activity Chart */}
      <div className="bg-[var(--bg-tertiary)] rounded-lg p-4">
        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
          Daily Activity
          <span className="text-[10px] px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">ACCURATE</span>
        </h3>
        <div className="space-y-2">
          {usage.daily_activity.slice(0, 14).map((day) => {
            const maxMessages = Math.max(...usage.daily_activity.map(d => d.message_count))
            const percentage = maxMessages > 0 ? (day.message_count / maxMessages) * 100 : 0
            const isToday = day.date === todayDate
            return (
              <div key={day.date} className="flex items-center gap-2 text-xs">
                <span className={`w-20 ${isToday ? 'text-green-400 font-medium' : 'text-[var(--text-secondary)]'}`}>
                  {isToday ? 'Today' : new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                <div className="flex-1 h-4 bg-[var(--bg-secondary)] rounded overflow-hidden">
                  <div
                    className={`h-full rounded ${isToday ? 'bg-green-500' : 'bg-[var(--accent)]'}`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                <span className={`w-16 text-right ${isToday ? 'text-green-400' : 'text-[var(--text-secondary)]'}`}>
                  {formatNumber(day.message_count)}
                </span>
                <span className="w-12 text-right text-[var(--text-secondary)]">
                  {day.session_count} sess
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Token Stats */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
          <div className="text-[var(--text-secondary)] mb-1">Total Input Tokens</div>
          <div className="text-lg font-medium">
            {formatNumber(totalInputTokens)}
          </div>
        </div>
        <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
          <div className="text-[var(--text-secondary)] mb-1">Total Output Tokens</div>
          <div className="text-lg font-medium">
            {formatNumber(totalOutputTokens)}
          </div>
        </div>
        <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
          <div className="text-[var(--text-secondary)] mb-1">Cache Read Tokens</div>
          <div className="text-lg font-medium text-green-400">
            {formatNumber(totalCacheReadTokens)}
          </div>
        </div>
        <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
          <div className="text-[var(--text-secondary)] mb-1">Cache Creation Tokens</div>
          <div className="text-lg font-medium text-yellow-400">
            {formatNumber(totalCacheCreationTokens)}
          </div>
        </div>
      </div>
    </div>
  )
}

// Helper component for stat cards
function StatCard({
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

// Real-time usage card - reads from session files directly
function RealtimeUsageCard({ data }: { data: RealtimeUsage }) {
  const formatK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toString()
  const formatM = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : formatK(n)

  const today = data.today

  return (
    <div className="bg-[var(--bg-tertiary)] rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Zap size={16} className="text-yellow-400" />
          Today's Usage
          <span className="text-[10px] px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">LIVE</span>
        </h3>
        <span className="text-xs text-[var(--text-secondary)]">
          {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-400">{formatK(today.messages)}</div>
          <div className="text-xs text-[var(--text-secondary)]">Messages</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-purple-400">{formatK(today.tool_calls)}</div>
          <div className="text-xs text-[var(--text-secondary)]">Tool Calls</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-400">{formatM(today.total_tokens)}</div>
          <div className="text-xs text-[var(--text-secondary)]">Tokens</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-yellow-400">${today.estimated_cost_usd.toFixed(2)}</div>
          <div className="text-xs text-[var(--text-secondary)]">Est. Cost</div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-[var(--text-secondary)]">
        <span>{today.sessions} active session{today.sessions !== 1 ? 's' : ''}</span>
        <div className="flex gap-3">
          <span>In: {formatK(today.input_tokens)}</span>
          <span>Out: {formatK(today.output_tokens)}</span>
          <span className="text-green-400">Cache: {formatM(today.cache_read_tokens)}</span>
        </div>
      </div>
    </div>
  )
}
