import { useEffect, useState } from 'react'
import { api } from '../lib/api'

const HOURS = Array.from({ length: 13 }, (_, h) => h)

const selectCls =
  'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-500 disabled:opacity-50'

export function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z" />
    </svg>
  )
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [dayStartHour, setDayStartHour] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.settings
      .get()
      .then((s) => setDayStartHour(s.dayStartHour))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const change = (value: number) => {
    setDayStartHour(value)
    setSaved(false)
    setSaving(true)
    setError(null)
    api.settings
      .update(value)
      .then((s) => {
        setDayStartHour(s.dayStartHour)
        setSaved(true)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-100">Настройки</h3>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-400 transition hover:bg-slate-900 hover:text-slate-200"
          >
            Закрыть
          </button>
        </div>

        <label className="mt-5 block">
          <span className="mb-1 block text-sm text-slate-300">Начало игровых суток</span>
          <span className="mb-2 block text-xs text-slate-500">
            Турниры, начавшиеся раньше этого часа, записываются в предыдущий день — чтобы ночная сессия после полуночи не рвалась на два дня.
          </span>
          <select
            className={selectCls}
            value={dayStartHour ?? 0}
            disabled={dayStartHour === null || saving}
            onChange={(e) => change(Number(e.target.value))}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>

        <div className="mt-3 flex h-5 items-center text-xs">
          {error ? (
            <span className="text-red-400">{error}</span>
          ) : saving ? (
            <span className="text-slate-400">Сохранение…</span>
          ) : saved ? (
            <span className="text-emerald-400">Сохранено</span>
          ) : null}
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Пример: при 06:00 турнир, начавшийся в 04:00 18 сентября, будет записан как сессия 17 сентября.
        </p>
      </div>
    </div>
  )
}
