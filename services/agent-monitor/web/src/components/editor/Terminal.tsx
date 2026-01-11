import { useState, useRef, useEffect } from 'react'
import { X, Maximize2, Minimize2 } from 'lucide-react'

interface TerminalProps {
  height: number
  onClose: () => void
  onHeightChange: (height: number) => void
}

interface TerminalLine {
  id: number
  type: 'input' | 'output' | 'error'
  content: string
  timestamp: Date
}

export function Terminal({ height, onClose, onHeightChange }: TerminalProps) {
  const [input, setInput] = useState('')
  const [lines, setLines] = useState<TerminalLine[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lineIdRef = useRef(0)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)

  // Auto-scroll to bottom when new lines are added
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [lines])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const addLine = (type: TerminalLine['type'], content: string) => {
    setLines(prev => [...prev, {
      id: lineIdRef.current++,
      type,
      content,
      timestamp: new Date()
    }])
  }

  const runCommand = async (cmd: string) => {
    if (!cmd.trim()) return

    addLine('input', `$ ${cmd}`)
    setIsRunning(true)

    try {
      const res = await fetch('/api/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
      })
      const data = await res.json()

      if (data.stdout) {
        addLine('output', data.stdout)
      }
      if (data.stderr) {
        addLine('error', data.stderr)
      }
      if (data.error) {
        addLine('error', data.error)
      }
    } catch (err) {
      addLine('error', `Failed to execute command: ${err}`)
    } finally {
      setIsRunning(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isRunning) {
      runCommand(input)
      setInput('')
    }
  }

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startY: e.clientY, startHeight: height }
    document.addEventListener('mousemove', handleDrag)
    document.addEventListener('mouseup', handleDragEnd)
  }

  const handleDrag = (e: MouseEvent) => {
    if (!dragRef.current) return
    const delta = dragRef.current.startY - e.clientY
    const newHeight = Math.max(100, Math.min(600, dragRef.current.startHeight + delta))
    onHeightChange(newHeight)
  }

  const handleDragEnd = () => {
    dragRef.current = null
    document.removeEventListener('mousemove', handleDrag)
    document.removeEventListener('mouseup', handleDragEnd)
  }

  const clearTerminal = () => {
    setLines([])
  }

  const actualHeight = isMaximized ? 400 : height

  return (
    <div
      className="bg-[var(--bg-secondary)] border-t border-[var(--border)] flex flex-col"
      style={{ height: actualHeight }}
    >
      {/* Drag handle */}
      <div
        className="h-1 cursor-ns-resize hover:bg-[var(--accent)] transition-colors"
        onMouseDown={handleDragStart}
      />

      {/* Header */}
      <div className="h-8 flex items-center justify-between px-3 border-b border-[var(--border)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase text-[var(--text-secondary)]">Terminal</span>
          {isRunning && (
            <span className="text-xs text-[var(--accent)]">Running...</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearTerminal}
            className="px-2 py-0.5 text-xs text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-tertiary)] rounded"
          >
            Clear
          </button>
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            title="Close terminal"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Output area */}
      <div
        ref={outputRef}
        className="flex-1 overflow-y-auto font-mono text-sm p-2 bg-[#1a1a1a]"
        onClick={() => inputRef.current?.focus()}
      >
        {lines.map(line => (
          <div
            key={line.id}
            className={`whitespace-pre-wrap break-all ${
              line.type === 'input' ? 'text-[var(--accent)]' :
              line.type === 'error' ? 'text-red-400' :
              'text-[var(--text-primary)]'
            }`}
          >
            {line.content}
          </div>
        ))}

        {/* Input line */}
        <div className="flex items-center text-[var(--accent)]">
          <span className="mr-2">$</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isRunning}
            className="flex-1 bg-transparent outline-none text-white disabled:opacity-50"
            placeholder={isRunning ? 'Running...' : ''}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  )
}
