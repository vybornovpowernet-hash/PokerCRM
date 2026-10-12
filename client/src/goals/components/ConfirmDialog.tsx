import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'

interface ConfirmDialogProps {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'default'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const confirmClass =
    tone === 'danger' ? 'bg-rose-500 text-white hover:bg-rose-400' : 'bg-indigo-500 text-white hover:bg-indigo-400'

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
        aria-label={title}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/95 p-5 shadow-2xl shadow-black/60"
      >
        <h3 className="text-base font-semibold text-slate-100">{title}</h3>
        {message && <p className="mt-2 text-sm text-slate-400">{message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-600/60 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700/40 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  )
}
