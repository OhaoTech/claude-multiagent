import { useEffect } from 'react'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl w-80">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-medium">{title}</h3>
        </div>
        <div className="p-4">
          <p className="text-sm text-[var(--text-secondary)]">{message}</p>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-sm rounded hover:bg-[var(--bg-tertiary)]"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className={`px-3 py-1.5 text-sm rounded ${
                danger
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-[var(--accent)] hover:opacity-90'
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
