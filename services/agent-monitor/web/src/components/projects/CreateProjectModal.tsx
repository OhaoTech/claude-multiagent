import { useState } from 'react'
import { X, FolderPlus, FolderOpen } from 'lucide-react'
import { PathSelector } from '../common/PathSelector'

interface CreateProjectModalProps {
  onClose: () => void
  onCreate: (name: string, path: string, description: string) => Promise<void>
}

export function CreateProjectModal({ onClose, onCreate }: CreateProjectModalProps) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPathSelector, setShowPathSelector] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !path.trim()) {
      setError('Name and path are required')
      return
    }

    setLoading(true)
    setError('')

    try {
      await onCreate(name.trim(), path.trim(), description.trim())
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-secondary)] rounded-lg w-[500px] max-w-[90vw]">
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <FolderPlus size={20} className="text-[var(--accent)]" />
            <h2 className="text-lg font-semibold">New Project</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-800 rounded text-red-200 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Project Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-project"
              className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded focus:outline-none focus:border-[var(--accent)]"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Project Path</label>
            <div className="flex gap-2">
              <div className="flex-1 px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-sm truncate">
                {path || <span className="text-[var(--text-secondary)]">No directory selected</span>}
              </div>
              <button
                type="button"
                onClick={() => setShowPathSelector(true)}
                className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded hover:bg-[var(--bg-secondary)] transition-colors"
              >
                <FolderOpen size={16} />
                Browse
              </button>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Select a directory with a git repository
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
              rows={2}
              className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded focus:outline-none focus:border-[var(--accent)] resize-none"
            />
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
              disabled={loading || !name.trim() || !path.trim()}
              className="px-4 py-2 bg-[var(--accent)] hover:opacity-90 rounded text-sm font-medium disabled:opacity-50 transition-opacity"
            >
              {loading ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>

        {/* Path Selector Modal */}
        {showPathSelector && (
          <PathSelector
            value={path}
            onChange={(selectedPath) => {
              setPath(selectedPath)
              // Auto-fill name from directory name if empty
              if (!name.trim()) {
                const dirName = selectedPath.split('/').pop() || ''
                setName(dirName)
              }
            }}
            onClose={() => setShowPathSelector(false)}
            requireGitRepo={true}
          />
        )}
      </div>
    </div>
  )
}
