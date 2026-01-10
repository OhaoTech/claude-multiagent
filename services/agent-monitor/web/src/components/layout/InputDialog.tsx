import { useEffect, useRef, useState } from 'react'

interface InputDialogProps {
  title: string
  placeholder: string
  initialValue?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function InputDialog({ title, placeholder, initialValue = '', onConfirm, onCancel }: InputDialogProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onCancel])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (value.trim()) {
      onConfirm(value.trim())
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl w-80">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-medium">{title}</h3>
        </div>
        <form onSubmit={handleSubmit} className="p-4">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-sm focus:outline-none focus:border-[var(--accent)]"
          />
          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-sm rounded hover:bg-[var(--bg-tertiary)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="px-3 py-1.5 text-sm bg-[var(--accent)] rounded hover:opacity-90 disabled:opacity-50"
            >
              OK
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
