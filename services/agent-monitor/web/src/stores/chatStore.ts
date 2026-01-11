import { create } from 'zustand'
import type { ChatMessage, SessionInfo } from '../types'

const STORAGE_SESSION = 'cc-chat-session'
const STORAGE_AGENT = 'cc-chat-agent'
const STORAGE_MODE = 'cc-chat-mode'

export type ChatMode = 'normal' | 'plan' | 'auto' | 'yolo'

interface PermissionRequest {
  prompt: string
  tool?: string
  action?: string
  options: string[]
}

interface PermissionDenial {
  tool_name: string
  tool_use_id: string
  tool_input: Record<string, unknown>
}

interface ChatState {
  messages: ChatMessage[]
  sessions: SessionInfo[]
  activeSession: string | null
  isStreaming: boolean
  currentAgent: string
  currentMode: ChatMode
  ws: WebSocket | null
  pendingPermission: PermissionRequest | null
  permissionDenials: PermissionDenial[]
  lastMessage: string | null  // For re-run with approved tools

  // Actions
  fetchSessions: (agent?: string) => Promise<void>
  loadSession: (sessionId: string) => Promise<void>
  restoreSession: () => Promise<void>
  sendMessage: (message: string, images?: string[], allowedTools?: string[]) => void
  sendPermissionResponse: (response: string) => void
  stopChat: () => void
  setAgent: (agent: string) => void
  setMode: (mode: ChatMode) => void
  clearMessages: () => void
  clearPermissionDenials: () => void
  rerunWithApprovedTools: (tools: string[]) => void
  answerQuestion: (answers: Record<string, string>) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  sessions: [],
  activeSession: localStorage.getItem(STORAGE_SESSION),
  isStreaming: false,
  currentAgent: localStorage.getItem(STORAGE_AGENT) || 'leader',
  currentMode: (localStorage.getItem(STORAGE_MODE) as ChatMode) || 'normal',
  ws: null,
  pendingPermission: null,
  permissionDenials: [],
  lastMessage: null,

  fetchSessions: async (agent?: string) => {
    try {
      const url = agent ? `/api/sessions/${agent}` : '/api/sessions'
      const res = await fetch(url)
      const sessions = await res.json()
      set({ sessions })
    } catch {
      set({ sessions: [] })
    }
  },

  loadSession: async (sessionId: string) => {
    try {
      const res = await fetch(`/api/session/${sessionId}`)
      const data = await res.json()
      const messages: ChatMessage[] = data.messages.map((m: any) => ({
        type: m.type,
        content: m.content,
        timestamp: m.timestamp,
        uuid: m.uuid,
      }))
      localStorage.setItem(STORAGE_SESSION, sessionId)
      set({ messages, activeSession: sessionId })
    } catch {
      set({ messages: [] })
    }
  },

  restoreSession: async () => {
    const sessionId = get().activeSession
    if (sessionId) {
      try {
        const res = await fetch(`/api/session/${sessionId}`)
        if (res.ok) {
          const data = await res.json()
          const messages: ChatMessage[] = data.messages.map((m: any) => ({
            type: m.type,
            content: m.content,
            timestamp: m.timestamp,
            uuid: m.uuid,
          }))
          set({ messages })
        } else {
          localStorage.removeItem(STORAGE_SESSION)
          set({ activeSession: null, messages: [] })
        }
      } catch {
        localStorage.removeItem(STORAGE_SESSION)
        set({ activeSession: null, messages: [] })
      }
    }
  },

  sendMessage: (message: string, images: string[] = [], allowedTools?: string[]) => {
    const state = get()
    if (state.isStreaming) return

    // Store message for potential re-run
    set({ lastMessage: message, permissionDenials: [] })

    // Add user message
    const userMessage: ChatMessage = {
      type: 'user',
      content: message,
      timestamp: Date.now(),
    }
    set(s => ({ messages: [...s.messages, userMessage] }))

    // Create WebSocket connection
    const chatId = Math.random().toString(36).substring(7)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/chat/${chatId}`)

    ws.onopen = () => {
      set({ isStreaming: true, ws })
      const payload: Record<string, unknown> = {
        agent: state.currentAgent,
        message,
        images,
        resume: true,
        session_id: state.activeSession,
        mode: state.currentMode,
      }

      // Add allowed tools if specified (for re-run with approved permissions)
      if (allowedTools && allowedTools.length > 0) {
        payload.allowedTools = allowedTools
      }

      ws.send(JSON.stringify(payload))
    }

    // Track session_id from init but only save it on success
    let pendingSessionId: string | null = null

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)

      // Capture session_id but don't save until we know chat succeeded
      if (data.session_id) {
        pendingSessionId = data.session_id
      }

      if (data.type === 'chat_start') {
        return
      }

      if (data.type === 'permission_request') {
        set({
          pendingPermission: {
            prompt: data.prompt || 'Permission requested',
            tool: data.tool,
            action: data.action,
            options: data.options || ['Yes', 'No'],
          },
        })
        return
      }

      if (data.type === 'permission_response_sent') {
        set({ pendingPermission: null })
        return
      }

      if (data.type === 'chat_output' || data.type === 'assistant') {
        let content = ''
        if (data.type === 'assistant' && data.message?.content) {
          const contentBlocks = data.message.content
          if (Array.isArray(contentBlocks)) {
            content = contentBlocks
              .filter((block: any) => block.type === 'text')
              .map((block: any) => block.text)
              .join('')
          }
        } else {
          content = data.content || ''
        }

        if (content) {
          set(s => {
            const lastMsg = s.messages[s.messages.length - 1]
            if (lastMsg?.type === 'assistant') {
              return {
                messages: [
                  ...s.messages.slice(0, -1),
                  { ...lastMsg, content: lastMsg.content + content },
                ],
              }
            } else {
              return {
                messages: [...s.messages, { type: 'assistant', content, timestamp: Date.now() }],
              }
            }
          })
        }
      } else if (data.type === 'chat_done') {
        const currentMessages = get().messages
        const hasAssistantResponse = currentMessages.some(m => m.type === 'assistant' && m.content)
        if (pendingSessionId && hasAssistantResponse) {
          localStorage.setItem(STORAGE_SESSION, pendingSessionId)
          set({ activeSession: pendingSessionId })
        }

        // Capture permission denials
        if (data.permission_denials && data.permission_denials.length > 0) {
          set({ permissionDenials: data.permission_denials })
        }

        set({ isStreaming: false, ws: null })
        ws.close()
      } else if (data.type === 'error') {
        set(s => ({
          messages: [...s.messages, { type: 'system', content: `Error: ${data.message}`, timestamp: Date.now() }],
          isStreaming: false,
          ws: null,
        }))
        ws.close()
      }
    }

    ws.onerror = () => {
      set({ isStreaming: false, ws: null })
    }

    ws.onclose = () => {
      set({ isStreaming: false, ws: null })
    }
  },

  stopChat: () => {
    const ws = get().ws
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop' }))
      ws.close()
    }
    set({ isStreaming: false, ws: null, pendingPermission: null })
  },

  sendPermissionResponse: (response: string) => {
    const ws = get().ws
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'permission_response', response }))
    }
    set({ pendingPermission: null })
  },

  setAgent: (agent: string) => {
    localStorage.setItem(STORAGE_AGENT, agent)
    set({ currentAgent: agent })
  },

  setMode: (mode: ChatMode) => {
    localStorage.setItem(STORAGE_MODE, mode)
    set({ currentMode: mode })
  },

  clearMessages: () => {
    localStorage.removeItem(STORAGE_SESSION)
    set({ messages: [], activeSession: null, permissionDenials: [], lastMessage: null })
  },

  clearPermissionDenials: () => {
    set({ permissionDenials: [] })
  },

  rerunWithApprovedTools: (tools: string[]) => {
    const state = get()
    if (!state.lastMessage) return

    // Clear the denial and re-run with approved tools
    set({ permissionDenials: [] })
    state.sendMessage(state.lastMessage, [], tools)
  },

  answerQuestion: (answers: Record<string, string>) => {
    const state = get()

    // Format the answer as a user message
    let answerText = ''
    if (answers.custom) {
      // Custom typed answer
      answerText = answers.custom
    } else {
      // Selected options - format as list
      const answerList = Object.entries(answers)
        .map(([_, value]) => value)
        .join(', ')
      answerText = answerList
    }

    // Clear denials and send the answer as a message
    set({ permissionDenials: [] })
    state.sendMessage(answerText)
  },
}))
