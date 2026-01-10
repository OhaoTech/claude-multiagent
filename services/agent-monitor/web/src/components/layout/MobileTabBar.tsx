import { FolderTree, Code, MessageSquare } from 'lucide-react'

export type MobileTab = 'files' | 'editor' | 'chat'

interface MobileTabBarProps {
  activeTab: MobileTab
  onTabChange: (tab: MobileTab) => void
}

export function MobileTabBar({ activeTab, onTabChange }: MobileTabBarProps) {
  const tabs: { id: MobileTab; label: string; icon: React.ReactNode }[] = [
    { id: 'files', label: 'Files', icon: <FolderTree size={20} /> },
    { id: 'editor', label: 'Editor', icon: <Code size={20} /> },
    { id: 'chat', label: 'Chat', icon: <MessageSquare size={20} /> },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 h-14 bg-[var(--bg-secondary)] border-t border-[var(--border)] flex items-center justify-around z-50">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`
            flex flex-col items-center justify-center gap-0.5 flex-1 h-full
            transition-colors
            ${activeTab === tab.id
              ? 'text-[var(--accent)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }
          `}
        >
          {tab.icon}
          <span className="text-xs">{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}
