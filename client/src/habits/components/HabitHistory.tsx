import { useState } from 'react'
import type { HabitHistoryItem } from '../habits.types'
import { pluralRu, shortDayLabel } from '../metrics'
import { RestoreIcon } from './icons'

interface HabitHistoryProps {
  items: HabitHistoryItem[]
  loading: boolean
  onRestore: (id: number) => Promise<void>
}

function period(item: HabitHistoryItem): string {
  const { firstDate, lastDate } = item.stats
  if (!firstDate || !lastDate) return 'Без отметок'
  if (firstDate === lastDate) return shortDayLabel(firstDate)
  return `${shortDayLabel(firstDate)} — ${shortDayLabel(lastDate)}`
}

export function HabitHistory({ items, loading, onRestore }: HabitHistoryProps) {
  const [restoring, setRestoring] = useState<number | null>(null)

  if (loading && items.length === 0) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <p className="text-sm text-slate-500">Загрузка…</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-slate-800/40 p-10 text-center text-sm text-slate-500 ring-1 ring-inset ring-white/[0.03]">
        Архив пуст. Привычки, которые вы уберёте из трекера, появятся здесь.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const entries = Object.entries(item.logs).sort(([a], [b]) => a.localeCompare(b))
        const busy = restoring === item.id
        return (
          <article
            key={item.id}
            className="rounded-2xl border border-white/[0.06] bg-slate-800/50 p-5 shadow-[0_24px_70px_-40px_rgba(0,0,0,0.95)] ring-1 ring-inset ring-white/[0.03] backdrop-blur-xl"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-base font-medium" style={{ color: item.color }} title={item.name}>
                  {item.name}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  {period(item)}
                  {item.archivedAt && <span className="text-slate-600"> · в архиве {shortDayLabel(item.archivedAt)}</span>}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setRestoring(item.id)
                  void onRestore(item.id).finally(() => setRestoring(null))
                }}
                aria-label={`Вернуть привычку: ${item.name}`}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors duration-150 hover:border-white/25 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RestoreIcon />
                Вернуть
              </button>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div>
                <dt className="text-[11px] text-slate-500">Выполнено</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-300">{item.stats.done}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500">Частично</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-amber-300">{item.stats.partial}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500">Пропущено</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-rose-300">{item.stats.missed}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500">Успех</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-200">
                  {item.stats.completionRate === null ? '—' : `${item.stats.completionRate}%`}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500">Лучшая серия</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-200">
                  {item.stats.longestDoneStreak > 0
                    ? `${item.stats.longestDoneStreak} ${pluralRu(item.stats.longestDoneStreak, 'день', 'дня', 'дней')}`
                    : '—'}
                </dd>
              </div>
            </dl>

            {entries.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1" aria-hidden="true">
                {entries.map(([date, status]) => (
                  <span
                    key={date}
                    title={`${shortDayLabel(date)} — ${status === 'done' ? 'сделано' : status === 'partial' ? 'частично' : 'пропущено'}`}
                    className={`h-2.5 w-2.5 rounded-[3px] ${
                      status === 'done' ? 'bg-emerald-400/70' : status === 'partial' ? 'bg-amber-400/70' : 'bg-rose-400/60'
                    }`}
                  />
                ))}
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
