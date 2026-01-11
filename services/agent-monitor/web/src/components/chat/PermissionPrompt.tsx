import { Shield, AlertCircle } from 'lucide-react'

interface PermissionPromptProps {
  prompt: string
  tool?: string
  action?: string
  options: string[]
  onRespond: (response: string) => void
}

export function PermissionPrompt({
  prompt,
  tool,
  action,
  options,
  onRespond,
}: PermissionPromptProps) {
  return (
    <div className="bg-amber-900/30 border border-amber-600/50 rounded-lg p-4 mx-3 mb-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-amber-600 flex items-center justify-center flex-shrink-0">
          <Shield size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle size={16} className="text-amber-400" />
            <span className="font-medium text-amber-200">Permission Required</span>
          </div>

          {tool && (
            <div className="text-sm text-amber-100 mb-2">
              <span className="font-medium">{tool}</span>
              {action && <span className="text-amber-300"> wants to {action}</span>}
            </div>
          )}

          <p className="text-sm text-[var(--text-secondary)] mb-3 break-words whitespace-pre-wrap">
            {prompt}
          </p>

          <div className="flex flex-wrap gap-2">
            {options.map((option) => (
              <button
                key={option}
                onClick={() => onRespond(option)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  option.toLowerCase() === 'yes' || option.toLowerCase() === 'y' || option === 'Continue'
                    ? 'bg-green-600 hover:bg-green-500 text-white'
                    : option.toLowerCase() === 'no' || option.toLowerCase() === 'n'
                    ? 'bg-red-600/50 hover:bg-red-500/50 text-red-200'
                    : 'bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] border border-[var(--border)]'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
