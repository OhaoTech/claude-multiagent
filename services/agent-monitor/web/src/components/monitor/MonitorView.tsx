import { useState } from 'react'
import { LayoutGrid, Network, ListTodo, TrendingUp, Target, BarChart3 } from 'lucide-react'
import { AgentGrid } from './AgentGrid'
import { TeamNetworkView } from './TeamNetworkView'
import { TaskQueue } from './TaskQueue'
import { UsageAnalytics } from './UsageAnalytics'
import { SprintPlanning } from './SprintPlanning'
import { AgentPerformance } from './AgentPerformance'
import { StateBanner } from './StateBanner'
import { ActivityFeed } from './ActivityFeed'
import { SessionsList } from './SessionsList'
import { useChatStore } from '../../stores/chatStore'

type ViewMode = 'grid' | 'network' | 'queue' | 'sprints' | 'performance' | 'usage'

export function MonitorView() {
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const { loadSession, setAgent } = useChatStore()

  const handleAgentSelect = (agentName: string | null) => {
    setSelectedAgent(agentName === selectedAgent ? null : agentName)
    if (agentName) {
      setAgent(agentName)
    }
  }

  const handleSessionSelect = async (sessionId: string) => {
    await loadSession(sessionId)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--bg-primary)]">
      {/* State Banner with View Toggle */}
      <div className="flex items-center justify-between border-b border-[var(--border)]">
        <StateBanner />

        {/* View Toggle */}
        <div className="flex items-center gap-1 px-3 py-2">
          <button
            onClick={() => setViewMode('grid')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              viewMode === 'grid'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-tertiary)]'
            }`}
            title="Grid View"
          >
            <LayoutGrid size={14} />
            Grid
          </button>
          <button
            onClick={() => setViewMode('network')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              viewMode === 'network'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-tertiary)]'
            }`}
            title="Network View"
          >
            <Network size={14} />
            Network
          </button>
          <button
            onClick={() => setViewMode('queue')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              viewMode === 'queue'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-tertiary)]'
            }`}
            title="Task Queue"
          >
            <ListTodo size={14} />
            Queue
          </button>
          <button
            onClick={() => setViewMode('sprints')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              viewMode === 'sprints'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-tertiary)]'
            }`}
            title="Sprint Planning"
          >
            <Target size={14} />
            Sprints
          </button>
          <button
            onClick={() => setViewMode('performance')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              viewMode === 'performance'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-tertiary)]'
            }`}
            title="Agent Performance"
          >
            <BarChart3 size={14} />
            Perf
          </button>
          <button
            onClick={() => setViewMode('usage')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              viewMode === 'usage'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-tertiary)]'
            }`}
            title="Usage Analytics"
          >
            <TrendingUp size={14} />
            Usage
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {viewMode === 'grid' && (
          <>
            {/* Agent Grid */}
            <AgentGrid
              onAgentSelect={handleAgentSelect}
              selectedAgent={selectedAgent}
            />

            {/* Activity Feed */}
            <ActivityFeed />

            {/* Sessions List */}
            <SessionsList
              agentName={selectedAgent}
              onSelectSession={handleSessionSelect}
            />
          </>
        )}

        {viewMode === 'network' && (
          <>
            {/* Network View - takes most of the space */}
            <div className="flex-1 min-h-[300px]">
              <TeamNetworkView
                onAgentSelect={handleAgentSelect}
                selectedAgent={selectedAgent}
              />
            </div>

            {/* Activity Feed (smaller) */}
            <div className="h-[150px] border-t border-[var(--border)]">
              <ActivityFeed />
            </div>
          </>
        )}

        {viewMode === 'queue' && (
          <TaskQueue />
        )}

        {viewMode === 'sprints' && (
          <SprintPlanning />
        )}

        {viewMode === 'performance' && (
          <AgentPerformance />
        )}

        {viewMode === 'usage' && (
          <UsageAnalytics />
        )}
      </div>
    </div>
  )
}
