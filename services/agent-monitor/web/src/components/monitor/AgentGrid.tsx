import { useState } from 'react'
import { Plus, UserPlus, FolderOpen, RefreshCw } from 'lucide-react'
import { AgentCard } from './AgentCard'
import { DomainSelector } from '../common/DomainSelector'
import { useWsStore, type AgentState } from '../../stores/wsStore'
import { useProjectStore } from '../../stores/projectStore'

interface AgentGridProps {
  onAgentSelect: (agentName: string) => void
  selectedAgent: string | null
}

export function AgentGrid({ onAgentSelect, selectedAgent }: AgentGridProps) {
  const [showAddModal, setShowAddModal] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const { agentStates } = useWsStore()
  const { agents: dbAgents, activeProject, createAgent, syncWorktrees, setLeader, deleteAgent } = useProjectStore()

  const handleSyncWorktrees = async () => {
    if (!activeProject || syncing) return
    setSyncing(true)
    setSyncResult(null)
    try {
      const result = await syncWorktrees(activeProject.id)
      if (result.created > 0) {
        setSyncResult(`Imported ${result.created} worktree(s)`)
      } else {
        setSyncResult('No new worktrees found')
      }
      setTimeout(() => setSyncResult(null), 3000)
    } catch (err: any) {
      setSyncResult(err.message || 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  // Merge DB agents with real-time state
  const mergedAgents: (AgentState & { id?: string })[] = dbAgents.map((a) => ({
    id: a.id,
    agent: a.name,
    state: agentStates[a.name]?.state || 'idle',
    run_count: agentStates[a.name]?.run_count || 0,
    current_task: agentStates[a.name]?.current_task,
    is_leader: a.is_leader,
  }))

  // Add any agents from WS that aren't in DB (legacy support)
  // These won't have an id, so context menu actions will be disabled
  Object.values(agentStates).forEach((wsAgent) => {
    if (wsAgent.agent && !mergedAgents.find((a) => a.agent === wsAgent.agent)) {
      mergedAgents.push({ ...wsAgent, id: undefined })
    }
  })

  const handleAddAgent = async (name: string, domain: string) => {
    if (!activeProject) return
    await createAgent(activeProject.id, name, domain)
    setShowAddModal(false)
  }

  const handleSetLeader = async (agentId: string) => {
    if (!activeProject) return
    try {
      await setLeader(activeProject.id, agentId)
    } catch (err: any) {
      console.error('Failed to set leader:', err.message)
    }
  }

  const handleRemoveAgent = async (agentId: string, removeWorktree: boolean) => {
    if (!activeProject) return
    try {
      await deleteAgent(activeProject.id, agentId, removeWorktree)
    } catch (err: any) {
      console.error('Failed to remove agent:', err.message)
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">Agents</h3>
        <div className="flex items-center gap-2">
          {syncResult && (
            <span className="text-xs text-[var(--text-secondary)]">{syncResult}</span>
          )}
          <button
            onClick={handleSyncWorktrees}
            disabled={syncing || !activeProject}
            className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] rounded transition-colors disabled:opacity-50"
            title="Import existing git worktrees as agents"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            Sync Worktrees
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {mergedAgents.map((agent) => (
          <AgentCard
            key={agent.agent}
            agent={agent}
            isSelected={selectedAgent === agent.agent}
            onClick={() => onAgentSelect(agent.agent)}
            onSetLeader={agent.id ? () => handleSetLeader(agent.id!) : undefined}
            onRemove={agent.id ? (removeWorktree) => handleRemoveAgent(agent.id!, removeWorktree) : undefined}
          />
        ))}

        {/* Add Agent Card */}
        <button
          onClick={() => setShowAddModal(true)}
          className="p-4 rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[var(--accent)] transition-colors flex flex-col items-center justify-center gap-2 text-[var(--text-secondary)] hover:text-[var(--accent)]"
        >
          <Plus size={24} />
          <span className="text-sm">Add Agent</span>
        </button>
      </div>

      {showAddModal && activeProject && (
        <AddAgentModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddAgent}
          projectId={activeProject.id}
        />
      )}
    </div>
  )
}

function AddAgentModal({
  onClose,
  onAdd,
  projectId,
}: {
  onClose: () => void
  onAdd: (name: string, domain: string) => Promise<void>
  projectId: string
}) {
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [showDomainSelector, setShowDomainSelector] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!domain.trim()) {
      setError('Domain is required - select a module folder')
      return
    }

    setLoading(true)
    setError('')
    try {
      await onAdd(name.trim(), domain.trim())
    } catch (err: any) {
      setError(err.message || 'Failed to create agent')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-secondary)] rounded-lg w-[400px]">
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <UserPlus size={20} className="text-[var(--accent)]" />
            <h2 className="text-lg font-semibold">Add Agent</h2>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-white text-xl"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-800 rounded text-red-200 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Agent Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., api, frontend, mobile"
              className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded focus:outline-none focus:border-[var(--accent)]"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Domain Module</label>
            <div className="flex gap-2">
              <div className="flex-1 px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-sm truncate">
                {domain || <span className="text-[var(--text-secondary)]">No module selected</span>}
              </div>
              <button
                type="button"
                onClick={() => setShowDomainSelector(true)}
                className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded hover:bg-[var(--bg-secondary)] transition-colors"
              >
                <FolderOpen size={16} />
                Browse
              </button>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Select the module folder this agent will be responsible for
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim() || !domain.trim()}
              className="px-4 py-2 bg-[var(--accent)] hover:opacity-90 rounded text-sm font-medium disabled:opacity-50 transition-opacity"
            >
              {loading ? 'Creating...' : 'Add Agent'}
            </button>
          </div>
        </form>

        {/* Domain Selector Modal */}
        {showDomainSelector && (
          <DomainSelector
            projectId={projectId}
            value={domain}
            onChange={(selectedDomain) => {
              setDomain(selectedDomain)
              // Auto-fill name from domain if empty
              if (!name.trim()) {
                setName(selectedDomain)
              }
            }}
            onClose={() => setShowDomainSelector(false)}
          />
        )}
      </div>
    </div>
  )
}
