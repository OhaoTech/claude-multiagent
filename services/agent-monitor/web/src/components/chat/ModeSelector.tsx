import { useState } from 'react'
import { ChevronDown, Zap, Rocket, MessageSquare, Eye } from 'lucide-react'

export type ChatMode = 'normal' | 'plan' | 'auto' | 'yolo'

interface ModeSelectorProps {
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
}

interface ModeConfig {
  value: ChatMode
  label: string
  icon: typeof MessageSquare
  description: string
  tools: string
  color: string
  bgColor: string
}

const modes: ModeConfig[] = [
  {
    value: 'normal',
    label: 'Normal',
    icon: MessageSquare,
    description: 'Prompts for edit confirmation',
    tools: 'All tools (with prompts)',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
  },
  {
    value: 'plan',
    label: 'Plan',
    icon: Eye,
    description: 'Read-only exploration mode',
    tools: 'Read, Glob, Grep, Task only',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/20',
  },
  {
    value: 'auto',
    label: 'Auto Edit',
    icon: Zap,
    description: 'Auto-accept file changes',
    tools: 'Edit, Write, Bash, Read, Glob, Grep',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
  },
  {
    value: 'yolo',
    label: 'YOLO',
    icon: Rocket,
    description: 'No permission prompts at all',
    tools: 'All tools (no prompts)',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
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
        className={`flex items-center gap-1.5 px-2 py-1 rounded ${currentMode.bgColor} hover:opacity-80 border border-[var(--border)] transition-colors text-xs`}
        title={currentMode.tools}
      >
        <Icon size={12} className={currentMode.color} />
        <span className={currentMode.color}>{currentMode.label}</span>
        <ChevronDown size={12} className={`transition-transform ${currentMode.color} ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute bottom-full left-0 mb-1 w-56 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-lg z-20 overflow-hidden">
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
                    m.value === mode ? m.bgColor : ''
                  }`}
                >
                  <ModeIcon size={14} className={`mt-0.5 flex-shrink-0 ${m.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium ${m.color}`}>{m.label}</div>
                    <div className="text-xs text-[var(--text-secondary)]">{m.description}</div>
                    <div className="text-[10px] text-[var(--text-secondary)] opacity-70 mt-0.5">
                      {m.tools}
                    </div>
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
