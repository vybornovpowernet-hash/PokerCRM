import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import type { ChecklistStatus } from '../goals.types'

interface ChecklistStatusMenuProps {
  x: number
  anchorTop: number
  anchorBottom: number
  text: string
  status: ChecklistStatus
  onSelect: (status: ChecklistStatus) => void
  onClose: () => void
}

function CheckGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12 5 5L20 7" />
    </svg>
  )
}

function CrossGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function ClearGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
    </svg>
  )
}

interface Option {
  status: ChecklistStatus
  label: string
  active: string
  glyph: ReactNode
}

const OPTIONS: Option[] = [
  { status: 'completed', label: 'Выполнено', active: 'bg-emerald-500/10 text-emerald-300', glyph: <CheckGlyph /> },
  { status: 'failed', label: 'Провалено', active: 'bg-rose-500/10 text-rose-300', glyph: <CrossGlyph /> },
  { status: 'pending', label: 'Очистить', active: 'bg-slate-600/40 text-slate-200', glyph: <ClearGlyph /> }
]

const GAP = 6
const EDGE = 8

// The card uses `backdrop-blur`, which turns it into the containing block for
// `position: fixed` descendants and clips them with `overflow-hidden`. The menu
// is therefore portalled to `document.body` and measured after mount so it
// always lands inside the viewport, flipping above the square when needed.
export function ChecklistStatusMenu({ x, anchorTop, anchorBottom, text, status, onSelect, onClose }: ChecklistStatusMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const left = Math.max(EDGE, Math.min(x, Math.max(EDGE, window.innerWidth - width - EDGE)))
    const down = anchorBottom + GAP
    const top = down + height + EDGE <= window.innerHeight ? down : Math.max(EDGE, anchorTop - height - GAP)
    setPos({ left, top })
  }, [x, anchorTop, anchorBottom])

  const options = status === 'pending' ? OPTIONS.filter((opt) => opt.status !== 'pending') : OPTIONS

  return createPortal(
    <motion.div
      ref={ref}
      role="menu"
      aria-label={`Статус пункта «${text}»`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12 }}
      className="fixed z-50 w-44 rounded-xl border border-slate-600 bg-slate-800 p-1.5 shadow-xl shadow-black/50"
      style={{ left: pos?.left ?? x, top: pos?.top ?? anchorBottom + GAP, visibility: pos ? 'visible' : 'hidden' }}
    >
      <div className="truncate px-2 py-1.5 text-xs font-medium text-slate-400">{text}</div>
      <div className="flex flex-col gap-0.5">
        {options.map((opt) => {
          const selected = status === opt.status
          return (
            <button
              key={opt.status}
              type="button"
              role="menuitem"
              aria-pressed={selected}
              onClick={() => onSelect(opt.status)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-150 ${
                selected ? opt.active : 'text-slate-300 hover:bg-slate-700/60'
              }`}
            >
              <span className="shrink-0">{opt.glyph}</span>
              {opt.label}
            </button>
          )
        })}
      </div>
    </motion.div>,
    document.body
  )
}
