import { useState } from 'react'
import { AgentGrid } from './AgentGrid'
import { StateBanner } from './StateBanner'
import { ActivityFeed } from './ActivityFeed'
import { SessionsList } from './SessionsList'
import { useChatStore } from '../../stores/chatStore'

export function MonitorView() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const { loadSession, setAgent } = useChatStore()

  const handleAgentSelect = (agentName: string) => {
    setSelectedAgent(agentName === selectedAgent ? null : agentName)
    setAgent(agentName)
  }

  const handleSessionSelect = async (sessionId: string) => {
    await loadSession(sessionId)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--bg-primary)]">
      {/* State Banner */}
      <StateBanner />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
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
      </div>
    </div>
  )
}
