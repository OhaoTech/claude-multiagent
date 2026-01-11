import { useState, useRef, useEffect } from 'react'
import { Send, Square, User, Bot, History, Wrench, CheckCircle, ChevronRight, ChevronDown, Terminal, AlertTriangle, RefreshCw, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatStore } from '../../stores/chatStore'
import { useProjectStore } from '../../stores/projectStore'
import { ModeSelector } from './ModeSelector'
import { SessionPicker } from './SessionPicker'
import { ImageAttachment } from './ImageAttachment'
import { CommandPalette } from './CommandPalette'
import { PermissionPrompt } from './PermissionPrompt'

interface ChatPanelProps {
  width: number | string
}

export function ChatPanel({ width }: ChatPanelProps) {
  const [input, setInput] = useState('')
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
    pendingPermission,
    permissionDenials,
    currentMode,
    sendMessage,
    sendPermissionResponse,
    stopChat,
    setAgent,
    setMode,
    loadSession,
    clearMessages,
    restoreSession,
    clearPermissionDenials,
    rerunWithApprovedTools,
    answerQuestion,
  } = useChatStore()
  const { agents } = useProjectStore()

  // Restore session on mount
  useEffect(() => {
    restoreSession()
  }, [restoreSession])

  // Ensure currentAgent is valid - default to leader or first agent
  useEffect(() => {
    if (agents.length > 0) {
      const agentNames = agents.map(a => a.name)
      if (!agentNames.includes(currentAgent)) {
        // Current agent not in project - switch to leader or first agent
        const leader = agents.find(a => a.is_leader)
        setAgent(leader?.name || agents[0].name)
      }
    } else if (currentAgent !== 'leader') {
      // No agents loaded yet, default to leader
      setAgent('leader')
    }
  }, [agents, currentAgent, setAgent])

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

      {/* Permission prompt */}
      {pendingPermission && (
        <PermissionPrompt
          prompt={pendingPermission.prompt}
          tool={pendingPermission.tool}
          action={pendingPermission.action}
          options={pendingPermission.options}
          onRespond={sendPermissionResponse}
        />
      )}

      {/* Permission denials banner */}
      {permissionDenials.length > 0 && !isStreaming && (
        <PermissionDenialBanner
          denials={permissionDenials}
          onApproveAll={() => {
            const toolNames = [...new Set(permissionDenials.map(d => d.tool_name))]
            rerunWithApprovedTools(toolNames)
          }}
          onDismiss={clearPermissionDenials}
          onAnswerQuestion={answerQuestion}
        />
      )}

      {/* Input area */}
      <div className="p-3 border-t border-[var(--border)] space-y-2 flex-shrink-0">
        {/* Image previews */}
        {images.length > 0 && (
          <ImageAttachment images={images} onImagesChange={setImages} />
        )}

        {/* Mode and tools row */}
        <div className="flex items-center justify-between">
          <ModeSelector mode={currentMode} onModeChange={setMode} />
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

// Permission denial banner component
interface PermissionDenial {
  tool_name: string
  tool_use_id: string
  tool_input: Record<string, unknown>
}

// AskUserQuestion input structure
interface AskUserQuestionInput {
  questions: Array<{
    question: string
    header: string
    options: Array<{
      label: string
      description: string
    }>
    multiSelect: boolean
  }>
}

function PermissionDenialBanner({
  denials,
  onApproveAll,
  onDismiss,
  onAnswerQuestion,
}: {
  denials: PermissionDenial[]
  onApproveAll: () => void
  onDismiss: () => void
  onAnswerQuestion?: (answers: Record<string, string>) => void
}) {
  const [customInput, setCustomInput] = useState('')
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({})

  const uniqueTools = [...new Set(denials.map(d => d.tool_name))]

  // Check if this is an AskUserQuestion denial
  const askQuestionDenial = denials.find(d => d.tool_name === 'AskUserQuestion')
  const questionInput = askQuestionDenial?.tool_input as AskUserQuestionInput | undefined

  // Handle option selection
  const handleOptionSelect = (questionIdx: number, optionLabel: string) => {
    setSelectedOptions(prev => ({
      ...prev,
      [`q${questionIdx}`]: optionLabel
    }))
  }

  // Handle submit with answers
  const handleSubmitAnswers = () => {
    if (onAnswerQuestion) {
      // If custom input is provided, use that
      if (customInput.trim()) {
        onAnswerQuestion({ custom: customInput.trim() })
      } else {
        onAnswerQuestion(selectedOptions)
      }
    }
  }

  // Render AskUserQuestion UI
  if (questionInput?.questions && questionInput.questions.length > 0) {
    return (
      <div className="mx-3 mb-2 p-3 bg-blue-900/30 border border-blue-700/50 rounded-lg">
        <div className="flex items-start gap-2">
          <AlertTriangle size={18} className="text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-blue-200 mb-2">
              Agent is asking a question
            </div>

            {questionInput.questions.map((q, qIdx) => (
              <div key={qIdx} className="mb-3">
                <div className="text-sm text-white mb-2">{q.question}</div>
                <div className="flex flex-wrap gap-2">
                  {q.options.map((opt, optIdx) => (
                    <button
                      key={optIdx}
                      onClick={() => handleOptionSelect(qIdx, opt.label)}
                      className={`px-3 py-1.5 text-xs rounded transition-colors ${
                        selectedOptions[`q${qIdx}`] === opt.label
                          ? 'bg-blue-600 text-white'
                          : 'bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                      }`}
                      title={opt.description}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Custom input option */}
            <div className="mt-3 pt-3 border-t border-blue-700/30">
              <div className="text-xs text-blue-300/80 mb-1">Or type a custom response:</div>
              <input
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="Type your answer..."
                className="w-full px-2 py-1.5 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-blue-500"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (customInput.trim() || Object.keys(selectedOptions).length > 0)) {
                    handleSubmitAnswers()
                  }
                }}
              />
            </div>

            <div className="flex gap-2 mt-3">
              <button
                onClick={handleSubmitAnswers}
                disabled={!customInput.trim() && Object.keys(selectedOptions).length === 0}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
              >
                <Send size={12} />
                Submit Answer
              </button>
              <button
                onClick={onDismiss}
                className="flex items-center gap-1 px-2 py-1 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] text-xs rounded transition-colors"
              >
                <X size={12} />
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Default denial banner for other tools
  return (
    <div className="mx-3 mb-2 p-3 bg-amber-900/30 border border-amber-700/50 rounded-lg">
      <div className="flex items-start gap-2">
        <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-amber-200">
            {denials.length} permission{denials.length > 1 ? 's' : ''} denied
          </div>
          <div className="text-xs text-amber-300/80 mt-1">
            Tools blocked: {uniqueTools.join(', ')}
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={onApproveAll}
              className="flex items-center gap-1 px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded transition-colors"
            >
              <RefreshCw size={12} />
              Approve & Re-run
            </button>
            <button
              onClick={onDismiss}
              className="flex items-center gap-1 px-2 py-1 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] text-xs rounded transition-colors"
            >
              <X size={12} />
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Check if content is a task notification (background task completion signal)
function parseTaskNotification(content: string): { isNotification: boolean; taskId: string; status: string; summary: string } | null {
  const match = content.match(/<task-notification>[\s\S]*?<task-id>([^<]+)<\/task-id>[\s\S]*?<status>([^<]+)<\/status>[\s\S]*?<summary>([^<]+)<\/summary>[\s\S]*?<\/task-notification>/)
  if (match) {
    return { isNotification: true, taskId: match[1], status: match[2], summary: match[3] }
  }
  return null
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

// Task notification component (for background task completion signals)
function TaskNotificationBubble({
  taskId,
  status,
  summary,
}: {
  taskId: string
  status: string
  summary: string
}) {
  const isSuccess = status === 'completed'

  return (
    <div className="flex gap-2">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
          isSuccess ? 'bg-blue-600' : 'bg-orange-600'
        }`}
      >
        <Terminal size={14} />
      </div>
      <div
        className={`flex-1 min-w-0 max-w-[85%] rounded-lg px-3 py-2 text-xs ${
          isSuccess
            ? 'bg-blue-900/30 border border-blue-800/50'
            : 'bg-orange-900/30 border border-orange-800/50'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`font-medium ${isSuccess ? 'text-blue-300' : 'text-orange-300'}`}>
            Task {status}
          </span>
          <span className="text-[var(--text-secondary)] font-mono">{taskId.slice(0, 7)}</span>
        </div>
        <div className="text-[var(--text-secondary)] mt-1">{summary}</div>
      </div>
    </div>
  )
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

  // Check for task notifications first (background task completion signals)
  const taskNotification = parseTaskNotification(message.content)
  if (taskNotification) {
    return (
      <TaskNotificationBubble
        taskId={taskNotification.taskId}
        status={taskNotification.status}
        summary={taskNotification.summary}
      />
    )
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
