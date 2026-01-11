import { useRef, useEffect, useCallback, useState } from 'react'
import { X, Maximize2, Minimize2, Copy, ClipboardPaste, Trash2, CheckSquare } from 'lucide-react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  height: number
  onClose: () => void
  onHeightChange: (height: number) => void
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
}

export function Terminal({ height, onClose, onHeightChange }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const terminalIdRef = useRef<string>(`term-${Date.now()}`)
  const isMaximizedRef = useRef(false)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 })

  // Fit terminal to container
  const fitTerminal = useCallback(() => {
    if (fitAddonRef.current && xtermRef.current) {
      try {
        fitAddonRef.current.fit()
        // Send resize to server
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const { cols, rows } = xtermRef.current
          wsRef.current.send(`resize:${cols}:${rows}`)
        }
      } catch (e) {
        // Ignore fit errors during initialization
      }
    }
  }, [])

  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu({ visible: false, x: 0, y: 0 })
  }, [])

  const handleCopy = useCallback(async () => {
    const selection = xtermRef.current?.getSelection()
    if (selection) {
      await navigator.clipboard.writeText(selection)
    }
    closeContextMenu()
  }, [closeContextMenu])

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(new TextEncoder().encode(text))
      }
    } catch (err) {
      console.error('Failed to paste:', err)
    }
    closeContextMenu()
  }, [closeContextMenu])

  const handleSelectAll = useCallback(() => {
    xtermRef.current?.selectAll()
    closeContextMenu()
  }, [closeContextMenu])

  const handleClear = useCallback(() => {
    xtermRef.current?.clear()
    closeContextMenu()
  }, [closeContextMenu])

  // Close context menu on click outside
  useEffect(() => {
    if (contextMenu.visible) {
      const handleClick = () => closeContextMenu()
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [contextMenu.visible, closeContextMenu])

  // Initialize terminal
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
      rightClickSelectsWord: true,
    })

    // Add addons
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    xterm.loadAddon(fitAddon)
    xterm.loadAddon(webLinksAddon)

    // Store refs
    xtermRef.current = xterm
    fitAddonRef.current = fitAddon

    // Open terminal
    xterm.open(terminalRef.current)

    // Initial fit
    setTimeout(() => {
      fitTerminal()
    }, 0)

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal/${terminalIdRef.current}`)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[Terminal] WebSocket connected')
      // Send initial size
      const { cols, rows } = xterm
      ws.send(`resize:${cols}:${rows}`)
    }

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const data = new Uint8Array(event.data)
        xterm.write(data)
      } else {
        xterm.write(event.data)
      }
    }

    ws.onerror = (error) => {
      console.error('[Terminal] WebSocket error:', error)
      xterm.write('\r\n\x1b[31mWebSocket error - terminal disconnected\x1b[0m\r\n')
    }

    ws.onclose = () => {
      console.log('[Terminal] WebSocket closed')
      xterm.write('\r\n\x1b[33mTerminal session ended\x1b[0m\r\n')
    }

    // Send input to server
    xterm.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data))
      }
    })

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitTerminal()
    })
    resizeObserver.observe(terminalRef.current)

    // Focus terminal
    xterm.focus()

    return () => {
      resizeObserver.disconnect()
      ws.close()
      xterm.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      wsRef.current = null
    }
  }, [fitTerminal])

  // Refit when height changes
  useEffect(() => {
    setTimeout(() => {
      fitTerminal()
    }, 0)
  }, [height, fitTerminal])

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
    onHeightChange(isMaximizedRef.current ? 400 : 200)
  }

  const clearTerminal = () => {
    xtermRef.current?.clear()
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

      {/* Header */}
      <div className="h-8 flex items-center justify-between px-3 border-b border-[var(--border)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase text-[var(--text-secondary)]">Terminal</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearTerminal}
            className="px-2 py-0.5 text-xs text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-tertiary)] rounded"
          >
            Clear
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

      {/* Terminal container */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-hidden"
        style={{ padding: '4px' }}
        onClick={() => xtermRef.current?.focus()}
        onContextMenu={handleContextMenu}
      />

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          className="fixed bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl py-1 z-50 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleCopy}
            className="w-full px-3 py-1.5 text-sm text-left hover:bg-[var(--bg-tertiary)] flex items-center gap-2"
          >
            <Copy size={14} />
            <span>Copy</span>
            <span className="ml-auto text-xs text-[var(--text-secondary)]">Ctrl+C</span>
          </button>
          <button
            onClick={handlePaste}
            className="w-full px-3 py-1.5 text-sm text-left hover:bg-[var(--bg-tertiary)] flex items-center gap-2"
          >
            <ClipboardPaste size={14} />
            <span>Paste</span>
            <span className="ml-auto text-xs text-[var(--text-secondary)]">Ctrl+V</span>
          </button>
          <div className="border-t border-[var(--border)] my-1" />
          <button
            onClick={handleSelectAll}
            className="w-full px-3 py-1.5 text-sm text-left hover:bg-[var(--bg-tertiary)] flex items-center gap-2"
          >
            <CheckSquare size={14} />
            <span>Select All</span>
            <span className="ml-auto text-xs text-[var(--text-secondary)]">Ctrl+A</span>
          </button>
          <div className="border-t border-[var(--border)] my-1" />
          <button
            onClick={handleClear}
            className="w-full px-3 py-1.5 text-sm text-left hover:bg-[var(--bg-tertiary)] flex items-center gap-2"
          >
            <Trash2 size={14} />
            <span>Clear Terminal</span>
          </button>
        </div>
      )}
    </div>
  )
}
