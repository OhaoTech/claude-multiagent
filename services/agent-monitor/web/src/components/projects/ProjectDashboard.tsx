import { useState, useEffect } from 'react'
import { Plus, FolderOpen, FolderInput } from 'lucide-react'
import { ProjectCard } from './ProjectCard'
import { CreateProjectModal } from './CreateProjectModal'
import { PathSelector } from '../common/PathSelector'
import { useProjectStore } from '../../stores/projectStore'

interface ProjectDashboardProps {
  onEnterProject: (projectId: string) => void
}

export function ProjectDashboard({ onEnterProject }: ProjectDashboardProps) {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showOpenExisting, setShowOpenExisting] = useState(false)
  const [agentCounts, setAgentCounts] = useState<Record<string, number>>({})

  const { projects, fetchProjects, createProject, deleteProject, loading } = useProjectStore()

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  // Fetch agent counts for each project
  useEffect(() => {
    const fetchAgentCounts = async () => {
      const counts: Record<string, number> = {}
      for (const project of projects) {
        try {
          const res = await fetch(`/api/projects/${project.id}/agents`)
          const agents = await res.json()
          counts[project.id] = agents.length
        } catch {
          counts[project.id] = 0
        }
      }
      setAgentCounts(counts)
    }

    if (projects.length > 0) {
      fetchAgentCounts()
    }
  }, [projects])

  const handleCreateProject = async (name: string, path: string, description: string, initGit: boolean) => {
    const project = await createProject(name, path, description, initGit)
    onEnterProject(project.id)
  }

  const handleDeleteProject = async (projectId: string) => {
    if (confirm('Are you sure you want to delete this project? This will not delete any files.')) {
      await deleteProject(projectId)
    }
  }

  const handleOpenExisting = async (path: string, isGitRepo: boolean) => {
    const dirName = path.split('/').pop() || 'project'
    try {
      // For "open existing", init git if it's not already a repo
      const project = await createProject(dirName, path, '', !isGitRepo)
      setShowOpenExisting(false)
      onEnterProject(project.id)
    } catch (err: any) {
      alert(err.message || 'Failed to open project')
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header */}
      <header className="h-14 bg-[var(--bg-secondary)] border-b border-[var(--border)] flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <FolderOpen size={24} className="text-[var(--accent)]" />
          <h1 className="text-xl font-semibold">Claude Code IDE</h1>
        </div>
        <div className="text-sm text-[var(--text-secondary)]">
          {projects.length} project{projects.length !== 1 ? 's' : ''}
        </div>
      </header>

      {/* Main content */}
      <main className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Projects</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowOpenExisting(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] border border-[var(--border)] rounded font-medium transition-colors"
            >
              <FolderInput size={18} />
              Open Existing
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:opacity-90 rounded font-medium transition-opacity"
            >
              <Plus size={18} />
              New Project
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-[var(--text-secondary)]">
            Loading projects...
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12">
            <FolderOpen size={48} className="mx-auto mb-4 text-[var(--text-secondary)]" />
            <h3 className="text-lg font-medium mb-2">No projects yet</h3>
            <p className="text-[var(--text-secondary)] mb-4">
              Create a new project to get started
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-[var(--accent)] hover:opacity-90 rounded font-medium transition-opacity"
            >
              Create Your First Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                agentCount={agentCounts[project.id] || 0}
                onEnter={() => onEnterProject(project.id)}
                onDelete={() => handleDeleteProject(project.id)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Create modal */}
      {showCreateModal && (
        <CreateProjectModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateProject}
        />
      )}

      {/* Open existing modal */}
      {showOpenExisting && (
        <PathSelector
          value=""
          onChange={handleOpenExisting}
          onClose={() => setShowOpenExisting(false)}
          requireGitRepo={false}
        />
      )}
    </div>
  )
}
