import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import type { GoalCloseOutcome } from '../goals.types'

interface GoalOutcomeDialogProps {
  goalName: string
  busy?: boolean
  onChoose: (outcome: GoalCloseOutcome) => void
  onCancel: () => void
}

export function GoalOutcomeDialog({ goalName, busy = false, onChoose, onCancel }: GoalOutcomeDialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Итог цели"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/95 p-5 shadow-2xl shadow-black/60"
      >
        <h3 className="text-base font-semibold text-slate-100">Итог цели</h3>
        <p className="mt-2 text-sm text-slate-400">Как завершилась цель «{goalName}»?</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-600/60 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700/40 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => onChoose('achieved')}
            disabled={busy}
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            Выполнена
          </button>
          <button
            type="button"
            onClick={() => onChoose('failed')}
            disabled={busy}
            className="rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-50"
          >
            Провалена
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  )
}
