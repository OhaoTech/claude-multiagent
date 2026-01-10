import { Settings, ArrowLeft, Monitor, Code2 } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { useWsStore } from '../../stores/wsStore'

interface HeaderProps {
  onSettingsClick: () => void
  onBackClick: () => void
  activeTab: 'monitor' | 'editor'
  onTabChange: (tab: 'monitor' | 'editor') => void
  isMobile?: boolean
}

export function Header({ onSettingsClick, onBackClick, activeTab, onTabChange, isMobile = false }: HeaderProps) {
  const { activeProject, agents } = useProjectStore()
  const { connected } = useWsStore()

  return (
    <header className="h-12 bg-[var(--bg-tertiary)] border-b border-[var(--border)] flex items-center px-3 justify-between">
      <div className="flex items-center gap-2 md:gap-4">
        {/* Back button */}
        <button
          onClick={onBackClick}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-[var(--bg-secondary)] transition-colors text-[var(--text-secondary)] hover:text-white"
          title="Back to projects"
        >
          <ArrowLeft size={16} />
        </button>

        {/* Project name */}
        <div className="flex items-center gap-2">
          <span className={`font-semibold ${isMobile ? 'text-xs truncate max-w-[100px]' : 'text-sm'}`}>
            {activeProject?.name || 'No Project'}
          </span>
          {!isMobile && agents.length > 0 && (
            <span className="text-xs text-[var(--text-secondary)] px-2 py-0.5 bg-[var(--bg-secondary)] rounded">
              {agents.length} agent{agents.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Separator - hidden on mobile */}
        {!isMobile && <div className="h-5 w-px bg-[var(--border)]" />}

        {/* Tab switcher */}
        <div className="flex items-center bg-[var(--bg-secondary)] rounded-md p-0.5">
          <button
            onClick={() => onTabChange('monitor')}
            className={`flex items-center gap-1 px-2 md:px-3 py-1.5 rounded text-xs md:text-sm font-medium transition-colors ${
              activeTab === 'monitor'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            <Monitor size={14} />
            {!isMobile && 'Monitor'}
          </button>
          <button
            onClick={() => onTabChange('editor')}
            className={`flex items-center gap-1 px-2 md:px-3 py-1.5 rounded text-xs md:text-sm font-medium transition-colors ${
              activeTab === 'editor'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            <Code2 size={14} />
            {!isMobile && 'Editor'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        {/* Connection status - simplified on mobile */}
        <div className="flex items-center gap-1.5 text-xs" title={connected ? 'Connected' : 'Disconnected'}>
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          {!isMobile && (
            <span className="text-[var(--text-secondary)]">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          )}
        </div>

        <button
          onClick={onSettingsClick}
          className="p-1.5 rounded hover:bg-[var(--bg-secondary)] transition-colors"
          title="Settings"
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  )
}
