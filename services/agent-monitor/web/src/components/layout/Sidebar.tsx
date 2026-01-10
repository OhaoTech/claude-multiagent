import { useState } from 'react'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react'
import { useEditorStore } from '../../stores/editorStore'
import type { FileTreeNode } from '../../types'
import { ContextMenu, fileMenuItems, folderMenuItems, emptyMenuItems } from './ContextMenu'
import { InputDialog } from './InputDialog'
import { ConfirmDialog } from './ConfirmDialog'

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  node: FileTreeNode | null
}

interface DialogState {
  type: 'new-file' | 'new-folder' | 'rename' | 'delete' | null
  targetPath: string
  targetName: string
}

interface FileTreeItemProps {
  node: FileTreeNode
  depth?: number
  onContextMenu: (e: React.MouseEvent, node: FileTreeNode) => void
  expandedPaths: Set<string>
  onToggleExpand: (path: string) => void
  onFileOpen?: () => void
}

function FileTreeItem({ node, depth = 0, onContextMenu, expandedPaths, onToggleExpand, onFileOpen }: FileTreeItemProps) {
  const { openFile } = useEditorStore()
  const isOpen = expandedPaths.has(node.path)

  const handleClick = () => {
    if (node.is_dir) {
      onToggleExpand(node.path)
    } else {
      openFile(node.path)
      onFileOpen?.()
    }
  }

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(e, node)
  }

  const gitStatusColor: Record<string, string> = {
    M: 'text-yellow-400',
    A: 'text-green-400',
    D: 'text-red-400',
    U: 'text-orange-400',
    '?': 'text-gray-400',
  }

  return (
    <div>
      <div
        className="flex items-center gap-1 py-0.5 px-2 cursor-pointer hover:bg-[var(--bg-tertiary)] rounded text-sm"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleRightClick}
      >
        {node.is_dir ? (
          <>
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {isOpen ? (
              <FolderOpen size={14} className="text-yellow-500" />
            ) : (
              <Folder size={14} className="text-yellow-500" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <File size={14} className="text-[var(--text-secondary)]" />
          </>
        )}
        <span className={`ml-1 truncate ${node.git_status ? gitStatusColor[node.git_status] : ''}`}>
          {node.name}
        </span>
        {node.git_status && (
          <span className={`ml-auto text-xs ${gitStatusColor[node.git_status]}`}>
            {node.git_status}
          </span>
        )}
      </div>

      {node.is_dir && isOpen && node.children && (
        <div>
          {node.children.map(child => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              onContextMenu={onContextMenu}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              onFileOpen={onFileOpen}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface SidebarProps {
  width: number | string
  onFileOpen?: () => void
}

export function Sidebar({ width, onFileOpen }: SidebarProps) {
  const { fileTree, loading, openFile, createFile, deleteFile, renameFile, currentTreePath, copyToClipboard, pasteFile, clipboard } = useEditorStore()

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    node: null,
  })
  const [dialog, setDialog] = useState<DialogState>({
    type: null,
    targetPath: '',
    targetName: '',
  })

  const handleToggleExpand = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const handleContextMenu = (e: React.MouseEvent, node: FileTreeNode) => {
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      node,
    })
  }

  const handleEmptyAreaContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    // Only show menu if clicking on the empty area itself, not on items
    if (e.target === e.currentTarget) {
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        node: null,
      })
    }
  }

  const closeContextMenu = () => {
    setContextMenu({ visible: false, x: 0, y: 0, node: null })
  }

  const handleMenuAction = async (action: string) => {
    const node = contextMenu.node
    const parentPath = node?.is_dir ? node.path : (node ? node.path.substring(0, node.path.lastIndexOf('/')) : currentTreePath || '')

    switch (action) {
      case 'open':
        if (node && !node.is_dir) {
          openFile(node.path)
          onFileOpen?.()
        }
        break
      case 'copy':
        if (node) {
          copyToClipboard(node.path, node.name, node.is_dir)
        }
        break
      case 'copy-path':
        if (node) {
          navigator.clipboard.writeText(node.path)
        }
        break
      case 'paste':
        if (clipboard) {
          await pasteFile(parentPath)
          // Expand parent folder after paste
          if (parentPath) {
            setExpandedPaths(prev => new Set(prev).add(parentPath))
          }
        }
        break
      case 'new-file':
        setDialog({ type: 'new-file', targetPath: parentPath, targetName: '' })
        break
      case 'new-folder':
        setDialog({ type: 'new-folder', targetPath: parentPath, targetName: '' })
        break
      case 'rename':
        if (node) {
          setDialog({ type: 'rename', targetPath: node.path, targetName: node.name })
        }
        break
      case 'delete':
        if (node) {
          setDialog({ type: 'delete', targetPath: node.path, targetName: node.name })
        }
        break
    }
  }

  const handleDialogConfirm = async (value?: string) => {
    switch (dialog.type) {
      case 'new-file':
        if (value) {
          await createFile(dialog.targetPath, value, false)
          // Expand parent folder
          if (dialog.targetPath) {
            setExpandedPaths(prev => new Set(prev).add(dialog.targetPath))
          }
        }
        break
      case 'new-folder':
        if (value) {
          await createFile(dialog.targetPath, value, true)
          // Expand parent folder
          if (dialog.targetPath) {
            setExpandedPaths(prev => new Set(prev).add(dialog.targetPath))
          }
        }
        break
      case 'rename':
        if (value && value !== dialog.targetName) {
          await renameFile(dialog.targetPath, value)
        }
        break
      case 'delete':
        await deleteFile(dialog.targetPath)
        break
    }
    setDialog({ type: null, targetPath: '', targetName: '' })
  }

  const handleDialogCancel = () => {
    setDialog({ type: null, targetPath: '', targetName: '' })
  }

  const getMenuItems = () => {
    if (!contextMenu.node) return emptyMenuItems
    return contextMenu.node.is_dir ? folderMenuItems : fileMenuItems
  }

  const handleSidebarContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  return (
    <aside
      className="bg-[var(--bg-secondary)] border-r border-[var(--border)] flex flex-col overflow-hidden"
      style={{ width: typeof width === 'number' ? `${width}px` : width }}
      onContextMenu={handleSidebarContextMenu}
    >
      <div className="h-8 flex items-center px-3 text-xs font-semibold uppercase text-[var(--text-secondary)] border-b border-[var(--border)]">
        Explorer
      </div>
      <div
        className="flex-1 overflow-y-auto py-1"
        onContextMenu={handleEmptyAreaContextMenu}
      >
        {loading ? (
          <div className="p-3 text-sm text-[var(--text-secondary)]">Loading...</div>
        ) : fileTree.length === 0 ? (
          <div className="p-3 text-sm text-[var(--text-secondary)]">
            No project selected
          </div>
        ) : (
          fileTree.map(node => (
            <FileTreeItem
              key={node.path}
              node={node}
              onContextMenu={handleContextMenu}
              expandedPaths={expandedPaths}
              onToggleExpand={handleToggleExpand}
              onFileOpen={onFileOpen}
            />
          ))
        )}
      </div>

      {/* Context Menu */}
      {contextMenu.visible && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getMenuItems()}
          onAction={handleMenuAction}
          onClose={closeContextMenu}
        />
      )}

      {/* Input Dialogs */}
      {dialog.type === 'new-file' && (
        <InputDialog
          title="New File"
          placeholder="filename.ext"
          onConfirm={handleDialogConfirm}
          onCancel={handleDialogCancel}
        />
      )}
      {dialog.type === 'new-folder' && (
        <InputDialog
          title="New Folder"
          placeholder="folder name"
          onConfirm={handleDialogConfirm}
          onCancel={handleDialogCancel}
        />
      )}
      {dialog.type === 'rename' && (
        <InputDialog
          title="Rename"
          placeholder="new name"
          initialValue={dialog.targetName}
          onConfirm={handleDialogConfirm}
          onCancel={handleDialogCancel}
        />
      )}

      {/* Confirm Dialog */}
      {dialog.type === 'delete' && (
        <ConfirmDialog
          title="Delete"
          message={`Are you sure you want to delete "${dialog.targetName}"?`}
          onConfirm={() => handleDialogConfirm()}
          onCancel={handleDialogCancel}
        />
      )}
    </aside>
  )
}
