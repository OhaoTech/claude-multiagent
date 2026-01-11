import { useState, useEffect } from 'react'
import { Folder, FolderGit, ChevronUp, X, Check, Home, Eye, EyeOff, FolderPlus } from 'lucide-react'

interface DirectoryInfo {
  name: string
  path: string
  is_git_repo: boolean
}

interface BrowseResponse {
  current_path: string
  parent: string | null
  directories: DirectoryInfo[]
  is_git_repo: boolean
}

interface PathSelectorProps {
  value: string
  onChange: (path: string, isGitRepo: boolean) => void
  onClose: () => void
  requireGitRepo?: boolean
}

export function PathSelector({ value, onChange, onClose, requireGitRepo: _requireGitRepo = true }: PathSelectorProps) {
  const [currentPath, setCurrentPath] = useState(value || '')
  const [directories, setDirectories] = useState<DirectoryInfo[]>([])
  const [parentPath, setParentPath] = useState<string | null>(null)
  const [isGitRepo, setIsGitRepo] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)

  const fetchDirectories = async (path?: string, hidden?: boolean) => {
    setLoading(true)
    setError('')
    try {
      const showHiddenParam = hidden ?? showHidden
      let url = path ? `/api/files/browse?path=${encodeURIComponent(path)}` : '/api/files/browse'
      url += `${path ? '&' : '?'}show_hidden=${showHiddenParam}`
      const res = await fetch(url)
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to browse directory')
      }
      const data: BrowseResponse = await res.json()
      setCurrentPath(data.current_path)
      setParentPath(data.parent)
      setDirectories(data.directories)
      setIsGitRepo(data.is_git_repo)
    } catch (err: any) {
      setError(err.message || 'Failed to browse directory')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDirectories(value || undefined)
  }, [])

  const handleToggleHidden = () => {
    const newShowHidden = !showHidden
    setShowHidden(newShowHidden)
    fetchDirectories(currentPath, newShowHidden)
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return

    setCreatingFolder(true)
    try {
      const newPath = `${currentPath}/${newFolderName.trim()}`
      const res = await fetch('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath, is_dir: true }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to create folder')
      }
      setShowNewFolderDialog(false)
      setNewFolderName('')
      // Refresh and navigate to new folder
      await fetchDirectories(newPath)
    } catch (err: any) {
      setError(err.message || 'Failed to create folder')
    } finally {
      setCreatingFolder(false)
    }
  }

  const handleSelect = (dir: DirectoryInfo) => {
    fetchDirectories(dir.path)
  }

  const handleGoUp = () => {
    if (parentPath) {
      fetchDirectories(parentPath)
    }
  }

  const handleGoHome = () => {
    fetchDirectories()
  }

  const handleConfirm = () => {
    onChange(currentPath, isGitRepo)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="relative bg-[var(--bg-secondary)] rounded-lg w-[600px] max-w-[95vw] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold">Select Directory</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Current Path */}
        <div className="px-4 py-2 bg-[var(--bg-tertiary)] border-b border-[var(--border)] flex items-center gap-2">
          <button
            onClick={handleGoHome}
            className="p-1.5 hover:bg-[var(--bg-secondary)] rounded transition-colors"
            title="Go to home directory"
          >
            <Home size={16} />
          </button>
          <button
            onClick={handleGoUp}
            disabled={!parentPath}
            className="p-1.5 hover:bg-[var(--bg-secondary)] rounded transition-colors disabled:opacity-50"
            title="Go up"
          >
            <ChevronUp size={16} />
          </button>
          <code className="text-sm flex-1 truncate text-[var(--text-secondary)]">
            {currentPath}
          </code>
          <button
            onClick={() => setShowNewFolderDialog(true)}
            className="p-1.5 hover:bg-[var(--bg-secondary)] rounded transition-colors"
            title="Create new folder"
          >
            <FolderPlus size={16} />
          </button>
          <button
            onClick={handleToggleHidden}
            className={`p-1.5 hover:bg-[var(--bg-secondary)] rounded transition-colors ${showHidden ? 'text-[var(--accent)]' : ''}`}
            title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
          >
            {showHidden ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-red-900/30 text-red-200 text-sm">
            {error}
          </div>
        )}

        {/* Directory List */}
        <div className="flex-1 overflow-y-auto p-2 min-h-[200px]">
          {loading ? (
            <div className="text-center py-8 text-[var(--text-secondary)]">Loading...</div>
          ) : directories.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-secondary)]">No subdirectories</div>
          ) : (
            <div className="space-y-0.5">
              {directories.map((dir) => (
                <button
                  key={dir.path}
                  onClick={() => handleSelect(dir)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                >
                  {dir.is_git_repo ? (
                    <FolderGit size={18} className="text-orange-400 flex-shrink-0" />
                  ) : (
                    <Folder size={18} className="text-yellow-500 flex-shrink-0" />
                  )}
                  <span className="truncate">{dir.name}</span>
                  {dir.is_git_repo && (
                    <span className="ml-auto text-xs text-orange-400 flex-shrink-0">git</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border)] flex items-center justify-between">
          <div className="text-sm">
            {isGitRepo ? (
              <span className="text-green-400 flex items-center gap-1">
                <FolderGit size={14} />
                Git repository
              </span>
            ) : (
              <span className="text-yellow-500">Not a git repository</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:opacity-90 rounded text-sm font-medium transition-opacity"
            >
              <Check size={16} />
              Select This Directory
            </button>
          </div>
        </div>

        {/* New Folder Dialog */}
        {showNewFolderDialog && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg">
            <div className="bg-[var(--bg-secondary)] rounded-lg w-[300px] p-4 border border-[var(--border)]">
              <h3 className="text-sm font-semibold mb-3">Create New Folder</h3>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name..."
                className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newFolderName.trim()) handleCreateFolder()
                  if (e.key === 'Escape') {
                    setShowNewFolderDialog(false)
                    setNewFolderName('')
                  }
                }}
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowNewFolderDialog(false)
                    setNewFolderName('')
                  }}
                  className="px-3 py-1.5 text-sm hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateFolder}
                  disabled={!newFolderName.trim() || creatingFolder}
                  className="px-3 py-1.5 bg-[var(--accent)] hover:opacity-90 rounded text-sm font-medium disabled:opacity-50 transition-opacity"
                >
                  {creatingFolder ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
