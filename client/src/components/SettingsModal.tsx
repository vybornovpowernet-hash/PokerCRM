import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { AppVersionInfo, UpdateCheckResult } from '../lib/types'

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
  const [version, setVersion] = useState<AppVersionInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)

  useEffect(() => {
    api.settings
      .get()
      .then((s) => setDayStartHour(s.dayStartHour))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    api.system
      .version()
      .then(setVersion)
      .catch(() => setVersion(null))
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

  const checkUpdates = () => {
    setChecking(true)
    setCheckError(null)
    api.system
      .checkUpdates()
      .then(setUpdate)
      .catch((e) => setCheckError(e instanceof Error ? e.message : String(e)))
      .finally(() => setChecking(false))
  }

  const runUpdate = () => {
    setUpdating(true)
    setUpdateError(null)
    api.system
      .update()
      .catch((e) => {
        setUpdating(false)
        setUpdateError(e instanceof Error ? e.message : String(e))
      })
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

        <div className="mt-5 border-t border-slate-700 pt-4">
          <span className="block text-sm text-slate-300">Версия приложения</span>
          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="text-sm text-slate-400">
              {version ? (
                <>
                  Текущая версия: <span className="font-medium text-slate-200">v{version.version}</span>
                </>
              ) : (
                '…'
              )}
            </span>
            <button
              onClick={checkUpdates}
              disabled={checking}
              className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
            >
              {checking ? 'Проверка…' : 'Проверить обновление'}
            </button>
          </div>

          {checkError ? (
            <p className="mt-2 text-xs text-red-400">{checkError}</p>
          ) : update?.hasUpdate ? (
            <div className="mt-3 rounded-lg border border-emerald-800/70 bg-emerald-950/40 p-3">
              <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                Доступна версия v{update.latestVersion}
              </span>
              {update.releaseNotes && (
                <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-400">{update.releaseNotes}</p>
              )}
              {update.releaseUrl && (
                <a
                  href={update.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-xs font-medium text-emerald-300 transition hover:text-emerald-200"
                >
                  Открыть на GitHub →
                </a>
              )}
              {updating ? (
                <p className="mt-3 flex items-center gap-2 text-xs text-emerald-300">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-400/40 border-t-emerald-300" />
                  Установка обновления… Программа перезапустится автоматически.
                </p>
              ) : (
                <button
                  onClick={runUpdate}
                  className="mt-3 w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-emerald-500"
                >
                  Скачать и обновить
                </button>
              )}
              {updateError && <p className="mt-2 text-xs text-red-400">{updateError}</p>}
            </div>
          ) : update ? (
            <p className="mt-2 text-xs text-emerald-400">Установлена актуальная версия</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
