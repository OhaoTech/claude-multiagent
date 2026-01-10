import { useEffect, useRef } from 'react'
import { X, XCircle, Files, ArrowRight, Copy } from 'lucide-react'

interface TabContextMenuProps {
  x: number
  y: number
  tabPath: string
  onClose: () => void
  onAction: (action: string) => void
}

export function TabContextMenu({ x, y, onClose, onAction }: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  // Adjust position to stay within viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      if (rect.right > viewportWidth) {
        menuRef.current.style.left = `${x - rect.width}px`
      }
      if (rect.bottom > viewportHeight) {
        menuRef.current.style.top = `${y - rect.height}px`
      }
    }
  }, [x, y])

  const menuItems = [
    { label: 'Close', icon: <X size={14} />, action: 'close' },
    { label: 'Close Others', icon: <XCircle size={14} />, action: 'close-others' },
    { label: 'Close All', icon: <Files size={14} />, action: 'close-all' },
    { label: 'Close Saved', icon: <Files size={14} />, action: 'close-saved' },
    { label: 'Close to the Right', icon: <ArrowRight size={14} />, action: 'close-right' },
    { label: 'Copy Path', icon: <Copy size={14} />, action: 'copy-path' },
  ]

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-md shadow-lg py-1"
      style={{ left: x, top: y }}
    >
      {menuItems.map((item, idx) => (
        <button
          key={idx}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[var(--bg-tertiary)]"
          onClick={() => {
            onAction(item.action)
            onClose()
          }}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  )
}
