import { useState, useRef, useEffect } from 'react'
import { Send, Square, User, Bot, History, Wrench, CheckCircle, ChevronRight, ChevronDown, Terminal } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatStore } from '../../stores/chatStore'
import { useProjectStore } from '../../stores/projectStore'
import { ModeSelector, type ChatMode } from './ModeSelector'
import { SessionPicker } from './SessionPicker'
import { ImageAttachment } from './ImageAttachment'
import { CommandPalette } from './CommandPalette'

interface ChatPanelProps {
  width: number | string
}

export function ChatPanel({ width }: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<ChatMode>('normal')
  const [images, setImages] = useState<string[]>([])
  const [showSessionPicker, setShowSessionPicker] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const {
    messages,
    isStreaming,
    currentAgent,
    activeSession,
    sendMessage,
    stopChat,
    setAgent,
    loadSession,
    clearMessages,
    restoreSession,
  } = useChatStore()
  const { agents } = useProjectStore()

  // Restore session on mount
  useEffect(() => {
    restoreSession()
  }, [restoreSession])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Handle "/" command trigger
  useEffect(() => {
    if (input.startsWith('/')) {
      setShowCommandPalette(true)
    } else {
      setShowCommandPalette(false)
    }
  }, [input])

  const handleSend = () => {
    if (!input.trim() || isStreaming) return

    // Handle command execution
    if (input.startsWith('/')) {
      handleCommand(input.trim())
      setInput('')
      return
    }

    sendMessage(input.trim(), images)
    setInput('')
    setImages([])
  }

  const handleCommand = (cmd: string) => {
    switch (cmd) {
      case '/clear':
        clearMessages()
        break
      case '/plan':
        setMode('plan')
        break
      case '/auto':
        setMode('auto')
        break
      case '/yolo':
        setMode('yolo')
        break
      default:
        // Send as a regular message for backend to handle
        sendMessage(cmd)
    }
    setShowCommandPalette(false)
  }

  const handleCommandSelect = (command: string) => {
    setInput(command + ' ')
    setShowCommandPalette(false)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!showCommandPalette) {
        handleSend()
      }
    }
  }

  const handleNewSession = () => {
    clearMessages()
  }

  return (
    <aside
      className="bg-[var(--bg-secondary)] border-l border-[var(--border)] flex flex-col h-full overflow-hidden"
      style={{ width: typeof width === 'number' ? `${width}px` : width }}
    >
      {/* Header */}
      <div className="h-10 flex items-center justify-between px-3 border-b border-[var(--border)] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium">Chat</span>
          {activeSession && (
            <span className="text-xs text-[var(--text-secondary)] font-mono truncate">
              {activeSession.slice(0, 8)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setShowSessionPicker(true)}
            className="p-2 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            title="Session history"
          >
            <History size={16} />
          </button>
          <select
            value={currentAgent}
            onChange={(e) => setAgent(e.target.value)}
            className="text-xs bg-[var(--bg-tertiary)] border border-[var(--border)] rounded px-2 py-1.5 max-w-[100px]"
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.name}>
                {agent.name}
              </option>
            ))}
            {agents.length === 0 && <option value="leader">leader</option>}
          </select>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <div className="text-center text-[var(--text-secondary)] text-sm py-8">
            Start a conversation with the agent
          </div>
        ) : (
          messages.map((msg, idx) => (
            <MessageBubble key={idx} message={msg} />
          ))
        )}
        {isStreaming && (
          <div className="flex items-center gap-2 text-[var(--text-secondary)] text-sm">
            <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
            <span>Agent is typing...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="p-3 border-t border-[var(--border)] space-y-2 flex-shrink-0">
        {/* Image previews */}
        {images.length > 0 && (
          <ImageAttachment images={images} onImagesChange={setImages} />
        )}

        {/* Mode and tools row */}
        <div className="flex items-center justify-between">
          <ModeSelector mode={mode} onModeChange={setMode} />
          <div className="flex items-center gap-1">
            <ImageAttachment images={images} onImagesChange={setImages} />
          </div>
        </div>

        {/* Input box */}
        <div className="relative">
          {showCommandPalette && (
            <CommandPalette
              query={input}
              onSelect={handleCommandSelect}
              onClose={() => setShowCommandPalette(false)}
            />
          )}
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message or / for commands..."
              rows={2}
              className="flex-1 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--accent)]"
            />
            {isStreaming ? (
              <button
                onClick={stopChat}
                className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                <Square size={18} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="px-3 py-2 bg-[var(--accent)] hover:opacity-90 rounded-lg transition-colors disabled:opacity-50"
              >
                <Send size={18} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Session Picker Modal */}
      {showSessionPicker && (
        <SessionPicker
          agentName={currentAgent}
          currentSessionId={activeSession}
          onSelectSession={loadSession}
          onNewSession={handleNewSession}
          onClose={() => setShowSessionPicker(false)}
        />
      )}
    </aside>
  )
}

// Check if content is a tool use or result that should be collapsible
function parseToolMessage(content: string): { type: 'tool_use' | 'tool_result' | null; name: string; body: string } {
  // Match [Tool: ToolName] pattern
  const toolUseMatch = content.match(/^\[Tool:\s*(\w+)\]\s*([\s\S]*)/)
  if (toolUseMatch) {
    return { type: 'tool_use', name: toolUseMatch[1], body: toolUseMatch[2].trim() }
  }

  // Match [Result] pattern
  const resultMatch = content.match(/^\[Result\]\s*([\s\S]*)/)
  if (resultMatch) {
    return { type: 'tool_result', name: 'Result', body: resultMatch[1].trim() }
  }

  return { type: null, name: '', body: content }
}

// Collapsible tool message component
function CollapsibleToolMessage({
  toolType,
  name,
  body,
}: {
  toolType: 'tool_use' | 'tool_result'
  name: string
  body: string
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isToolUse = toolType === 'tool_use'

  // Get preview (first line or first 60 chars)
  const preview = body.split('\n')[0].slice(0, 60) + (body.length > 60 ? '...' : '')

  return (
    <div className="flex gap-2 w-full">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
          isToolUse ? 'bg-purple-600' : 'bg-green-600'
        }`}
      >
        {isToolUse ? <Terminal size={14} /> : <CheckCircle size={14} />}
      </div>
      <div
        className={`flex-1 min-w-0 max-w-[85%] rounded-lg text-sm overflow-hidden ${
          isToolUse
            ? 'bg-purple-900/30 border border-purple-800/50'
            : 'bg-green-900/30 border border-green-800/50'
        }`}
      >
        {/* Clickable header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors text-left"
        >
          {isExpanded ? (
            <ChevronDown size={14} className="flex-shrink-0 text-[var(--text-secondary)]" />
          ) : (
            <ChevronRight size={14} className="flex-shrink-0 text-[var(--text-secondary)]" />
          )}
          <span className={`font-medium ${isToolUse ? 'text-purple-300' : 'text-green-300'}`}>
            {isToolUse ? `Tool: ${name}` : 'Result'}
          </span>
          {!isExpanded && (
            <span className="text-xs text-[var(--text-secondary)] truncate flex-1">
              {preview}
            </span>
          )}
        </button>

        {/* Expandable content */}
        {isExpanded && (
          <div className="px-3 pb-2 border-t border-white/10">
            <pre className="whitespace-pre-wrap font-mono text-xs break-words mt-2 text-[var(--text-secondary)]">
              {body}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

// Message bubble component
function MessageBubble({ message }: { message: { type: string; content: string } }) {
  // Skip empty messages
  if (!message.content || !message.content.trim()) {
    return null
  }

  // Check for tool use / result patterns in ALL messages (might be mistyped)
  const toolInfo = parseToolMessage(message.content)

  // If it's a collapsible tool message, render the collapsible component
  // This takes priority over message.type since [Result] might come as 'user' type
  if (toolInfo.type) {
    return (
      <CollapsibleToolMessage
        toolType={toolInfo.type}
        name={toolInfo.name}
        body={toolInfo.body}
      />
    )
  }

  const isUser = message.type === 'user'
  const isSystem = message.type === 'system'

  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <div
          className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
            isSystem ? 'bg-yellow-600' : 'bg-[var(--accent)]'
          }`}
        >
          {isSystem ? <Wrench size={14} /> : <Bot size={14} />}
        </div>
      )}
      <div
        className={`
          max-w-[85%] rounded-lg px-3 py-2 text-sm overflow-hidden break-words
          ${
            isUser
              ? 'bg-[var(--accent)] text-white'
              : isSystem
              ? 'bg-yellow-900/30 border border-yellow-800/50 text-yellow-200'
              : 'bg-[var(--bg-tertiary)]'
          }
        `}
      >
        {isUser ? (
          <pre className="whitespace-pre-wrap font-sans break-words overflow-hidden">{message.content}</pre>
        ) : (
          <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-pre:my-2 prose-pre:bg-black/30 prose-pre:p-2 prose-pre:overflow-x-auto prose-code:text-[var(--accent)] prose-code:before:content-none prose-code:after:content-none prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 [&_*]:break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
      {isUser && (
        <div className="w-6 h-6 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center flex-shrink-0">
          <User size={14} />
        </div>
      )}
    </div>
  )
}
