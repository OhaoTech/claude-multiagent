import { useState, useEffect } from 'react'
import { Folder, X, Check, ChevronRight, ArrowLeft, FolderOpen } from 'lucide-react'

interface ModuleInfo {
  name: string
  path: string
  relative_path: string
}

interface DomainSelectorProps {
  projectId: string
  value: string
  onChange: (domain: string) => void
  onClose: () => void
}

export function DomainSelector({ projectId, value, onChange, onClose }: DomainSelectorProps) {
  const [modules, setModules] = useState<ModuleInfo[]>([])
  const [selectedDomain, setSelectedDomain] = useState(value)
  const [currentPath, setCurrentPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchModules = async (subpath: string) => {
    setLoading(true)
    setError('')
    try {
      const params = subpath ? `?subpath=${encodeURIComponent(subpath)}` : ''
      const res = await fetch(`/api/projects/${projectId}/modules${params}`)
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to load modules')
      }
      const data = await res.json()
      setModules(data.modules)
      setCurrentPath(data.current_path || '')
    } catch (err: any) {
      setError(err.message || 'Failed to load modules')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchModules('')
  }, [projectId])

  const handleNavigateInto = (relativePath: string) => {
    fetchModules(relativePath)
  }

  const handleNavigateBack = () => {
    if (!currentPath) return
    const parts = currentPath.split('/')
    parts.pop()
    const parentPath = parts.join('/')
    fetchModules(parentPath)
  }

  const handleSelectFolder = (relativePath: string) => {
    setSelectedDomain(relativePath)
  }

  const handleConfirm = () => {
    onChange(selectedDomain)
    onClose()
  }

  // Use current path as selection if user wants to select the current folder
  const handleSelectCurrentFolder = () => {
    if (currentPath) {
      setSelectedDomain(currentPath)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className="bg-[var(--bg-secondary)] rounded-lg w-[500px] max-w-[95vw] max-h-[70vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold">Select Module/Domain</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Breadcrumb / Current Path */}
        <div className="px-4 py-2 border-b border-[var(--border)] flex items-center gap-2 text-sm">
          {currentPath ? (
            <>
              <button
                onClick={handleNavigateBack}
                className="flex items-center gap-1 px-2 py-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors text-[var(--text-secondary)]"
              >
                <ArrowLeft size={16} />
                Back
              </button>
              <span className="text-[var(--text-secondary)]">/</span>
              <span className="text-[var(--accent)] font-medium truncate">{currentPath}</span>
              <button
                onClick={handleSelectCurrentFolder}
                className="ml-auto flex items-center gap-1 px-2 py-1 bg-[var(--accent)]/20 hover:bg-[var(--accent)]/30 rounded text-[var(--accent)] text-xs"
                title="Select this folder"
              >
                <FolderOpen size={14} />
                Select this folder
              </button>
            </>
          ) : (
            <span className="text-[var(--text-secondary)]">Project root</span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-red-900/30 text-red-200 text-sm">
            {error}
          </div>
        )}

        {/* Module List */}
        <div className="flex-1 overflow-y-auto p-2 min-h-[200px]">
          {loading ? (
            <div className="text-center py-8 text-[var(--text-secondary)]">Loading...</div>
          ) : modules.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-secondary)]">
              No subdirectories in this folder
            </div>
          ) : (
            <div className="space-y-0.5">
              {modules.map((module) => (
                <div
                  key={module.path}
                  className={`flex items-center gap-2 rounded transition-colors ${
                    selectedDomain === module.relative_path
                      ? 'bg-[var(--accent)]/20 border border-[var(--accent)]'
                      : 'hover:bg-[var(--bg-tertiary)]'
                  }`}
                >
                  {/* Select button */}
                  <button
                    onClick={() => handleSelectFolder(module.relative_path)}
                    className="flex-1 flex items-center gap-3 px-3 py-2.5 text-left min-w-0"
                  >
                    <Folder size={18} className="text-yellow-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{module.name}</div>
                      <div className="text-xs text-[var(--text-secondary)] truncate">
                        {module.relative_path}
                      </div>
                    </div>
                    {selectedDomain === module.relative_path && (
                      <Check size={16} className="text-[var(--accent)] flex-shrink-0" />
                    )}
                  </button>
                  {/* Navigate into button */}
                  <button
                    onClick={() => handleNavigateInto(module.relative_path)}
                    className="p-2 hover:bg-[var(--bg-tertiary)] rounded transition-colors text-[var(--text-secondary)] hover:text-white"
                    title="Open folder"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border)] flex items-center justify-between">
          <div className="text-sm text-[var(--text-secondary)] min-w-0 flex-1">
            {selectedDomain ? (
              <span className="truncate block">Selected: <code className="bg-[var(--bg-tertiary)] px-1 rounded">{selectedDomain}</code></span>
            ) : (
              <span>Click a folder to select, or use arrow to browse into it</span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selectedDomain}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:opacity-90 rounded text-sm font-medium disabled:opacity-50 transition-opacity"
            >
              <Check size={16} />
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
