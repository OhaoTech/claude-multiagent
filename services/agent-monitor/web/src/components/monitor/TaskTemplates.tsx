import { useEffect, useState } from 'react'
import {
  Plus,
  FileText,
  Play,
  Trash2,
  Edit3,
  X,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'

interface TaskTemplate {
  id: string
  project_id: string
  name: string
  title: string
  description: string | null
  priority: number
  agent_id: string | null
  created_at: string
  updated_at: string
}

interface TaskTemplatesProps {
  onTaskCreated?: () => void
  sprintId?: string | null
}

export function TaskTemplates({ onTaskCreated, sprintId }: TaskTemplatesProps) {
  const { activeProject } = useProjectStore()
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null)
  const [creating, setCreating] = useState<string | null>(null)

  const projectId = activeProject?.id

  const fetchTemplates = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/templates`)
      if (res.ok) {
        setTemplates(await res.json())
      }
    } catch (err) {
      console.error('Failed to fetch templates:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTemplates()
  }, [projectId])

  const createTaskFromTemplate = async (templateId: string) => {
    if (!projectId) return
    setCreating(templateId)
    try {
      const res = await fetch(`/api/projects/${projectId}/templates/${templateId}/create-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sprint_id: sprintId || null })
      })
      if (res.ok) {
        onTaskCreated?.()
      }
    } catch (err) {
      console.error('Failed to create task from template:', err)
    } finally {
      setCreating(null)
    }
  }

  const deleteTemplate = async (templateId: string) => {
    if (!projectId) return
    if (!confirm('Delete this template?')) return
    try {
      await fetch(`/api/projects/${projectId}/templates/${templateId}`, {
        method: 'DELETE'
      })
      fetchTemplates()
    } catch (err) {
      console.error('Failed to delete template:', err)
    }
  }

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 3: return 'text-red-400'
      case 2: return 'text-orange-400'
      case 1: return 'text-yellow-400'
      default: return 'text-gray-400'
    }
  }

  const getPriorityLabel = (priority: number) => {
    switch (priority) {
      case 3: return 'Urgent'
      case 2: return 'High'
      case 1: return 'Normal'
      default: return 'Low'
    }
  }

  return (
    <div className="border-b border-[var(--border)]">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-[var(--bg-tertiary)] transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <FileText size={16} className="text-purple-400" />
          <span className="font-medium text-sm">Task Templates</span>
          <span className="text-xs text-[var(--text-secondary)]">({templates.length})</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowCreateModal(true)
          }}
          className="p-1 hover:bg-[var(--bg-primary)] rounded"
          title="Create Template"
        >
          <Plus size={16} />
        </button>
      </button>

      {/* Template List */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {loading ? (
            <div className="text-center text-[var(--text-secondary)] text-xs py-2">
              Loading templates...
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center text-[var(--text-secondary)] text-xs py-4">
              No templates. Create one to quickly add common tasks.
            </div>
          ) : (
            templates.map(template => (
              <div
                key={template.id}
                className="bg-[var(--bg-tertiary)] rounded p-2 group"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{template.name}</span>
                      <span className={`text-xs ${getPriorityColor(template.priority)}`}>
                        {getPriorityLabel(template.priority)}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] truncate mt-0.5">
                      {template.title}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => createTaskFromTemplate(template.id)}
                      disabled={creating === template.id}
                      className="p-1 hover:bg-green-900/30 rounded text-green-400"
                      title="Create task from template"
                    >
                      {creating === template.id ? (
                        <span className="animate-spin">...</span>
                      ) : (
                        <Play size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => setEditingTemplate(template)}
                      className="p-1 hover:bg-blue-900/30 rounded text-blue-400"
                      title="Edit template"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => deleteTemplate(template.id)}
                      className="p-1 hover:bg-red-900/30 rounded text-red-400"
                      title="Delete template"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      {(showCreateModal || editingTemplate) && (
        <TemplateModal
          projectId={projectId!}
          template={editingTemplate}
          onClose={() => {
            setShowCreateModal(false)
            setEditingTemplate(null)
          }}
          onSaved={() => {
            setShowCreateModal(false)
            setEditingTemplate(null)
            fetchTemplates()
          }}
        />
      )}
    </div>
  )
}

function TemplateModal({
  projectId,
  template,
  onClose,
  onSaved
}: {
  projectId: string
  template: TaskTemplate | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(template?.name || '')
  const [title, setTitle] = useState(template?.title || '')
  const [description, setDescription] = useState(template?.description || '')
  const [priority, setPriority] = useState(template?.priority || 1)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim() || !title.trim()) return
    setSaving(true)
    try {
      const url = template
        ? `/api/projects/${projectId}/templates/${template.id}`
        : `/api/projects/${projectId}/templates`
      const method = template ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          title: title.trim(),
          description: description.trim() || null,
          priority
        })
      })

      if (res.ok) {
        onSaved()
      }
    } catch (err) {
      console.error('Failed to save template:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-secondary)] rounded-lg p-4 w-96 max-w-[90vw]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">
            {template ? 'Edit Template' : 'Create Template'}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-[var(--bg-tertiary)] rounded">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">
              Template Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Bug Fix, Feature Request"
              className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-sm"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">
              Task Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Fix bug in..."
              className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional details..."
              rows={3}
              className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-sm resize-none"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">
              Priority
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-sm"
            >
              <option value={0}>Low</option>
              <option value={1}>Normal</option>
              <option value={2}>High</option>
              <option value={3}>Urgent</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm hover:bg-[var(--bg-tertiary)] rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || !title.trim()}
            className="px-3 py-1.5 text-sm bg-[var(--accent)] hover:bg-blue-600 rounded disabled:opacity-50"
          >
            {saving ? 'Saving...' : template ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
