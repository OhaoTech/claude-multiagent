import { create } from 'zustand'

export interface AgentState {
  agent: string
  state: 'idle' | 'running' | 'waiting' | 'error'
  run_count: number
  current_task?: string
  elapsed?: number
  is_leader?: boolean
}

export interface ActivityItem {
  id: string
  type: 'state' | 'result' | 'output' | 'error'
  agent: string
  content: string
  timestamp: number
}

interface WsState {
  connected: boolean
  agentStates: Record<string, AgentState>
  activityFeed: ActivityItem[]
  currentRunningAgent: string | null

  // Actions
  connect: () => void
  disconnect: () => void
  addActivity: (item: Omit<ActivityItem, 'id'>) => void
  updateAgentState: (agent: string, state: Partial<AgentState>) => void
}

const MAX_ACTIVITY_ITEMS = 50
let ws: WebSocket | null = null
let reconnectTimeout: number | null = null

export const useWsStore = create<WsState>((set, get) => ({
  connected: false,
  agentStates: {},
  activityFeed: [],
  currentRunningAgent: null,

  connect: () => {
    if (ws && ws.readyState === WebSocket.OPEN) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`)

    ws.onopen = () => {
      set({ connected: true })
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
        reconnectTimeout = null
      }
    }

    ws.onclose = () => {
      set({ connected: false })
      ws = null
      // Auto-reconnect after 3 seconds
      reconnectTimeout = window.setTimeout(() => {
        get().connect()
      }, 3000)
    }

    ws.onerror = () => {
      set({ connected: false })
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        handleMessage(data, set, get)
      } catch {
        // Ignore parse errors
      }
    }
  },

  disconnect: () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
    set({ connected: false })
  },

  addActivity: (item) => {
    const newItem: ActivityItem = {
      ...item,
      id: Math.random().toString(36).substring(2, 9),
    }
    set((state) => ({
      activityFeed: [newItem, ...state.activityFeed].slice(0, MAX_ACTIVITY_ITEMS),
    }))
  },

  updateAgentState: (agent, updates) => {
    set((state) => ({
      agentStates: {
        ...state.agentStates,
        [agent]: {
          ...state.agentStates[agent],
          agent,
          ...updates,
        } as AgentState,
      },
    }))

    // Update current running agent
    if (updates.state === 'running') {
      set({ currentRunningAgent: agent })
    } else if (get().currentRunningAgent === agent && updates.state === 'idle') {
      set({ currentRunningAgent: null })
    }
  },
}))

function handleMessage(
  data: any,
  set: (fn: (state: WsState) => Partial<WsState>) => void,
  get: () => WsState
) {
  const { addActivity, updateAgentState } = get()

  switch (data.type) {
    case 'connected':
      // Initial connection with current states
      if (data.current_states) {
        const states: Record<string, AgentState> = {}
        for (const [agent, state] of Object.entries(data.current_states as Record<string, any>)) {
          states[agent] = {
            agent,
            state: state.state || 'idle',
            run_count: state.run_count || 0,
            current_task: state.current_task,
            is_leader: state.is_leader,
          }
        }
        set(() => ({ agentStates: states }))
      }
      break

    case 'state':
      // Agent state change
      updateAgentState(data.agent, {
        state: data.state,
        run_count: data.run_count,
        current_task: data.current_task,
        elapsed: data.elapsed,
      })
      addActivity({
        type: 'state',
        agent: data.agent,
        content: `State: ${data.state}${data.current_task ? ` - ${data.current_task}` : ''}`,
        timestamp: Date.now(),
      })
      break

    case 'result':
      // Tool result
      addActivity({
        type: 'result',
        agent: data.agent,
        content: data.content || 'Tool completed',
        timestamp: Date.now(),
      })
      break

    case 'output':
      // Stream output
      addActivity({
        type: 'output',
        agent: data.agent,
        content: data.content || '',
        timestamp: Date.now(),
      })
      break

    case 'error':
      addActivity({
        type: 'error',
        agent: data.agent || 'system',
        content: data.message || 'Unknown error',
        timestamp: Date.now(),
      })
      break
  }
}
