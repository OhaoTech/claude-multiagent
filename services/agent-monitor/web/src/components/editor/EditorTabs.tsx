import { useState } from 'react'
import { X, Circle } from 'lucide-react'
import { useEditorStore } from '../../stores/editorStore'
import { CodeEditor } from './CodeEditor'
import { TabContextMenu } from './TabContextMenu'
import { Component, type ReactNode } from 'react'

// Error boundary to catch CodeEditor crashes
class EditorErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: '' }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }

  componentDidCatch(error: Error, info: any) {
    console.error('Editor error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex items-center justify-center bg-red-900/20 text-red-400 p-4">
          <div className="text-center">
            <p className="font-medium">Editor crashed</p>
            <p className="text-sm mt-1">{this.state.error}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: '' })}
              className="mt-2 px-3 py-1 bg-red-600 rounded text-sm"
            >
              Retry
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  tabPath: string
}

export function EditorTabs() {
  const {
    openTabs,
    activeTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    closeSavedTabs,
    closeTabsToRight,
    setActiveTab,
    updateContent,
    saveFile,
  } = useEditorStore()

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    tabPath: '',
  })

  const activeTabData = openTabs.find(t => t.path === activeTab)

  const handleTabContextMenu = (e: React.MouseEvent, tabPath: string) => {
    e.preventDefault()
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      tabPath,
    })
  }

  const handleContextMenuAction = (action: string) => {
    const { tabPath } = contextMenu

    switch (action) {
      case 'close':
        closeTab(tabPath)
        break
      case 'close-others':
        closeOtherTabs(tabPath)
        break
      case 'close-all':
        closeAllTabs()
        break
      case 'close-saved':
        closeSavedTabs()
        break
      case 'close-right':
        closeTabsToRight(tabPath)
        break
      case 'copy-path':
        navigator.clipboard.writeText(tabPath)
        break
    }
  }

  if (openTabs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-secondary)]">
        <div className="text-center">
          <p className="text-lg">No file open</p>
          <p className="text-sm mt-1">Select a file from the sidebar to edit</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--bg-primary)] h-full w-full">
      {/* Tabs bar */}
      <div className="h-9 flex items-center bg-[var(--bg-tertiary)] border-b border-[var(--border)] overflow-x-auto flex-shrink-0">
        {openTabs.map(tab => (
          <div
            key={tab.path}
            className={`
              flex items-center gap-2 px-3 h-full cursor-pointer border-r border-[var(--border)]
              ${activeTab === tab.path ? 'bg-[var(--bg-primary)]' : 'hover:bg-[var(--bg-secondary)]'}
            `}
            onClick={() => setActiveTab(tab.path)}
            onContextMenu={(e) => handleTabContextMenu(e, tab.path)}
          >
            {tab.isDirty ? (
              <Circle size={8} className="fill-current text-[var(--accent)]" />
            ) : null}
            <span className="text-sm whitespace-nowrap">{tab.name}</span>
            <button
              className="p-0.5 rounded hover:bg-[var(--bg-tertiary)]"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.path)
              }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Editor content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTabData && (
          <EditorErrorBoundary key={activeTabData.path}>
            <CodeEditor
              content={activeTabData.content}
              language={activeTabData.language}
              onChange={(content) => updateContent(activeTabData.path, content)}
              onSave={() => saveFile(activeTabData.path)}
            />
          </EditorErrorBoundary>
        )}
      </div>

      {/* Tab Context Menu */}
      {contextMenu.visible && (
        <TabContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          tabPath={contextMenu.tabPath}
          onAction={handleContextMenuAction}
          onClose={() => setContextMenu({ visible: false, x: 0, y: 0, tabPath: '' })}
        />
      )}
    </div>
  )
}
