import { useState, useRef, useCallback, useEffect } from 'react'
import { X, Plus, Maximize2, Minimize2, TerminalIcon, SplitSquareVertical } from 'lucide-react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface TerminalTab {
  id: string
  title: string
}

interface TerminalTabsProps {
  height: number
  onClose: () => void
  onHeightChange: (height: number) => void
}

export function TerminalTabs({ height, onClose, onHeightChange }: TerminalTabsProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([
    { id: `term-${Date.now()}`, title: 'Terminal 1' }
  ])
  const [activeTab, setActiveTab] = useState<string>(tabs[0].id)
  const [isSplit, setIsSplit] = useState(false)
  const [splitTab, setSplitTab] = useState<string | null>(null)
  const isMaximizedRef = useRef(false)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const tabCounter = useRef(2)

  const addTab = useCallback(() => {
    const newTab: TerminalTab = {
      id: `term-${Date.now()}`,
      title: `Terminal ${tabCounter.current++}`
    }
    setTabs(prev => [...prev, newTab])
    setActiveTab(newTab.id)
  }, [])

  const closeTab = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== id)
      if (newTabs.length === 0) {
        // Close the entire terminal panel
        onClose()
        return prev
      }
      // If closing active tab, switch to another
      if (activeTab === id) {
        const idx = prev.findIndex(t => t.id === id)
        const newActive = newTabs[Math.max(0, idx - 1)]
        setActiveTab(newActive.id)
      }
      // If closing split tab
      if (splitTab === id) {
        setIsSplit(false)
        setSplitTab(null)
      }
      return newTabs
    })
  }, [activeTab, splitTab, onClose])

  const toggleSplit = useCallback(() => {
    if (isSplit) {
      setIsSplit(false)
      setSplitTab(null)
    } else if (tabs.length > 1) {
      // Split with another tab
      const otherTab = tabs.find(t => t.id !== activeTab)
      if (otherTab) {
        setIsSplit(true)
        setSplitTab(otherTab.id)
      }
    } else {
      // Create a new tab and split
      const newTab: TerminalTab = {
        id: `term-${Date.now()}`,
        title: `Terminal ${tabCounter.current++}`
      }
      setTabs(prev => [...prev, newTab])
      setIsSplit(true)
      setSplitTab(newTab.id)
    }
  }, [isSplit, tabs, activeTab])

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

  const toggleMaximize = () => {
    isMaximizedRef.current = !isMaximizedRef.current
    onHeightChange(isMaximizedRef.current ? 500 : 200)
  }

  return (
    <div
      className="bg-[var(--bg-secondary)] border-t border-[var(--border)] flex flex-col"
      style={{ height }}
    >
      {/* Drag handle */}
      <div
        className="h-1 cursor-ns-resize hover:bg-[var(--accent)] transition-colors"
        onMouseDown={handleDragStart}
      />

      {/* Header with tabs */}
      <div className="h-8 flex items-center justify-between border-b border-[var(--border)] flex-shrink-0">
        <div className="flex items-center overflow-x-auto hide-scrollbar">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-[var(--border)] transition-colors ${
                activeTab === tab.id
                  ? 'bg-[var(--bg-tertiary)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              <TerminalIcon size={12} />
              <span>{tab.title}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => closeTab(tab.id, e)}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                >
                  <X size={12} />
                </button>
              )}
            </button>
          ))}
          <button
            onClick={addTab}
            className="px-2 py-1.5 text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-tertiary)] transition-colors"
            title="New terminal"
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="flex items-center gap-1 px-2 flex-shrink-0">
          <button
            onClick={toggleSplit}
            className={`p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors ${
              isSplit ? 'text-[var(--accent)]' : ''
            }`}
            title={isSplit ? 'Unsplit' : 'Split terminal'}
          >
            <SplitSquareVertical size={14} />
          </button>
          <button
            onClick={toggleMaximize}
            className="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            title={isMaximizedRef.current ? 'Restore' : 'Maximize'}
          >
            {isMaximizedRef.current ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
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

      {/* Terminal content */}
      <div className="flex-1 overflow-hidden flex">
        {isSplit && splitTab ? (
          <>
            {/* Left pane */}
            <div className="flex-1 overflow-hidden border-r border-[var(--border)]">
              <TerminalPane
                terminalId={activeTab}
                isActive={true}
              />
            </div>
            {/* Right pane */}
            <div className="flex-1 overflow-hidden">
              <TerminalPane
                terminalId={splitTab}
                isActive={true}
              />
            </div>
          </>
        ) : (
          /* Single pane - show all tabs, hide inactive */
          tabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex-1 overflow-hidden ${
                tab.id === activeTab ? '' : 'hidden'
              }`}
            >
              <TerminalPane
                terminalId={tab.id}
                isActive={tab.id === activeTab}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// Simplified terminal pane that just renders the xterm
interface TerminalPaneProps {
  terminalId: string
  isActive: boolean
}

function TerminalPane({ terminalId, isActive }: TerminalPaneProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return

    // Create xterm instance
    const xterm = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#e0e0e0',
        cursor: '#00d9ff',
        cursorAccent: '#1a1a1a',
        selectionBackground: '#264f78',
        black: '#1a1a1a',
        red: '#f44747',
        green: '#6a9955',
        yellow: '#dcdcaa',
        blue: '#569cd6',
        magenta: '#c586c0',
        cyan: '#4ec9b0',
        white: '#e0e0e0',
        brightBlack: '#808080',
        brightRed: '#f44747',
        brightGreen: '#6a9955',
        brightYellow: '#dcdcaa',
        brightBlue: '#569cd6',
        brightMagenta: '#c586c0',
        brightCyan: '#4ec9b0',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
    })

    // Add addons
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    xterm.loadAddon(fitAddon)
    xterm.loadAddon(webLinksAddon)

    xtermRef.current = xterm
    fitAddonRef.current = fitAddon

    // Open terminal
    xterm.open(terminalRef.current)

    // Initial fit
    setTimeout(() => {
      try {
        fitAddon.fit()
      } catch (e) {
        // Ignore
      }
    }, 0)

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal/${terminalId}`)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      console.log(`[Terminal] ${terminalId} connected`)
      const { cols, rows } = xterm
      ws.send(`resize:${cols}:${rows}`)
    }

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        xterm.write(new Uint8Array(event.data))
      } else {
        xterm.write(event.data)
      }
    }

    ws.onerror = () => {
      xterm.write('\r\n\x1b[31mWebSocket error\x1b[0m\r\n')
    }

    ws.onclose = () => {
      xterm.write('\r\n\x1b[33mSession ended\x1b[0m\r\n')
    }

    // Send input to server
    xterm.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data))
      }
    })

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        if (ws.readyState === WebSocket.OPEN) {
          const { cols, rows } = xterm
          ws.send(`resize:${cols}:${rows}`)
        }
      } catch (e) {
        // Ignore
      }
    })
    resizeObserver.observe(terminalRef.current)

    // Focus if active
    if (isActive) {
      xterm.focus()
    }

    return () => {
      resizeObserver.disconnect()
      ws.close()
      xterm.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      wsRef.current = null
    }
  }, [terminalId])

  // Focus when becoming active
  useEffect(() => {
    if (isActive && xtermRef.current) {
      xtermRef.current.focus()
    }
  }, [isActive])

  return (
    <div
      ref={terminalRef}
      className="h-full w-full"
      style={{ padding: '4px' }}
      onClick={() => xtermRef.current?.focus()}
    />
  )
}
