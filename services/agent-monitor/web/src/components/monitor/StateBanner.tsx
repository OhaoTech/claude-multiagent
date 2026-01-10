import { useEffect, useState } from 'react'
import { Play, Clock } from 'lucide-react'
import { useWsStore } from '../../stores/wsStore'

export function StateBanner() {
  const { currentRunningAgent, agentStates } = useWsStore()
  const [elapsed, setElapsed] = useState(0)

  const runningState = currentRunningAgent ? agentStates[currentRunningAgent] : null

  useEffect(() => {
    if (!runningState || runningState.state !== 'running') {
      setElapsed(0)
      return
    }

    const startTime = Date.now() - (runningState.elapsed || 0)
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    return () => clearInterval(interval)
  }, [runningState])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (!runningState || runningState.state !== 'running') {
    return (
      <div className="px-4 py-3 bg-[var(--bg-tertiary)] border-b border-[var(--border)]">
        <div className="flex items-center gap-2 text-[var(--text-secondary)]">
          <div className="w-2 h-2 rounded-full bg-gray-500" />
          <span className="text-sm">All agents idle</span>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 bg-green-900/20 border-b border-green-800/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Play size={16} className="text-green-500" />
            <span className="font-medium text-green-400">{currentRunningAgent}</span>
          </div>
          {runningState.current_task && (
            <>
              <span className="text-[var(--text-secondary)]">|</span>
              <span className="text-sm text-[var(--text-secondary)] truncate max-w-[300px]">
                {runningState.current_task}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
          <Clock size={14} />
          <span>{formatTime(elapsed)}</span>
        </div>
      </div>
    </div>
  )
}
