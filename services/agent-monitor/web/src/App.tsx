import { useEffect, useState } from 'react'
import { Header } from './components/layout/Header'
import { Sidebar } from './components/layout/Sidebar'
import { EditorTabs } from './components/editor/EditorTabs'
import { Terminal } from './components/editor/Terminal'
import { ChatPanel } from './components/chat/ChatPanel'
import { ProjectDashboard } from './components/projects/ProjectDashboard'
import { MonitorView } from './components/monitor/MonitorView'
import { MobileTabBar, type MobileTab } from './components/layout/MobileTabBar'
import { SkillsPanel } from './components/projects/SkillsPanel'
import { useProjectStore } from './stores/projectStore'
import { useEditorStore } from './stores/editorStore'
import { useWsStore } from './stores/wsStore'
import { useChatStore } from './stores/chatStore'
import { useIsMobile } from './hooks/useIsMobile'
import { PanelLeftClose, PanelLeftOpen, TerminalSquare } from 'lucide-react'

type AppView = 'dashboard' | 'ide'
type IdeTab = 'monitor' | 'editor'

// localStorage keys
const STORAGE_VIEW = 'cc-ide-view'
const STORAGE_PROJECT = 'cc-ide-project'
const STORAGE_TAB = 'cc-ide-tab'
const STORAGE_SIDEBAR = 'cc-ide-sidebar'
const STORAGE_TERMINAL = 'cc-ide-terminal'
const STORAGE_TERMINAL_HEIGHT = 'cc-ide-terminal-height'

function App() {
  // Initialize from localStorage
  const [view, setView] = useState<AppView>(() => {
    const saved = localStorage.getItem(STORAGE_VIEW)
    return (saved === 'ide' || saved === 'dashboard') ? saved : 'dashboard'
  })
  const [ideTab, setIdeTab] = useState<IdeTab>(() => {
    const saved = localStorage.getItem(STORAGE_TAB)
    return (saved === 'monitor' || saved === 'editor') ? saved : 'editor'
  })
  const [mobileTab, setMobileTab] = useState<MobileTab>('monitor')
  const [showSettings, setShowSettings] = useState(false)
  const [showSkills, setShowSkills] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [showSidebar, setShowSidebar] = useState(() => {
    const saved = localStorage.getItem(STORAGE_SIDEBAR)
    return saved !== 'false'
  })
  const [showTerminal, setShowTerminal] = useState(() => {
    const saved = localStorage.getItem(STORAGE_TERMINAL)
    return saved === 'true'
  })
  const [terminalHeight, setTerminalHeight] = useState(() => {
    const saved = localStorage.getItem(STORAGE_TERMINAL_HEIGHT)
    return saved ? parseInt(saved) : 200
  })

  const isMobile = useIsMobile()

  const { fetchProjects, fetchSettings, activeProject, settings, selectProject } = useProjectStore()
  const { fetchFileTree } = useEditorStore()
  const { connect, disconnect } = useWsStore()
  const { activeSession, restoreSession, isStreaming } = useChatStore()

  useEffect(() => {
    // Initialize data
    const init = async () => {
      await fetchProjects()
      await fetchSettings()

      // Restore saved project if we were in IDE view
      const savedProjectId = localStorage.getItem(STORAGE_PROJECT)
      const savedView = localStorage.getItem(STORAGE_VIEW)
      if (savedView === 'ide' && savedProjectId) {
        try {
          await selectProject(savedProjectId)
        } catch {
          // Project doesn't exist anymore, go to dashboard
          setView('dashboard')
          localStorage.removeItem(STORAGE_PROJECT)
          localStorage.setItem(STORAGE_VIEW, 'dashboard')
        }
      }
      setInitialized(true)
    }

    init()

    // Connect WebSocket for real-time updates
    connect()
    return () => disconnect()
  }, [])

  // Persist view changes to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_VIEW, view)
  }, [view])

  useEffect(() => {
    localStorage.setItem(STORAGE_TAB, ideTab)
  }, [ideTab])

  useEffect(() => {
    localStorage.setItem(STORAGE_SIDEBAR, showSidebar.toString())
  }, [showSidebar])

  useEffect(() => {
    localStorage.setItem(STORAGE_TERMINAL, showTerminal.toString())
  }, [showTerminal])

  useEffect(() => {
    localStorage.setItem(STORAGE_TERMINAL_HEIGHT, terminalHeight.toString())
  }, [terminalHeight])

  useEffect(() => {
    if (activeProject) {
      localStorage.setItem(STORAGE_PROJECT, activeProject.id)
      fetchFileTree(activeProject.root_path)
    }
  }, [activeProject])

  // Listen for session file updates and reload chat
  useEffect(() => {
    const handleSessionUpdate = (event: CustomEvent<{ sessionId: string }>) => {
      // Only reload if it's our active session and we're not streaming
      if (event.detail.sessionId === activeSession && !isStreaming) {
        restoreSession()
      }
    }

    window.addEventListener('session-file-updated', handleSessionUpdate as EventListener)
    return () => {
      window.removeEventListener('session-file-updated', handleSessionUpdate as EventListener)
    }
  }, [activeSession, restoreSession, isStreaming])

  const handleEnterProject = async (projectId: string) => {
    await selectProject(projectId)
    setView('ide')
  }

  const handleBackToDashboard = () => {
    setView('dashboard')
  }

  // Show loading while initializing
  if (!initialized && view === 'ide') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-[var(--text-secondary)]">Loading...</div>
      </div>
    )
  }

  // Dashboard view
  if (view === 'dashboard') {
    return <ProjectDashboard onEnterProject={handleEnterProject} />
  }

  // IDE view
  const sidebarWidth = settings?.sidebar_width || 220
  const chatPanelWidth = settings?.chat_panel_width || 300

  // Mobile layout
  if (isMobile) {
    return (
      <div className="fixed inset-0 flex flex-col overflow-hidden">
        <Header
          onSettingsClick={() => setShowSettings(true)}
          onSkillsClick={() => setShowSkills(true)}
          onBackClick={handleBackToDashboard}
          activeTab={ideTab}
          onTabChange={setIdeTab}
          isMobile={true}
        />

        {/* Single panel based on active mobile tab */}
        <div className="flex-1 min-h-0 overflow-hidden" style={{ paddingBottom: '56px' }}>
          {mobileTab === 'files' && (
            <Sidebar width="100%" onFileOpen={() => setMobileTab('editor')} />
          )}
          {mobileTab === 'editor' && (
            <div className="h-full w-full overflow-hidden">
              <EditorTabs />
            </div>
          )}
          {mobileTab === 'monitor' && (
            <div className="h-full w-full overflow-hidden">
              <MonitorView />
            </div>
          )}
          {mobileTab === 'chat' && (
            <ChatPanel width="100%" />
          )}
        </div>

        <MobileTabBar activeTab={mobileTab} onTabChange={setMobileTab} />

        {showSettings && (
          <SettingsModal onClose={() => setShowSettings(false)} />
        )}
        {showSkills && (
          <SkillsPanel onClose={() => setShowSkills(false)} />
        )}
      </div>
    )
  }

  // Desktop layout
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <Header
        onSettingsClick={() => setShowSettings(true)}
        onSkillsClick={() => setShowSkills(true)}
        onBackClick={handleBackToDashboard}
        activeTab={ideTab}
        onTabChange={setIdeTab}
        isMobile={false}
      />

      <div className="flex-1 flex overflow-hidden">
        {ideTab === 'editor' ? (
          <>
            {/* Sidebar toggle button when collapsed */}
            {!showSidebar && (
              <button
                onClick={() => setShowSidebar(true)}
                className="h-full w-8 flex items-center justify-center bg-[var(--bg-secondary)] border-r border-[var(--border)] hover:bg-[var(--bg-tertiary)] transition-colors"
                title="Show sidebar"
              >
                <PanelLeftOpen size={16} className="text-[var(--text-secondary)]" />
              </button>
            )}
            {showSidebar && (
              <div className="flex flex-col h-full" style={{ width: sidebarWidth }}>
                <div className="flex-1 overflow-hidden">
                  <Sidebar width="100%" />
                </div>
                <button
                  onClick={() => setShowSidebar(false)}
                  className="h-6 flex items-center justify-center bg-[var(--bg-secondary)] border-r border-t border-[var(--border)] hover:bg-[var(--bg-tertiary)] transition-colors flex-shrink-0"
                  title="Hide sidebar"
                >
                  <PanelLeftClose size={14} className="text-[var(--text-secondary)]" />
                </button>
              </div>
            )}
            <div className="flex-1 flex flex-col overflow-hidden">
              <EditorTabs />
              {showTerminal && (
                <Terminal
                  height={terminalHeight}
                  onClose={() => setShowTerminal(false)}
                  onHeightChange={setTerminalHeight}
                />
              )}
            </div>
          </>
        ) : (
          <MonitorView />
        )}
        <ChatPanel width={chatPanelWidth} />
      </div>

      {/* Bottom bar with terminal toggle */}
      {ideTab === 'editor' && (
        <div className="h-6 flex items-center px-2 bg-[var(--bg-secondary)] border-t border-[var(--border)]">
          <button
            onClick={() => setShowTerminal(!showTerminal)}
            className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded transition-colors ${
              showTerminal
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-tertiary)]'
            }`}
            title={showTerminal ? 'Hide terminal' : 'Show terminal'}
          >
            <TerminalSquare size={12} />
            <span>Terminal</span>
          </button>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}

      {/* Skills Panel */}
      {showSkills && (
        <SkillsPanel onClose={() => setShowSkills(false)} />
      )}
    </div>
  )
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, updateSettings } = useProjectStore()

  if (!settings) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-secondary)] rounded-lg w-[400px]">
        <div className="p-4 border-b border-[var(--border)] flex justify-between items-center">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-white">
            &times;
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Theme</label>
            <select
              value={settings.theme}
              onChange={e => updateSettings({ theme: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-sm"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Editor Font Size</label>
            <input
              type="number"
              value={settings.editor_font_size}
              onChange={e => updateSettings({ editor_font_size: parseInt(e.target.value) })}
              className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Tab Size</label>
            <input
              type="number"
              value={settings.editor_tab_size}
              onChange={e => updateSettings({ editor_tab_size: parseInt(e.target.value) })}
              className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="autoSave"
              checked={settings.auto_save}
              onChange={e => updateSettings({ auto_save: e.target.checked })}
              className="rounded"
            />
            <label htmlFor="autoSave" className="text-sm">Auto-save files</label>
          </div>
        </div>

        <div className="p-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="w-full py-2 bg-[var(--accent)] rounded text-sm font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
