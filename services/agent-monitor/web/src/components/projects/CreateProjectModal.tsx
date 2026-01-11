import { useState } from 'react'
import { X, FolderPlus, FolderOpen, FolderGit } from 'lucide-react'
import { PathSelector } from '../common/PathSelector'

interface CreateProjectModalProps {
  onClose: () => void
  onCreate: (name: string, path: string, description: string, initGit: boolean) => Promise<void>
}

export function CreateProjectModal({ onClose, onCreate }: CreateProjectModalProps) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [description, setDescription] = useState('')
  const [isGitRepo, setIsGitRepo] = useState(false)
  const [initGit, setInitGit] = useState(true)  // Default to true for new folders
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPathSelector, setShowPathSelector] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !path.trim()) {
      setError('Name and path are required')
      return
    }

    // If not a git repo and user didn't check init_git, show error
    if (!isGitRepo && !initGit) {
      setError('Please enable "Initialize git repository" or select a git repository')
      return
    }

    setLoading(true)
    setError('')

    try {
      await onCreate(name.trim(), path.trim(), description.trim(), !isGitRepo && initGit)
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
              <div className="flex-1 px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-sm truncate flex items-center gap-2">
                {path ? (
                  <>
                    {isGitRepo && <FolderGit size={14} className="text-orange-400 flex-shrink-0" />}
                    <span className="truncate">{path}</span>
                  </>
                ) : (
                  <span className="text-[var(--text-secondary)]">No directory selected</span>
                )}
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
            {path && !isGitRepo && (
              <div className="mt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={initGit}
                    onChange={(e) => setInitGit(e.target.checked)}
                    className="w-4 h-4 rounded border-[var(--border)] bg-[var(--bg-tertiary)]"
                  />
                  <span className="text-sm">Initialize git repository</span>
                </label>
                <p className="text-xs text-[var(--text-secondary)] mt-1 ml-6">
                  This folder is not a git repository. Enable to run `git init`.
                </p>
              </div>
            )}
            {path && isGitRepo && (
              <p className="text-xs text-green-400 mt-1 flex items-center gap-1">
                <FolderGit size={12} />
                Git repository detected
              </p>
            )}
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
            onChange={(selectedPath, gitRepo) => {
              setPath(selectedPath)
              setIsGitRepo(gitRepo)
              // Auto-fill name from directory name if empty
              if (!name.trim()) {
                const dirName = selectedPath.split('/').pop() || ''
                setName(dirName)
              }
            }}
            onClose={() => setShowPathSelector(false)}
            requireGitRepo={false}
          />
        )}
      </div>
    </div>
  )
}
