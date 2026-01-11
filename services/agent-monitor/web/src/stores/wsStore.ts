import { create } from 'zustand'

export interface AgentState {
  agent: string
  state: 'idle' | 'running' | 'waiting' | 'error'
  run_count: number
  current_task?: string
  elapsed?: number
  is_leader?: boolean
  nickname?: string | null
}

export interface ActivityItem {
  id: string
  type: 'state' | 'result' | 'output' | 'error'
  agent: string
  content: string
  timestamp: number
}

export interface TeamAgentState {
  status: 'idle' | 'working' | 'blocked' | 'done' | 'waiting'
  task: string | null
  blockers: string[]
  last_update: string | null
}

export interface TeamState {
  version?: number
  project?: string
  stage: 'init' | 'plan' | 'work' | 'review'
  mode: 'scheduled' | 'burst' | 'throttled'
  agents: Record<string, TeamAgentState>
  sprint?: {
    name: string
    started?: string | null
    goals: string[]
  }
  blockers: string[]
  transitions?: Array<{
    from: string
    to: string
    at: string
  }>
}

interface WsState {
  connected: boolean
  agentStates: Record<string, AgentState>
  activityFeed: ActivityItem[]
  currentRunningAgent: string | null
  teamState: TeamState | null

  // Actions
  connect: () => void
  disconnect: () => void
  addActivity: (item: Omit<ActivityItem, 'id'>) => void
  updateAgentState: (agent: string, state: Partial<AgentState>) => void
  fetchTeamState: (projectId: string) => Promise<void>
  setTeamState: (state: TeamState) => void
  removeTeamAgent: (projectId: string, agentName: string) => Promise<void>
}

const MAX_ACTIVITY_ITEMS = 50
let ws: WebSocket | null = null
let reconnectTimeout: number | null = null

export const useWsStore = create<WsState>((set, get) => ({
  connected: false,
  agentStates: {},
  activityFeed: [],
  currentRunningAgent: null,
  teamState: null,

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

  fetchTeamState: async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/team-state`)
      if (res.ok) {
        const data = await res.json()
        set({ teamState: data })
      }
    } catch (err) {
      console.error('Failed to fetch team state:', err)
    }
  },

  setTeamState: (state: TeamState) => {
    set({ teamState: state })
  },

  removeTeamAgent: async (projectId: string, agentName: string) => {
    const res = await fetch(`/api/projects/${projectId}/team-state/agents/${agentName}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.detail || 'Failed to remove agent from team state')
    }
    // Update local state
    set((state) => {
      if (!state.teamState?.agents) return state
      const newAgents = { ...state.teamState.agents }
      delete newAgents[agentName]
      return {
        teamState: {
          ...state.teamState,
          agents: newAgents,
        },
      }
    })
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
      // Agent state change from watcher
      // Message format: { type: "state", data: { current: "agent"|null, last: "agent", status: "success"|"running", completed: timestamp } }
      {
        const stateData = data.data || data
        const agent = stateData.current || stateData.last

        // Skip if no agent name (invalid state)
        if (!agent) break

        // Map status to agent state
        const agentState = stateData.status === 'running' ? 'running' : 'idle'

        updateAgentState(agent, {
          state: agentState,
          run_count: stateData.run_count || 0,
          current_task: stateData.current_task,
          elapsed: stateData.elapsed,
        })
        addActivity({
          type: 'state',
          agent: agent,
          content: `State: ${agentState}${stateData.current_task ? ` - ${stateData.current_task}` : ''}`,
          timestamp: Date.now(),
        })
      }
      break

    case 'result':
      // Tool result from watcher
      // Message format: { type: "result", data: { agent: "...", summary: "...", ... } }
      {
        const resultData = data.data || data
        const agent = resultData.agent
        if (!agent) break

        addActivity({
          type: 'result',
          agent: agent,
          content: resultData.summary || resultData.content || 'Task completed',
          timestamp: Date.now(),
        })
      }
      break

    case 'output':
      // Stream output from watcher
      // Message format: { type: "output", data: { agent: "...", result: "...", ... } }
      {
        const outputData = data.data || data
        const agent = outputData.agent
        if (!agent) break

        addActivity({
          type: 'output',
          agent: agent,
          content: outputData.result || outputData.content || '',
          timestamp: Date.now(),
        })
      }
      break

    case 'error':
      addActivity({
        type: 'error',
        agent: data.agent || 'system',
        content: data.message || 'Unknown error',
        timestamp: Date.now(),
      })
      break

    case 'team_state':
      // Team state update from file watcher
      if (data.state) {
        set(() => ({ teamState: data.state }))
      }
      break

    case 'session_update':
      // Session file was updated - emit event for chatStore to handle
      // We use a custom event since chatStore is separate
      if (data.data?.session_id) {
        window.dispatchEvent(new CustomEvent('session-file-updated', {
          detail: { sessionId: data.data.session_id }
        }))
      }
      break
  }
}
