import { useCallback, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  MarkerType,
  Panel,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import { RefreshCw } from 'lucide-react'

import { AgentNode, type AgentNodeData } from './AgentNode'
import { useWsStore, type TeamState } from '../../stores/wsStore'
import { useProjectStore } from '../../stores/projectStore'

// Custom node types
const nodeTypes = {
  agent: AgentNode,
}

// Dagre layout configuration
const dagreGraph = new dagre.graphlib.Graph()
dagreGraph.setDefaultEdgeLabel(() => ({}))

const NODE_WIDTH = 160
const NODE_HEIGHT = 100

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction = 'TB'
): { nodes: Node[]; edges: Edge[] } {
  const isHorizontal = direction === 'LR'
  dagreGraph.setGraph({ rankdir: direction, nodesep: 50, ranksep: 80 })

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  })

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2,
      },
      targetPosition: isHorizontal ? 'left' : 'top',
      sourcePosition: isHorizontal ? 'right' : 'bottom',
    } as Node
  })

  return { nodes: layoutedNodes, edges }
}

// Convert team state to nodes and edges
function buildGraph(
  teamState: TeamState | null,
  dbAgents: Array<{ name: string; domain: string; is_leader: boolean }>
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const agentNames = new Set<string>()

  // Add agents from database
  dbAgents.forEach((agent) => {
    agentNames.add(agent.name)
    const teamAgent = teamState?.agents?.[agent.name]

    const nodeData: AgentNodeData = {
      label: agent.name,
      status: (teamAgent?.status as AgentNodeData['status']) || 'idle',
      task: teamAgent?.task || undefined,
      isLeader: agent.is_leader,
      domain: agent.domain,
      blockers: teamAgent?.blockers || [],
    }

    nodes.push({
      id: agent.name,
      type: 'agent',
      position: { x: 0, y: 0 },
      data: nodeData,
    })
  })

  // Add agents from team state that aren't in database
  if (teamState?.agents) {
    Object.entries(teamState.agents).forEach(([name, agent]) => {
      if (!agentNames.has(name)) {
        agentNames.add(name)

        const nodeData: AgentNodeData = {
          label: name,
          status: (agent.status as AgentNodeData['status']) || 'idle',
          task: agent.task || undefined,
          isLeader: name === 'leader',
          blockers: agent.blockers || [],
        }

        nodes.push({
          id: name,
          type: 'agent',
          position: { x: 0, y: 0 },
          data: nodeData,
        })
      }
    })
  }

  // Generate edges from blockers
  if (teamState?.agents) {
    Object.entries(teamState.agents).forEach(([name, agent]) => {
      if (agent.blockers && agent.blockers.length > 0) {
        agent.blockers.forEach((blocker) => {
          // Try to extract agent name from blocker string
          // Common patterns: "Waiting for api", "Waiting for api to finish", "api"
          const blockerMatch = blocker.match(/(?:waiting for |depends on )?(\w+)/i)
          if (blockerMatch) {
            const blockerAgent = blockerMatch[1].toLowerCase()
            if (agentNames.has(blockerAgent) && blockerAgent !== name) {
              edges.push({
                id: `${blockerAgent}-to-${name}`,
                source: blockerAgent,
                target: name,
                type: 'smoothstep',
                animated: true,
                style: { stroke: '#f97316', strokeWidth: 2 },
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  color: '#f97316',
                },
                label: 'waiting',
                labelStyle: { fill: '#f97316', fontSize: 10 },
                labelBgStyle: { fill: 'var(--bg-tertiary)' },
              })
            }
          }
        })
      }
    })
  }

  // Add edges from leader to all other agents (hierarchy)
  const leaderNode = nodes.find((n) => (n.data as AgentNodeData).isLeader)
  if (leaderNode) {
    nodes.forEach((node) => {
      const nodeData = node.data as AgentNodeData
      if (!nodeData.isLeader && node.id !== leaderNode.id) {
        // Check if there isn't already an edge
        const hasEdge = edges.some(
          (e) =>
            (e.source === leaderNode.id && e.target === node.id) ||
            (e.source === node.id && e.target === leaderNode.id)
        )
        if (!hasEdge) {
          edges.push({
            id: `${leaderNode.id}-to-${node.id}`,
            source: leaderNode.id,
            target: node.id,
            type: 'smoothstep',
            style: { stroke: 'var(--border)', strokeWidth: 1, strokeDasharray: '5 5' },
          })
        }
      }
    })
  }

  return getLayoutedElements(nodes, edges)
}

interface TeamNetworkViewProps {
  onAgentSelect?: (agentName: string | null) => void
  selectedAgent?: string | null
}

export function TeamNetworkView({ onAgentSelect, selectedAgent }: TeamNetworkViewProps) {
  const { teamState, fetchTeamState } = useWsStore()
  const { activeProject, agents: dbAgents } = useProjectStore()

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  // Fetch team state on mount and when project changes
  useEffect(() => {
    if (activeProject?.id) {
      fetchTeamState(activeProject.id)
    }
  }, [activeProject?.id, fetchTeamState])

  // Rebuild graph when team state or agents change
  useEffect(() => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = buildGraph(
      teamState,
      dbAgents.map((a) => ({ name: a.name, domain: a.domain, is_leader: a.is_leader }))
    )
    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
  }, [teamState, dbAgents, setNodes, setEdges])

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onAgentSelect?.(node.id === selectedAgent ? null : node.id)
    },
    [onAgentSelect, selectedAgent]
  )

  const handleRefresh = useCallback(() => {
    if (activeProject?.id) {
      fetchTeamState(activeProject.id)
    }
  }, [activeProject?.id, fetchTeamState])

  // Stage and mode display
  const stageLabel = teamState?.stage?.toUpperCase() || 'INIT'
  const modeLabel = teamState?.mode || 'scheduled'

  return (
    <div className="h-full w-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.5}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep',
        }}
      >
        <Background color="var(--border)" gap={20} />
        <Controls className="!bg-[var(--bg-tertiary)] !border-[var(--border)] !rounded" />
        <MiniMap
          className="!bg-[var(--bg-tertiary)] !border-[var(--border)]"
          nodeColor={(n) => {
            const nodeData = n.data as AgentNodeData
            const status = nodeData?.status
            switch (status) {
              case 'working':
                return '#22c55e'
              case 'blocked':
                return '#ef4444'
              case 'waiting':
                return '#f97316'
              case 'done':
                return '#3b82f6'
              default:
                return '#6b7280'
            }
          }}
        />

        {/* Status Panel */}
        <Panel position="top-left" className="bg-[var(--bg-tertiary)] rounded-lg p-3 border border-[var(--border)]">
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="text-[var(--text-secondary)]">Stage:</span>{' '}
              <span className="font-semibold text-[var(--accent)]">{stageLabel}</span>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">Mode:</span>{' '}
              <span className="font-medium">{modeLabel}</span>
            </div>
            <button
              onClick={handleRefresh}
              className="p-1.5 hover:bg-[var(--bg-secondary)] rounded transition-colors"
              title="Refresh team state"
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {/* Sprint info */}
          {teamState?.sprint?.name && (
            <div className="mt-2 text-xs text-[var(--text-secondary)]">
              Sprint: {teamState.sprint.name}
            </div>
          )}
        </Panel>

        {/* Legend */}
        <Panel position="bottom-left" className="bg-[var(--bg-tertiary)] rounded-lg p-2 border border-[var(--border)]">
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-gray-500" />
              <span>Idle</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span>Working</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              <span>Waiting</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span>Blocked</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span>Done</span>
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}
