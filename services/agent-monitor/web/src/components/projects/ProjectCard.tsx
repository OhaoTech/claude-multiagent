import { FolderOpen, Users, Trash2 } from 'lucide-react'
import type { Project } from '../../types'

interface ProjectCardProps {
  project: Project
  agentCount: number
  onEnter: () => void
  onDelete?: () => void
}

export function ProjectCard({ project, agentCount, onEnter, onDelete }: ProjectCardProps) {
  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4 hover:border-[var(--accent)] transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <FolderOpen size={20} className="text-yellow-500" />
          <h3 className="font-semibold text-lg">{project.name}</h3>
        </div>
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="p-1 text-[var(--text-secondary)] hover:text-red-400 transition-colors"
            title="Delete project"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <p className="text-xs text-[var(--text-secondary)] truncate mb-2" title={project.root_path}>
        {project.root_path}
      </p>

      {project.description && (
        <p className="text-sm text-[var(--text-secondary)] mb-3 line-clamp-2">
          {project.description}
        </p>
      )}

      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-1 text-sm text-[var(--text-secondary)]">
          <Users size={14} />
          <span>{agentCount} agent{agentCount !== 1 ? 's' : ''}</span>
        </div>

        <button
          onClick={onEnter}
          className="px-4 py-1.5 bg-[var(--accent)] hover:opacity-90 rounded text-sm font-medium transition-opacity"
        >
          Enter IDE
        </button>
      </div>
    </div>
  )
}
