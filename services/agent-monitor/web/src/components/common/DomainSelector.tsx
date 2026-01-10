import { useState, useEffect } from 'react'
import { Folder, X, Check } from 'lucide-react'

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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const fetchModules = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`/api/projects/${projectId}/modules`)
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.detail || 'Failed to load modules')
        }
        const data = await res.json()
        setModules(data.modules)
      } catch (err: any) {
        setError(err.message || 'Failed to load modules')
      } finally {
        setLoading(false)
      }
    }

    fetchModules()
  }, [projectId])

  const handleConfirm = () => {
    onChange(selectedDomain)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
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

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-red-900/30 text-red-200 text-sm">
            {error}
          </div>
        )}

        {/* Module List */}
        <div className="flex-1 overflow-y-auto p-2 min-h-[200px]">
          {loading ? (
            <div className="text-center py-8 text-[var(--text-secondary)]">Loading modules...</div>
          ) : modules.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-secondary)]">
              No subdirectories found in project
            </div>
          ) : (
            <div className="space-y-0.5">
              {modules.map((module) => (
                <button
                  key={module.path}
                  onClick={() => setSelectedDomain(module.relative_path)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded transition-colors text-left ${
                    selectedDomain === module.relative_path
                      ? 'bg-[var(--accent)]/20 border border-[var(--accent)]'
                      : 'hover:bg-[var(--bg-tertiary)]'
                  }`}
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
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border)] flex items-center justify-between">
          <div className="text-sm text-[var(--text-secondary)]">
            {selectedDomain ? (
              <span>Selected: <code className="bg-[var(--bg-tertiary)] px-1 rounded">{selectedDomain}</code></span>
            ) : (
              <span>Select a module folder for this agent</span>
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
