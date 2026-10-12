import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import Bold from '@tiptap/extension-bold'
import Document from '@tiptap/extension-document'
import HardBreak from '@tiptap/extension-hard-break'
import Highlight from '@tiptap/extension-highlight'
import History from '@tiptap/extension-history'
import Italic from '@tiptap/extension-italic'
import Paragraph from '@tiptap/extension-paragraph'
import Placeholder from '@tiptap/extension-placeholder'
import Text from '@tiptap/extension-text'
import Underline from '@tiptap/extension-underline'
import { TextStyle, FontSize } from '@tiptap/extension-text-style'
import { isDiaryHtml, sanitizeDiaryHtml } from '../diaryHtml'

const HIGHLIGHT_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#ddd6fe', '#fed7aa', '#fecaca', '#f1f5f9']

const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20]
const DEFAULT_FONT_SIZE = 16

const EXTENSIONS = [
  Document,
  Paragraph,
  Text,
  Bold,
  Italic,
  Underline,
  Highlight.configure({ multicolor: true }),
  HardBreak,
  History,
  TextStyle,
  FontSize,
  Placeholder.configure({ placeholder: 'Заметка в дневник…' })
]

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function toEditorContent(content: string): string {
  if (isDiaryHtml(content)) return sanitizeDiaryHtml(content)
  const escaped = escapeText(content)
  if (escaped === '') return ''
  const paragraphs = escaped.split(/\n{2,}/).map((part) => part.replace(/\n/g, '<br>'))
  return `<p>${paragraphs.join('</p><p>')}</p>`
}

interface DiaryEditorProps {
  initialContent: string
  onChange: (html: string) => void
  ariaLabel: string
  autofocus?: boolean
}

function ToolbarButton({
  glyph,
  label,
  active,
  onClick
}: {
  glyph: ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`select-none rounded-md px-2.5 py-1 text-sm transition ${
        active ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400 hover:bg-slate-700/40 hover:text-slate-200'
      }`}
    >
      {glyph}
    </button>
  )
}

function Divider() {
  return <div role="presentation" aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-slate-700/60" />
}

const EMPTY_TOOLBAR = { bold: false, italic: false, underline: false, highlight: false, highlightColor: null, fontSize: null }

export function DiaryEditor({ initialContent, onChange, ariaLabel, autofocus = false }: DiaryEditorProps) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    content: toEditorContent(initialContent),
    autofocus,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': ariaLabel,
        class: 'min-h-[44px] w-full px-3 pb-2 pt-0.5 text-base leading-relaxed text-slate-100 outline-none focus:outline-none'
      }
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML())
  })

  const toolbar = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive('bold'),
            italic: editor.isActive('italic'),
            underline: editor.isActive('underline'),
            highlight: editor.isActive('highlight'),
            highlightColor: editor.getAttributes('highlight').color ?? null,
            fontSize: editor.getAttributes('textStyle').fontSize ?? null
          }
        : EMPTY_TOOLBAR
  })

  const [markerColor, setMarkerColor] = useState(HIGHLIGHT_COLORS[0] ?? '#fef08a')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const highlightWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!paletteOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (highlightWrapRef.current && !highlightWrapRef.current.contains(event.target as Node)) setPaletteOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPaletteOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [paletteOpen])

  if (!editor) return null

  const fontSizeValue = toolbar.fontSize ? String(parseInt(toolbar.fontSize, 10) || DEFAULT_FONT_SIZE) : String(DEFAULT_FONT_SIZE)

  const applyFontSize = (value: string) => {
    if (value === String(DEFAULT_FONT_SIZE)) {
      editor.chain().focus().unsetFontSize().run()
    } else {
      editor.chain().focus().setFontSize(`${value}px`).run()
    }
  }

  const toggleHighlight = () => {
    if (editor.isActive('highlight')) {
      editor.chain().focus().unsetHighlight().run()
    } else {
      editor.chain().focus().setHighlight({ color: markerColor }).run()
    }
  }

  const applyHighlight = (color: string) => {
    setMarkerColor(color)
    editor.chain().focus().setHighlight({ color }).run()
    setPaletteOpen(false)
  }

  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-950/60 transition focus-within:border-indigo-400/70">
      <div role="toolbar" aria-label="Форматирование" className="flex flex-wrap items-center gap-0.5 border-b border-slate-800/60 px-2 py-1.5">
        <ToolbarButton glyph={<span className="font-bold">B</span>} label="Жирный" active={toolbar.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolbarButton glyph={<span className="italic">I</span>} label="Курсив" active={toolbar.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <ToolbarButton glyph={<span className="underline underline-offset-2">U</span>} label="Подчёркнутый" active={toolbar.underline} onClick={() => editor.chain().focus().toggleUnderline().run()} />

        <Divider />

        <select
          aria-label="Размер шрифта"
          title="Размер шрифта"
          value={fontSizeValue}
          onChange={(event) => applyFontSize(event.target.value)}
          className="cursor-pointer rounded-md border border-slate-700/70 bg-slate-900/70 px-1.5 py-1 text-xs tabular-nums text-slate-300 outline-none transition hover:bg-slate-800 focus:border-indigo-400/70"
        >
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>

        <Divider />

        <div ref={highlightWrapRef} className="relative">
          <div className="flex items-center overflow-hidden rounded-md border border-slate-700/70">
            <button
              type="button"
              aria-label="Выделить маркером"
              title="Выделить маркером"
              aria-pressed={toolbar.highlight}
              onClick={toggleHighlight}
              className={`select-none px-2.5 py-1 text-sm transition ${
                toolbar.highlight ? 'bg-yellow-300/15 text-yellow-100' : 'text-slate-400 hover:bg-slate-700/40 hover:text-slate-200'
              }`}
            >
              <span className="rounded-sm bg-yellow-200/60 px-1">M</span>
            </button>
            <button
              type="button"
              aria-label="Палитра маркера"
              title="Палитра маркера"
              aria-haspopup="menu"
              aria-expanded={paletteOpen}
              onClick={() => setPaletteOpen((open) => !open)}
              className={`flex items-center border-l border-slate-700/70 px-1 py-1.5 text-slate-400 transition hover:bg-slate-700/40 hover:text-slate-200 ${
                paletteOpen ? 'bg-slate-700/40 text-slate-200' : ''
              }`}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>

          {paletteOpen && (
            <div role="menu" aria-label="Цвета маркера" className="absolute left-0 top-full z-20 mt-1 w-36 rounded-lg border border-slate-700/70 bg-slate-900 p-2 shadow-xl">
              <div className="grid grid-cols-4 gap-1">
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    role="menuitem"
                    aria-label={`Маркер ${color}`}
                    onClick={() => applyHighlight(color)}
                    className={`h-5 w-8 rounded-md border transition hover:scale-110 ${
                      toolbar.highlight && toolbar.highlightColor === color ? 'border-white/70 ring-1 ring-white/50' : 'border-white/10'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  editor.chain().focus().unsetHighlight().run()
                  setPaletteOpen(false)
                }}
                className="mt-1.5 w-full rounded-md px-2 py-1 text-left text-xs text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
              >
                Убрать маркер
              </button>
            </div>
          )}
        </div>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
