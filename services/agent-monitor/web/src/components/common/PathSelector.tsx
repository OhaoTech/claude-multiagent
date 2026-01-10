import { useState, useEffect } from 'react'
import { Folder, FolderGit, ChevronUp, X, Check, Home } from 'lucide-react'

interface DirectoryInfo {
  name: string
  path: string
  is_git_repo: boolean
}

interface BrowseResponse {
  current_path: string
  parent: string | null
  directories: DirectoryInfo[]
}

interface PathSelectorProps {
  value: string
  onChange: (path: string) => void
  onClose: () => void
  requireGitRepo?: boolean
}

export function PathSelector({ value, onChange, onClose, requireGitRepo = true }: PathSelectorProps) {
  const [currentPath, setCurrentPath] = useState(value || '')
  const [directories, setDirectories] = useState<DirectoryInfo[]>([])
  const [parentPath, setParentPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchDirectories = async (path?: string) => {
    setLoading(true)
    setError('')
    try {
      const url = path ? `/api/files/browse?path=${encodeURIComponent(path)}` : '/api/files/browse'
      const res = await fetch(url)
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to browse directory')
      }
      const data: BrowseResponse = await res.json()
      setCurrentPath(data.current_path)
      setParentPath(data.parent)
      setDirectories(data.directories)
    } catch (err: any) {
      setError(err.message || 'Failed to browse directory')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDirectories(value || undefined)
  }, [])

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
    onChange(currentPath)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-secondary)] rounded-lg w-[600px] max-w-[95vw] max-h-[80vh] flex flex-col">
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
          <div className="text-sm text-[var(--text-secondary)]">
            {requireGitRepo && (
              <span>Select a directory with a git repository</span>
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
      </div>
    </div>
  )
}
