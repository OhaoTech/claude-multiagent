import { useState, useRef, useEffect } from 'react'
import { Crown, Play, Pause, AlertCircle, Trash2, Pencil } from 'lucide-react'
import type { AgentState } from '../../stores/wsStore'

interface AgentCardProps {
  agent: AgentState
  isSelected: boolean
  onClick: () => void
  onSetLeader?: () => void
  onRemove?: (removeWorktree: boolean) => void
  onUpdateNickname?: (nickname: string) => void
}

const statusColors = {
  idle: 'border-gray-500',
  running: 'border-green-500 animate-pulse',
  waiting: 'border-yellow-500',
  error: 'border-red-500',
}

const statusIcons = {
  idle: Pause,
  running: Play,
  waiting: Pause,
  error: AlertCircle,
}

export function AgentCard({ agent, isSelected, onClick, onSetLeader, onRemove, onUpdateNickname }: AgentCardProps) {
  const StatusIcon = statusIcons[agent.state] || Pause
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [showRemoveDialog, setShowRemoveDialog] = useState(false)
  const [showNicknameDialog, setShowNicknameDialog] = useState(false)
  const [removeWorktree, setRemoveWorktree] = useState(true)
  const [nicknameInput, setNicknameInput] = useState(agent.nickname || '')
  const menuRef = useRef<HTMLDivElement>(null)

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [contextMenu])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleSetLeader = () => {
    setContextMenu(null)
    onSetLeader?.()
  }

  const handleRemoveClick = () => {
    setContextMenu(null)
    setShowRemoveDialog(true)
  }

  const handleConfirmRemove = () => {
    setShowRemoveDialog(false)
    onRemove?.(removeWorktree)
  }

  const handleNicknameClick = () => {
    setContextMenu(null)
    setNicknameInput(agent.nickname || '')
    setShowNicknameDialog(true)
  }

  const handleSaveNickname = () => {
    setShowNicknameDialog(false)
    onUpdateNickname?.(nicknameInput.trim())
  }

  return (
    <>
      <button
        onClick={onClick}
        onContextMenu={handleContextMenu}
        className={`p-4 rounded-lg border-2 transition-all text-left ${statusColors[agent.state]} ${
          isSelected ? 'bg-[var(--accent)]/20 ring-2 ring-[var(--accent)]' : 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="flex flex-col">
              <span className="font-semibold">
                {agent.nickname || agent.agent}
              </span>
              {agent.nickname && (
                <span className="text-[10px] text-[var(--text-secondary)]">
                  {agent.agent}
                </span>
              )}
            </div>
            {agent.is_leader && (
              <Crown size={14} className="text-yellow-500" />
            )}
          </div>
          <StatusIcon
            size={16}
            className={agent.state === 'running' ? 'text-green-500' : 'text-[var(--text-secondary)]'}
          />
        </div>

        <div className="text-xs text-[var(--text-secondary)] space-y-1">
          <div className="flex justify-between">
            <span>Status</span>
            <span className={`capitalize ${agent.state === 'running' ? 'text-green-400' : ''}`}>
              {agent.state}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Runs</span>
            <span>{agent.run_count || 0}</span>
          </div>
          {agent.current_task && (
            <div className="mt-2 truncate text-[var(--text-primary)]">
              {agent.current_task}
            </div>
          )}
        </div>
      </button>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {!onSetLeader && !onRemove ? (
            <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">
              Agent not registered in DB
            </div>
          ) : (
            <>
              {!agent.is_leader && onSetLeader && (
                <button
                  onClick={handleSetLeader}
                  className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  <Crown size={14} className="text-yellow-500" />
                  Set as Leader
                </button>
              )}
              {agent.is_leader && (
                <div className="px-3 py-2 text-sm text-[var(--text-secondary)] flex items-center gap-2">
                  <Crown size={14} className="text-yellow-500" />
                  Current Leader
                </div>
              )}
              {onUpdateNickname && (
                <button
                  onClick={handleNicknameClick}
                  className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  <Pencil size={14} />
                  {agent.nickname ? 'Edit Nickname' : 'Set Nickname'}
                </button>
              )}
              <div className="border-t border-[var(--border)] my-1" />
              <button
                onClick={handleRemoveClick}
                disabled={agent.is_leader || !onRemove}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                  agent.is_leader || !onRemove
                    ? 'text-[var(--text-secondary)] cursor-not-allowed'
                    : 'text-red-400 hover:bg-red-900/20'
                }`}
              >
                <Trash2 size={14} />
                Remove Agent
              </button>
            </>
          )}
        </div>
      )}

      {/* Remove Confirmation Dialog */}
      {showRemoveDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-secondary)] rounded-lg w-[400px] p-4">
            <h3 className="text-lg font-semibold mb-3">Remove Agent</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Are you sure you want to remove <strong>{agent.agent}</strong>?
            </p>

            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={removeWorktree}
                onChange={(e) => setRemoveWorktree(e.target.checked)}
                className="w-4 h-4 rounded border-[var(--border)] bg-[var(--bg-tertiary)]"
              />
              <span className="text-sm">Also remove git worktree</span>
            </label>

            {!removeWorktree && (
              <p className="text-xs text-yellow-500 mb-4">
                The worktree will remain on disk and can be re-imported later.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowRemoveDialog(false)}
                className="px-4 py-2 text-sm hover:bg-[var(--bg-tertiary)] rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRemove}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-medium transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Nickname Edit Dialog */}
      {showNicknameDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-secondary)] rounded-lg w-[350px] p-4">
            <h3 className="text-lg font-semibold mb-3">Set Nickname</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Give <strong>{agent.agent}</strong> a friendly name (display only)
            </p>

            <input
              type="text"
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              placeholder="Enter nickname..."
              className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveNickname()
                if (e.key === 'Escape') setShowNicknameDialog(false)
              }}
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNicknameDialog(false)}
                className="px-4 py-2 text-sm hover:bg-[var(--bg-tertiary)] rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNickname}
                className="px-4 py-2 bg-[var(--accent)] hover:opacity-90 rounded text-sm font-medium transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
