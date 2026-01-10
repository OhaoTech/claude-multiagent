import { create } from 'zustand'
import type { ChatMessage, SessionInfo } from '../types'

const STORAGE_SESSION = 'cc-chat-session'
const STORAGE_AGENT = 'cc-chat-agent'

interface ChatState {
  messages: ChatMessage[]
  sessions: SessionInfo[]
  activeSession: string | null
  isStreaming: boolean
  currentAgent: string
  ws: WebSocket | null

  // Actions
  fetchSessions: (agent?: string) => Promise<void>
  loadSession: (sessionId: string) => Promise<void>
  restoreSession: () => Promise<void>
  sendMessage: (message: string, images?: string[]) => void
  stopChat: () => void
  setAgent: (agent: string) => void
  clearMessages: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  sessions: [],
  activeSession: localStorage.getItem(STORAGE_SESSION),
  isStreaming: false,
  currentAgent: localStorage.getItem(STORAGE_AGENT) || 'leader',
  ws: null,

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
          // Session not found, clear it
          localStorage.removeItem(STORAGE_SESSION)
          set({ activeSession: null, messages: [] })
        }
      } catch {
        // Failed to restore, clear session
        localStorage.removeItem(STORAGE_SESSION)
        set({ activeSession: null, messages: [] })
      }
    }
  },

  sendMessage: (message: string, images: string[] = []) => {
    const state = get()
    if (state.isStreaming) return

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
      ws.send(JSON.stringify({
        agent: state.currentAgent,
        message,
        images,
        resume: true,
        session_id: state.activeSession,
        mode: 'normal',
      }))
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)

      // Capture session_id from chat_start or any message
      if (data.session_id) {
        localStorage.setItem(STORAGE_SESSION, data.session_id)
        set({ activeSession: data.session_id })
      }

      if (data.type === 'chat_start') {
        // Session started, session_id already captured above
        return
      }

      if (data.type === 'chat_output') {
        const content = data.content || ''
        set(s => {
          const lastMsg = s.messages[s.messages.length - 1]
          if (lastMsg?.type === 'assistant') {
            // Append to existing assistant message
            return {
              messages: [
                ...s.messages.slice(0, -1),
                { ...lastMsg, content: lastMsg.content + content },
              ],
            }
          } else {
            // Start new assistant message
            return {
              messages: [...s.messages, { type: 'assistant', content, timestamp: Date.now() }],
            }
          }
        })
      } else if (data.type === 'chat_done') {
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
    set({ isStreaming: false, ws: null })
  },

  setAgent: (agent: string) => {
    localStorage.setItem(STORAGE_AGENT, agent)
    set({ currentAgent: agent })
  },

  clearMessages: () => {
    localStorage.removeItem(STORAGE_SESSION)
    set({ messages: [], activeSession: null })
  },
}))
