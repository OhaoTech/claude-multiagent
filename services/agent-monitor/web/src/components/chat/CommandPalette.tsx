import { useState, useEffect, useRef } from 'react'
import {
  Info,
  GitBranch,
  Trash2,
  DollarSign,
  HelpCircle,
  Minimize2,
  Play,
  FileEdit,
  Zap,
  Rocket,
  Eye,
} from 'lucide-react'

interface Command {
  name: string
  description: string
  icon: typeof Info
  action: string
}

const commands: Command[] = [
  { name: '/status', description: 'Show agent status', icon: Info, action: 'status' },
  { name: '/git-log', description: 'Show recent commits', icon: GitBranch, action: 'git-log' },
  { name: '/clear', description: 'Clear conversation', icon: Trash2, action: 'clear' },
  { name: '/cost', description: 'Show session cost', icon: DollarSign, action: 'cost' },
  { name: '/help', description: 'Show available commands', icon: HelpCircle, action: 'help' },
  { name: '/compact', description: 'Compact conversation', icon: Minimize2, action: 'compact' },
  { name: '/resume', description: 'Resume previous session', icon: Play, action: 'resume' },
  { name: '/plan', description: 'Enter plan mode', icon: FileEdit, action: 'plan' },
  { name: '/auto', description: 'Enter auto mode', icon: Zap, action: 'auto' },
  { name: '/yolo', description: 'Enter YOLO mode', icon: Rocket, action: 'yolo' },
  { name: '/review', description: 'Review changes', icon: Eye, action: 'review' },
]

interface CommandPaletteProps {
  query: string
  onSelect: (command: string) => void
  onClose: () => void
}

export function CommandPalette({ query, onSelect, onClose }: CommandPaletteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const filteredCommands = commands.filter((cmd) =>
    cmd.name.toLowerCase().includes(query.toLowerCase()) ||
    cmd.description.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) => Math.max(i - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (filteredCommands[selectedIndex]) {
            onSelect(filteredCommands[selectedIndex].name)
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filteredCommands, selectedIndex, onSelect, onClose])

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current
    const selected = list?.children[selectedIndex] as HTMLElement
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  if (filteredCommands.length === 0) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-lg p-3">
        <p className="text-sm text-[var(--text-secondary)]">No commands found</p>
      </div>
    )
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-lg overflow-hidden">
      <div ref={listRef} className="max-h-[300px] overflow-y-auto">
        {filteredCommands.map((cmd, idx) => {
          const Icon = cmd.icon
          return (
            <button
              key={cmd.name}
              onClick={() => onSelect(cmd.name)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                idx === selectedIndex
                  ? 'bg-[var(--accent)]/20'
                  : 'hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              <Icon size={16} className="text-[var(--text-secondary)] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-mono">{cmd.name}</div>
                <div className="text-xs text-[var(--text-secondary)] truncate">
                  {cmd.description}
                </div>
              </div>
            </button>
          )
        })}
      </div>
      <div className="px-3 py-2 border-t border-[var(--border)] text-xs text-[var(--text-secondary)]">
        <kbd className="px-1 bg-[var(--bg-tertiary)] rounded">↑↓</kbd> navigate
        <kbd className="px-1 bg-[var(--bg-tertiary)] rounded ml-2">Enter</kbd> select
        <kbd className="px-1 bg-[var(--bg-tertiary)] rounded ml-2">Esc</kbd> close
      </div>
    </div>
  )
}
