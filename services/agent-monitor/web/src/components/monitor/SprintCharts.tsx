import { useEffect, useState } from 'react'
import {
  TrendingDown,
  Zap,
  RefreshCw,
  Info
} from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'

interface BurndownPoint {
  date: string
  remaining: number
  ideal: number
  completed: number
}

interface VelocityPoint {
  sprint_id: string
  sprint_name: string
  status: string
  start_date: string | null
  end_date: string | null
  total_tasks: number
  completed_tasks: number
  velocity: number
}

interface SprintChartsProps {
  sprintId?: string
}

export function SprintCharts({ sprintId }: SprintChartsProps) {
  const { activeProject } = useProjectStore()
  const [burndown, setBurndown] = useState<BurndownPoint[]>([])
  const [velocity, setVelocity] = useState<VelocityPoint[]>([])
  const [loading, setLoading] = useState(true)

  const fetchChartData = async () => {
    if (!activeProject) return
    setLoading(true)

    try {
      // Fetch velocity data
      const velRes = await fetch(`/api/projects/${activeProject.id}/velocity`)
      if (velRes.ok) {
        setVelocity(await velRes.json())
      }

      // Fetch burndown if sprint selected
      if (sprintId) {
        const burnRes = await fetch(`/api/projects/${activeProject.id}/sprints/${sprintId}/burndown`)
        if (burnRes.ok) {
          setBurndown(await burnRes.json())
        }
      } else {
        setBurndown([])
      }
    } catch (err) {
      console.error('Failed to fetch chart data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchChartData()
  }, [activeProject?.id, sprintId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-[var(--text-secondary)]" />
      </div>
    )
  }

  return (
    <div className="p-4 space-y-6 overflow-y-auto max-h-full">
      {/* Burndown Chart */}
      {sprintId && burndown.length > 0 ? (
        <BurndownChart data={burndown} />
      ) : sprintId ? (
        <div className="bg-[var(--bg-tertiary)] rounded-lg p-4">
          <h3 className="text-sm font-medium flex items-center gap-2 mb-2">
            <TrendingDown size={16} className="text-blue-400" />
            Burndown Chart
          </h3>
          <div className="text-center text-[var(--text-secondary)] py-8">
            No tasks in this sprint yet
          </div>
        </div>
      ) : (
        <div className="bg-[var(--bg-tertiary)] rounded-lg p-4">
          <h3 className="text-sm font-medium flex items-center gap-2 mb-2">
            <TrendingDown size={16} className="text-blue-400" />
            Burndown Chart
          </h3>
          <div className="text-center text-[var(--text-secondary)] py-8">
            <Info size={24} className="mx-auto mb-2 opacity-50" />
            Select a sprint to view burndown
          </div>
        </div>
      )}

      {/* Velocity Chart */}
      <VelocityChart data={velocity} />
    </div>
  )
}

function BurndownChart({ data }: { data: BurndownPoint[] }) {
  if (data.length === 0) return null

  const maxRemaining = Math.max(...data.map(d => Math.max(d.remaining, d.ideal)))
  const chartWidth = 400
  const chartHeight = 200
  const padding = { top: 20, right: 20, bottom: 30, left: 40 }
  const innerWidth = chartWidth - padding.left - padding.right
  const innerHeight = chartHeight - padding.top - padding.bottom

  const xScale = (i: number) => padding.left + (i / Math.max(1, data.length - 1)) * innerWidth
  const yScale = (v: number) => padding.top + innerHeight - (v / Math.max(1, maxRemaining)) * innerHeight

  // Build paths
  const idealPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.ideal)}`).join(' ')
  const actualPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.remaining)}`).join(' ')

  return (
    <div className="bg-[var(--bg-tertiary)] rounded-lg p-4">
      <h3 className="text-sm font-medium flex items-center gap-2 mb-3">
        <TrendingDown size={16} className="text-blue-400" />
        Burndown Chart
      </h3>

      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => (
          <line
            key={pct}
            x1={padding.left}
            y1={yScale(maxRemaining * pct)}
            x2={chartWidth - padding.right}
            y2={yScale(maxRemaining * pct)}
            stroke="var(--border)"
            strokeDasharray="2,2"
          />
        ))}

        {/* Ideal line (dashed gray) */}
        <path
          d={idealPath}
          fill="none"
          stroke="var(--text-secondary)"
          strokeWidth="2"
          strokeDasharray="5,5"
          opacity="0.5"
        />

        {/* Actual line (solid blue) */}
        <path
          d={actualPath}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
        />

        {/* Data points */}
        {data.map((d, i) => (
          <circle
            key={i}
            cx={xScale(i)}
            cy={yScale(d.remaining)}
            r="3"
            fill="#3b82f6"
          />
        ))}

        {/* Y-axis labels */}
        <text x={padding.left - 5} y={yScale(maxRemaining)} textAnchor="end" fill="var(--text-secondary)" fontSize="10">
          {maxRemaining}
        </text>
        <text x={padding.left - 5} y={yScale(0)} textAnchor="end" fill="var(--text-secondary)" fontSize="10">
          0
        </text>

        {/* X-axis labels (first and last date) */}
        <text x={xScale(0)} y={chartHeight - 8} textAnchor="start" fill="var(--text-secondary)" fontSize="10">
          {formatDate(data[0].date)}
        </text>
        <text x={xScale(data.length - 1)} y={chartHeight - 8} textAnchor="end" fill="var(--text-secondary)" fontSize="10">
          {formatDate(data[data.length - 1].date)}
        </text>
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-xs text-[var(--text-secondary)]">
        <div className="flex items-center gap-1">
          <div className="w-4 h-0.5 bg-blue-500" />
          <span>Remaining</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-0.5 bg-[var(--text-secondary)] opacity-50" style={{ borderStyle: 'dashed' }} />
          <span>Ideal</span>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
        <div className="bg-[var(--bg-secondary)] rounded p-2 text-center">
          <div className="text-lg font-bold text-blue-400">{data[0]?.remaining || 0}</div>
          <div className="text-[var(--text-secondary)]">Started</div>
        </div>
        <div className="bg-[var(--bg-secondary)] rounded p-2 text-center">
          <div className="text-lg font-bold text-green-400">{data[data.length - 1]?.completed || 0}</div>
          <div className="text-[var(--text-secondary)]">Completed</div>
        </div>
        <div className="bg-[var(--bg-secondary)] rounded p-2 text-center">
          <div className="text-lg font-bold text-yellow-400">{data[data.length - 1]?.remaining || 0}</div>
          <div className="text-[var(--text-secondary)]">Remaining</div>
        </div>
      </div>
    </div>
  )
}

function VelocityChart({ data }: { data: VelocityPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="bg-[var(--bg-tertiary)] rounded-lg p-4">
        <h3 className="text-sm font-medium flex items-center gap-2 mb-2">
          <Zap size={16} className="text-yellow-400" />
          Velocity Chart
        </h3>
        <div className="text-center text-[var(--text-secondary)] py-8">
          <Info size={24} className="mx-auto mb-2 opacity-50" />
          No completed sprints yet
        </div>
      </div>
    )
  }

  const maxVelocity = Math.max(...data.map(d => d.velocity), 1)
  const avgVelocity = data.length > 0
    ? Math.round(data.reduce((sum, d) => sum + d.velocity, 0) / data.length)
    : 0

  const chartWidth = 400
  const chartHeight = 180
  const padding = { top: 20, right: 20, bottom: 40, left: 40 }
  const innerWidth = chartWidth - padding.left - padding.right
  const innerHeight = chartHeight - padding.top - padding.bottom

  const barWidth = Math.min(40, (innerWidth / data.length) * 0.7)
  const barGap = (innerWidth - barWidth * data.length) / (data.length + 1)

  const xScale = (i: number) => padding.left + barGap + i * (barWidth + barGap)
  const yScale = (v: number) => padding.top + innerHeight - (v / maxVelocity) * innerHeight
  const barHeight = (v: number) => (v / maxVelocity) * innerHeight

  return (
    <div className="bg-[var(--bg-tertiary)] rounded-lg p-4">
      <h3 className="text-sm font-medium flex items-center gap-2 mb-3">
        <Zap size={16} className="text-yellow-400" />
        Velocity Chart
        <span className="text-xs text-[var(--text-secondary)] font-normal ml-2">
          Avg: {avgVelocity} tasks/sprint
        </span>
      </h3>

      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto">
        {/* Grid lines */}
        {[0, 0.5, 1].map(pct => (
          <line
            key={pct}
            x1={padding.left}
            y1={yScale(maxVelocity * pct)}
            x2={chartWidth - padding.right}
            y2={yScale(maxVelocity * pct)}
            stroke="var(--border)"
            strokeDasharray="2,2"
          />
        ))}

        {/* Average line */}
        <line
          x1={padding.left}
          y1={yScale(avgVelocity)}
          x2={chartWidth - padding.right}
          y2={yScale(avgVelocity)}
          stroke="#eab308"
          strokeWidth="1"
          strokeDasharray="5,3"
        />

        {/* Bars */}
        {data.map((d, i) => (
          <g key={d.sprint_id}>
            {/* Background bar (total tasks) */}
            <rect
              x={xScale(i)}
              y={yScale(d.total_tasks)}
              width={barWidth}
              height={barHeight(d.total_tasks)}
              fill="var(--bg-secondary)"
              rx="2"
            />
            {/* Completed bar */}
            <rect
              x={xScale(i)}
              y={yScale(d.velocity)}
              width={barWidth}
              height={barHeight(d.velocity)}
              fill={d.status === 'active' ? '#3b82f6' : '#22c55e'}
              rx="2"
            />
            {/* Value label */}
            <text
              x={xScale(i) + barWidth / 2}
              y={yScale(d.velocity) - 5}
              textAnchor="middle"
              fill="var(--text-primary)"
              fontSize="10"
              fontWeight="bold"
            >
              {d.velocity}
            </text>
            {/* Sprint name */}
            <text
              x={xScale(i) + barWidth / 2}
              y={chartHeight - 10}
              textAnchor="middle"
              fill="var(--text-secondary)"
              fontSize="9"
              transform={`rotate(-20, ${xScale(i) + barWidth / 2}, ${chartHeight - 10})`}
            >
              {d.sprint_name.length > 10 ? d.sprint_name.slice(0, 10) + '...' : d.sprint_name}
            </text>
          </g>
        ))}

        {/* Y-axis labels */}
        <text x={padding.left - 5} y={yScale(maxVelocity)} textAnchor="end" fill="var(--text-secondary)" fontSize="10">
          {maxVelocity}
        </text>
        <text x={padding.left - 5} y={yScale(0)} textAnchor="end" fill="var(--text-secondary)" fontSize="10">
          0
        </text>
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-xs text-[var(--text-secondary)]">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-green-500 rounded" />
          <span>Completed</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-blue-500 rounded" />
          <span>Active</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-[var(--bg-secondary)] rounded" />
          <span>Total Tasks</span>
        </div>
      </div>
    </div>
  )
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
