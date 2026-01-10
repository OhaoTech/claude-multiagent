import { useState } from 'react'
import { ChevronDown, Zap, FileEdit, Rocket, MessageSquare } from 'lucide-react'

export type ChatMode = 'normal' | 'plan' | 'auto' | 'yolo'

interface ModeSelectorProps {
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
}

const modes: { value: ChatMode; label: string; icon: typeof MessageSquare; description: string }[] = [
  {
    value: 'normal',
    label: 'Normal',
    icon: MessageSquare,
    description: 'Ask for confirmation before actions',
  },
  {
    value: 'plan',
    label: 'Plan',
    icon: FileEdit,
    description: 'Create a plan before executing',
  },
  {
    value: 'auto',
    label: 'Auto Edit',
    icon: Zap,
    description: 'Automatically edit files',
  },
  {
    value: 'yolo',
    label: 'YOLO',
    icon: Rocket,
    description: 'Execute all actions without confirmation',
  },
]

export function ModeSelector({ mode, onModeChange }: ModeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)

  const currentMode = modes.find(m => m.value === mode) || modes[0]
  const Icon = currentMode.icon

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] border border-[var(--border)] transition-colors text-xs"
      >
        <Icon size={12} />
        <span>{currentMode.label}</span>
        <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute bottom-full left-0 mb-1 w-48 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-lg z-20 overflow-hidden">
            {modes.map((m) => {
              const ModeIcon = m.icon
              return (
                <button
                  key={m.value}
                  onClick={() => {
                    onModeChange(m.value)
                    setIsOpen(false)
                  }}
                  className={`w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] transition-colors ${
                    m.value === mode ? 'bg-[var(--accent)]/20' : ''
                  }`}
                >
                  <ModeIcon size={14} className="mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-medium">{m.label}</div>
                    <div className="text-xs text-[var(--text-secondary)]">{m.description}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
