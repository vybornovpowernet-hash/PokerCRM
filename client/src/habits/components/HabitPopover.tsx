import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import type { HabitStatus } from '../habits.types'

interface HabitPopoverProps {
  x: number
  cellTop: number
  cellBottom: number
  label: string
  status: HabitStatus | null
  onSelect: (status: HabitStatus | null) => void
  onClose: () => void
}

const OPTIONS: { status: HabitStatus | null; label: string; active: string; dot: string }[] = [
  {
    status: 'done',
    label: 'Сделано',
    active: 'bg-emerald-500/10 text-emerald-300',
    dot: 'bg-emerald-400'
  },
  {
    status: 'partial',
    label: 'Частично',
    active: 'bg-amber-500/10 text-amber-300',
    dot: 'bg-amber-400'
  },
  {
    status: 'missed',
    label: 'Пропущено',
    active: 'bg-rose-500/10 text-rose-300',
    dot: 'bg-rose-400'
  },
  {
    status: null,
    label: 'Пусто',
    active: 'bg-slate-600/40 text-slate-200',
    dot: 'border border-slate-500'
  }
]

const GAP = 6
const EDGE = 8

// The grid card uses `backdrop-blur`, which turns it into the containing block
// for `position: fixed` descendants and clips them with `overflow-hidden`. The
// popover is therefore portalled to `document.body` and measured after mount so
// it always lands inside the viewport, flipping above the cell when needed.
export function HabitPopover({ x, cellTop, cellBottom, label, status, onSelect, onClose }: HabitPopoverProps) {
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
    const down = cellBottom + GAP
    const top = down + height + EDGE <= window.innerHeight ? down : Math.max(EDGE, cellTop - height - GAP)
    setPos({ left, top })
  }, [x, cellTop, cellBottom])

  return createPortal(
    <motion.div
      ref={ref}
      role="dialog"
      aria-label={`Статус: ${label}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12 }}
      className="fixed z-50 w-44 rounded-xl border border-slate-600 bg-slate-800 p-1.5 shadow-xl shadow-black/50"
      style={{ left: pos?.left ?? x, top: pos?.top ?? cellBottom + GAP, visibility: pos ? 'visible' : 'hidden' }}
    >
      <div className="truncate px-2 py-1.5 text-xs font-medium text-slate-400">{label}</div>
      <div className="flex flex-col gap-0.5">
        {OPTIONS.map((opt) => {
          const selected = status === opt.status
          return (
            <button
              key={opt.label}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(opt.status)}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-150 ${
                selected ? opt.active : 'text-slate-300 hover:bg-slate-700/60'
              }`}
            >
              <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${opt.dot}`} />
              {opt.label}
            </button>
          )
        })}
      </div>
    </motion.div>,
    document.body
  )
}
