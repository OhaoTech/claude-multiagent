import { useEffect, useRef } from 'react'
import { File, FolderPlus, Pencil, Trash2, FileText, Copy, Clipboard, Link } from 'lucide-react'

export interface ContextMenuItem {
  label: string
  icon: React.ReactNode
  action: string
  danger?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onAction: (action: string) => void
  onClose: () => void
}

export function ContextMenu({ x, y, items, onAction, onClose }: ContextMenuProps) {
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

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-md shadow-lg py-1"
      style={{ left: x, top: y }}
    >
      {items.map((item, idx) => (
        <button
          key={idx}
          className={`
            w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left
            ${item.danger ? 'text-red-400 hover:bg-red-900/30' : 'hover:bg-[var(--bg-tertiary)]'}
          `}
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

// Pre-defined menu items for different contexts
export const fileMenuItems: ContextMenuItem[] = [
  { label: 'Open', icon: <FileText size={14} />, action: 'open' },
  { label: 'Copy', icon: <Copy size={14} />, action: 'copy' },
  { label: 'Copy Path', icon: <Link size={14} />, action: 'copy-path' },
  { label: 'Rename', icon: <Pencil size={14} />, action: 'rename' },
  { label: 'Delete', icon: <Trash2 size={14} />, action: 'delete', danger: true },
]

export const folderMenuItems: ContextMenuItem[] = [
  { label: 'New File', icon: <File size={14} />, action: 'new-file' },
  { label: 'New Folder', icon: <FolderPlus size={14} />, action: 'new-folder' },
  { label: 'Copy Path', icon: <Link size={14} />, action: 'copy-path' },
  { label: 'Paste', icon: <Clipboard size={14} />, action: 'paste' },
  { label: 'Rename', icon: <Pencil size={14} />, action: 'rename' },
  { label: 'Delete', icon: <Trash2 size={14} />, action: 'delete', danger: true },
]

export const emptyMenuItems: ContextMenuItem[] = [
  { label: 'New File', icon: <File size={14} />, action: 'new-file' },
  { label: 'New Folder', icon: <FolderPlus size={14} />, action: 'new-folder' },
  { label: 'Paste', icon: <Clipboard size={14} />, action: 'paste' },
]
