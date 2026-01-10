import { useState, useEffect } from 'react'
import { Package, Check, Download, Trash2, X, RefreshCw } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'

interface Skill {
  id: string
  name: string
  description: string
  path: string
  installed?: boolean
}

interface SkillsData {
  installed: Skill[]
  available: Skill[]
}

export function SkillsPanel({ onClose }: { onClose: () => void }) {
  const { activeProject } = useProjectStore()
  const [skills, setSkills] = useState<SkillsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState('')

  const fetchSkills = async () => {
    if (!activeProject) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/projects/${activeProject.id}/skills`)
      if (!res.ok) throw new Error('Failed to load skills')
      const data = await res.json()
      setSkills(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSkills()
  }, [activeProject?.id])

  const handleInstall = async (skillId: string) => {
    if (!activeProject) return
    setActionLoading(skillId)
    try {
      const res = await fetch(`/api/projects/${activeProject.id}/skills/${skillId}`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to install')
      }
      await fetchSkills()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const handleUninstall = async (skillId: string) => {
    if (!activeProject) return
    setActionLoading(skillId)
    try {
      const res = await fetch(`/api/projects/${activeProject.id}/skills/${skillId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to uninstall')
      }
      await fetchSkills()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const installedIds = new Set(skills?.installed.map(s => s.id) || [])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-secondary)] rounded-lg w-[600px] max-w-[95vw] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Package size={20} className="text-[var(--accent)]" />
            <h2 className="text-lg font-semibold">Skills</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchSkills}
              className="p-2 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
              title="Refresh"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-red-900/30 text-red-200 text-sm">
            {error}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center py-8 text-[var(--text-secondary)]">
              Loading skills...
            </div>
          ) : !skills ? (
            <div className="text-center py-8 text-[var(--text-secondary)]">
              No skills data
            </div>
          ) : (
            <div className="space-y-6">
              {/* Installed Skills */}
              <div>
                <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3 flex items-center gap-2">
                  <Check size={14} />
                  Installed ({skills.installed.length})
                </h3>
                {skills.installed.length === 0 ? (
                  <div className="text-sm text-[var(--text-secondary)] italic">
                    No skills installed
                  </div>
                ) : (
                  <div className="space-y-2">
                    {skills.installed.map(skill => (
                      <div
                        key={skill.id}
                        className="flex items-center gap-3 p-3 bg-[var(--bg-tertiary)] rounded-lg"
                      >
                        <Package size={18} className="text-green-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{skill.name}</div>
                          <div className="text-xs text-[var(--text-secondary)] truncate">
                            {skill.description}
                          </div>
                        </div>
                        <button
                          onClick={() => handleUninstall(skill.id)}
                          disabled={actionLoading === skill.id}
                          className="p-2 hover:bg-red-900/30 text-red-400 rounded transition-colors disabled:opacity-50"
                          title="Uninstall"
                        >
                          {actionLoading === skill.id ? (
                            <RefreshCw size={16} className="animate-spin" />
                          ) : (
                            <Trash2 size={16} />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Available Skills */}
              <div>
                <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3 flex items-center gap-2">
                  <Download size={14} />
                  Available
                </h3>
                <div className="space-y-2">
                  {skills.available.filter(s => !installedIds.has(s.id)).length === 0 ? (
                    <div className="text-sm text-[var(--text-secondary)] italic">
                      All skills are installed
                    </div>
                  ) : (
                    skills.available
                      .filter(s => !installedIds.has(s.id))
                      .map(skill => (
                        <div
                          key={skill.id}
                          className="flex items-center gap-3 p-3 bg-[var(--bg-tertiary)] rounded-lg"
                        >
                          <Package size={18} className="text-[var(--text-secondary)] flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{skill.name}</div>
                            <div className="text-xs text-[var(--text-secondary)] truncate">
                              {skill.description}
                            </div>
                          </div>
                          <button
                            onClick={() => handleInstall(skill.id)}
                            disabled={actionLoading === skill.id}
                            className="flex items-center gap-1 px-3 py-1.5 bg-[var(--accent)] hover:opacity-90 rounded text-sm font-medium disabled:opacity-50 transition-opacity"
                          >
                            {actionLoading === skill.id ? (
                              <RefreshCw size={14} className="animate-spin" />
                            ) : (
                              <>
                                <Download size={14} />
                                Install
                              </>
                            )}
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border)] text-xs text-[var(--text-secondary)]">
          Skills are installed to <code className="bg-[var(--bg-tertiary)] px-1 rounded">.claude/skills/</code> in your project
        </div>
      </div>
    </div>
  )
}
