import { useEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'

interface CodeEditorProps {
  content: string
  language: string
  onChange: (content: string) => void
  onSave?: () => void
}

function getLanguageExtension(language: string): Extension {
  switch (language) {
    case 'javascript':
      return javascript({ jsx: true, typescript: false })
    case 'typescript':
      return javascript({ jsx: true, typescript: true })
    case 'python':
      return python()
    case 'json':
      return json()
    case 'html':
      return html()
    case 'css':
      return css()
    case 'markdown':
      return markdown()
    default:
      return []
  }
}

export function CodeEditor({ content, language, onChange, onSave }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const contentRef = useRef(content)

  useEffect(() => {
    if (!containerRef.current) return

    // Create update listener that calls onChange
    const updateListener = EditorView.updateListener.of(update => {
      if (update.docChanged) {
        const newContent = update.state.doc.toString()
        contentRef.current = newContent
        onChange(newContent)
      }
    })

    // Create save keymap
    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          onSave?.()
          return true
        },
      },
    ])

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        indentWithTab,
      ] as any),
      getLanguageExtension(language),
      oneDark,
      updateListener,
      saveKeymap,
      EditorView.theme({
        '&': { height: '100%', width: '100%' },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-content': { minWidth: '0' },
      }),
      EditorView.lineWrapping,
    ]

    const state = EditorState.create({
      doc: content,
      extensions,
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view
    contentRef.current = content

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [language]) // Component remounts via key prop when file changes

  // Sync content when it changes from outside (e.g., switching tabs)
  useEffect(() => {
    if (viewRef.current && content !== contentRef.current) {
      const currentDoc = viewRef.current.state.doc.toString()
      if (currentDoc !== content) {
        viewRef.current.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: content },
        })
        contentRef.current = content
      }
    }
  }, [content])

  return <div ref={containerRef} className="h-full w-full" />
}
