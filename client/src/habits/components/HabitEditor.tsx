import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import type { HabitInput, HabitWithLogs } from '../habits.types'
import { charCount, MAX_HABIT_NAME } from '../metrics'
import { ColorPicker } from './ColorPicker'

interface HabitEditorProps {
  habit: HabitWithLogs
  onSave: (input: HabitInput) => Promise<void>
  onClose: () => void
}

export function HabitEditor({ habit, onSave, onClose }: HabitEditorProps) {
  const [name, setName] = useState(habit.name)
  const [color, setColor] = useState(habit.color)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const trimmed = name.trim()
  const count = charCount(name)
  const tooLong = count > MAX_HABIT_NAME
  const canSave = trimmed.length > 0 && !tooLong && !busy
  const dirty = trimmed !== habit.name || color !== habit.color

  const submit = async () => {
    if (!canSave) return
    setBusy(true)
    try {
      await onSave({ name: trimmed, color })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить привычку')
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={`Изменить привычку: ${habit.name}`}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/95 p-5 shadow-2xl shadow-black/60"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <h3 className="text-base font-semibold text-slate-100">Изменить привычку</h3>

          <div className="mt-4 flex items-center gap-2">
            <input
              ref={inputRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Название привычки"
              placeholder="Название привычки"
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-900/60 px-3.5 py-2.5 text-sm text-slate-100 outline-none transition-colors duration-150 placeholder:text-slate-500 focus-visible:border-indigo-400/60 focus-visible:ring-2 focus-visible:ring-indigo-500/20"
            />
            <ColorPicker value={color} onChange={setColor} label="Цвет привычки" />
          </div>

          <div className="mt-2 flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate" style={{ color }} title={trimmed || 'Предпросмотр'}>
              {trimmed || 'Предпросмотр'}
            </span>
            <span className={tooLong ? 'text-rose-300' : 'text-slate-500'}>
              {count}/{MAX_HABIT_NAME}
            </span>
          </div>

          {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-slate-600/60 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700/40 disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!canSave || !dirty}
              className="rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Сохранить
            </button>
          </div>
        </form>
      </motion.div>
    </div>,
    document.body
  )
}
