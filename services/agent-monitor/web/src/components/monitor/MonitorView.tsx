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
import { useIsMobile } from '../../hooks/useIsMobile'

type ViewMode = 'grid' | 'network' | 'queue' | 'sprints' | 'performance' | 'usage'

const VIEW_MODES: { mode: ViewMode; icon: typeof LayoutGrid; label: string }[] = [
  { mode: 'grid', icon: LayoutGrid, label: 'Grid' },
  { mode: 'network', icon: Network, label: 'Network' },
  { mode: 'queue', icon: ListTodo, label: 'Queue' },
  { mode: 'sprints', icon: Target, label: 'Sprints' },
  { mode: 'performance', icon: BarChart3, label: 'Perf' },
  { mode: 'usage', icon: TrendingUp, label: 'Usage' },
]

export function MonitorView() {
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const { loadSession, setAgent } = useChatStore()
  const isMobile = useIsMobile()

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
    <div className={`flex-1 flex flex-col bg-[var(--bg-primary)] ${isMobile ? 'overflow-y-auto' : 'overflow-hidden'}`}>
      {/* State Banner with View Toggle */}
      <div className={`flex items-center justify-between border-b border-[var(--border)] ${isMobile ? 'flex-col' : ''}`}>
        <StateBanner />

        {/* View Toggle - scrollable on mobile */}
        <div className={`flex items-center gap-1 px-2 py-2 ${isMobile ? 'w-full overflow-x-auto hide-scrollbar' : ''}`}>
          {VIEW_MODES.map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded text-xs sm:text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                viewMode === mode
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-tertiary)]'
              }`}
              title={label}
            >
              <Icon size={isMobile ? 16 : 14} />
              {!isMobile && label}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className={`flex-1 flex flex-col ${isMobile ? 'overflow-visible' : 'overflow-hidden'}`}>
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
