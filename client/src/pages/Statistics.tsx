import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { api } from '../lib/api'
import { formatAmount } from '../lib/money'
import type { ActivityCalendar, Room, SessionStatsResult, TournamentDayCount, TournamentPoint } from '../lib/types'

const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTHS_SHORT_RU = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const PRESETS = [
  { id: 'day', label: 'За день' },
  { id: 'week', label: 'За неделю' },
  { id: 'month', label: 'За месяц' },
  { id: 'year', label: 'За год' }
] as const

type PresetId = (typeof PRESETS)[number]['id']

const TOOLTIP_STYLE = { backgroundColor: '#1e293b', borderColor: '#334155', color: '#f1f5f9' }

const buttonCls = 'rounded-lg border px-3 py-1.5 text-sm transition whitespace-nowrap'
const activeBtn = `${buttonCls} border-slate-500 bg-slate-700 text-slate-100`
const inactiveBtn = `${buttonCls} border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-100`
const inputCls =
  'rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-100 shadow-inner outline-none transition focus:border-slate-500'

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function rangeFor(preset: PresetId): { from: string; to: string } {
  const now = new Date()
  const to = dayKey(now)
  if (preset === 'day') return { from: to, to }
  if (preset === 'week') {
    const d = new Date(now)
    d.setDate(d.getDate() - 6)
    return { from: dayKey(d), to }
  }
  if (preset === 'month') return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to }
  return { from: `${now.getFullYear()}-01-01`, to }
}

function cellCls(count: number): string {
  if (count === 0) return 'border-slate-800/60 bg-slate-900/30 text-slate-500'
  if (count < 15) return 'border-red-800/60 bg-red-950/50 text-red-300'
  if (count <= 20) return 'border-amber-700/60 bg-amber-950/50 text-amber-300'
  return 'border-emerald-700/60 bg-emerald-950/50 text-emerald-300'
}

function fmtDollars(v: number): string {
  return v < 0 ? `-$${Math.abs(v)}` : `$${v}`
}

interface Card {
  label: string
  value: number | null
  kind: 'usd' | 'int' | 'pct'
  /** Small caption under the value (e.g. "в т.ч. 12 MBR", "RedStar · 25.09.2026"). */
  hint?: string
  hintColor?: string
}

function CardValue({ value, kind }: { value: number | null; kind: 'usd' | 'int' | 'pct' }) {
  if (value === null) return <span className="text-slate-500">—</span>
  if (kind === 'pct') {
    const color = value > 0 ? 'text-emerald-400' : value < 0 ? 'text-red-400' : 'text-slate-100'
    return <span className={color}>{value}%</span>
  }
  const text = kind === 'usd' ? formatAmount(value, 'USD') : String(value)
  const color = kind === 'usd' ? (value < 0 ? 'text-red-400' : value > 0 ? 'text-emerald-400' : 'text-slate-100') : 'text-slate-100'
  return <span className={color}>{text}</span>
}

function TournamentsBarChart({ days, periodDays }: { days: TournamentDayCount[]; periodDays: number }) {
  if (days.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-500">Нет турниров за период</div>
    )
  }
  const data =
    periodDays > 31
      ? (() => {
          const byMonth = new Map<string, { label: string; count: number }>()
          for (const d of days) {
            const key = d.date.slice(0, 7)
            const year = Number(key.slice(0, 4))
            const monthIdx = Number(key.slice(5, 7)) - 1
            const label = `${MONTHS_SHORT_RU[monthIdx]} ${year}`
            const cur = byMonth.get(key) ?? { label, count: 0 }
            cur.count += d.count
            byMonth.set(key, cur)
          }
          return [...byMonth.values()]
        })()
      : days.map((d) => ({ label: d.date, count: d.count }))
  return (
    <div className="min-h-0 flex-1">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
          <XAxis dataKey="label" stroke="#64748b" fontSize={12} tickMargin={10} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} stroke="#64748b" fontSize={12} width={32} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#334155', opacity: 0.35 }} />
          <Bar dataKey="count" fill="#38bdf8" radius={[4, 4, 0, 0]}>
            <LabelList dataKey="count" position="top" fill="#f1f5f9" fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function ProfitLineChart({ points }: { points: TournamentPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-500">Нет турниров за период</div>
    )
  }
  const data = points.map((p) => ({ ...p, cumulativeUsd: p.cumulativeUsd / 100 }))
  const dateBySeq = new Map(data.map((p) => [p.seq, p.date]))
  return (
    <div className="min-h-0 flex-1">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="seq" stroke="#64748b" fontSize={12} tickMargin={10} />
          <YAxis stroke="#64748b" fontSize={12} tickFormatter={(val) => fmtDollars(Number(val))} width={60} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(val) => [fmtDollars(Number(val)), 'Профит'] as [string, string]}
            labelFormatter={(seq) => (dateBySeq.get(Number(seq)) ?? '') as string}
          />
          <Line
            type="monotone"
            dataKey="cumulativeUsd"
            stroke="#fbbf24"
            strokeWidth={2}
            dot={{ r: 3, fill: '#fbbf24', strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function StatisticsPage() {
  const now = new Date()
  const initial = rangeFor('month')
  const [preset, setPreset] = useState<PresetId | null>('month')
  const [dateFrom, setDateFrom] = useState(initial.from)
  const [dateTo, setDateTo] = useState(initial.to)
  const [rooms, setRooms] = useState<Room[]>([])
  const [selectedRoomIds, setSelectedRoomIds] = useState<number[]>([])
  const [stats, setStats] = useState<SessionStatsResult | null>(null)
  const [calendar, setCalendar] = useState<ActivityCalendar | null>(null)
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.rooms
      .list()
      .then((list) => setRooms(list.filter((r) => !r.isWallet)))
      .catch(() => setRooms([]))
  }, [])

  useEffect(() => {
    setLoading(true)
    api.statistics
      .sessions(dateFrom, dateTo, selectedRoomIds)
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load stats'))
      .finally(() => setLoading(false))
  }, [dateFrom, dateTo, selectedRoomIds])

  useEffect(() => {
    api.statistics
      .calendar(calYear, calMonth)
      .then(setCalendar)
      .catch(() => setCalendar(null))
  }, [calYear, calMonth])

  function selectPreset(id: PresetId) {
    setPreset(id)
    const r = rangeFor(id)
    setDateFrom(r.from)
    setDateTo(r.to)
  }

  function toggleRoom(id: number) {
    setSelectedRoomIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]))
  }

  const roomColor = (roomId: number) => rooms.find((r) => r.id === roomId)?.color

  function shiftMonth(delta: number) {
    const d = new Date(calYear, calMonth - 1 + delta, 1)
    setCalYear(d.getFullYear())
    setCalMonth(d.getMonth() + 1)
  }

  const offset = (() => {
    const first = new Date(calYear, calMonth - 1, 1)
    return (first.getDay() + 6) % 7
  })()

  const sessionCount = stats?.sessions.length ?? 0
  const finalProfit = stats?.profitSeries.at(-1)?.cumulativeUsd ?? null
  const periodDays = Math.floor((Date.parse(`${dateTo}T00:00:00`) - Date.parse(`${dateFrom}T00:00:00`)) / 86_400_000) + 1
  const topTournament = stats?.topTournament ?? null
  const cards: Card[] = [
    { label: 'Профит', value: stats?.totalProfitUsd ?? null, kind: 'usd' },
    { label: 'ROI', value: stats?.roiPercent ?? null, kind: 'pct' },
    { label: 'Ср. бай-ин', value: stats?.averageBuyinUsd ?? null, kind: 'usd' },
    { label: 'Турниров', value: stats?.tournamentCount ?? 0, kind: 'int', hint: `в т.ч. ${stats?.mbrCount ?? 0} MBR` },
    { label: 'Сессий', value: sessionCount, kind: 'int' },
    { label: 'Лучшая', value: stats?.bestSessionUsd ?? null, kind: 'usd' },
    { label: 'Худшая', value: stats?.worstSessionUsd ?? null, kind: 'usd' },
    {
      label: 'Лучший турнир',
      value: topTournament?.profitUsd ?? null,
      kind: 'usd',
      hint: topTournament ? `${topTournament.roomName} · ${dayLabel(topTournament.date)}` : undefined,
      hintColor: topTournament ? roomColor(topTournament.roomId) : undefined
    }
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {error && <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.id} onClick={() => selectPreset(p.id)} className={preset === p.id ? activeBtn : inactiveBtn}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Начало</span>
            <input
              type="date"
              className={`${inputCls} w-auto`}
              value={dateFrom}
              onChange={(e) => {
                setPreset(null)
                setDateFrom(e.target.value)
              }}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Конец</span>
            <input
              type="date"
              className={`${inputCls} w-auto`}
              value={dateTo}
              onChange={(e) => {
                setPreset(null)
                setDateTo(e.target.value)
              }}
            />
          </label>
        </div>
      </div>

      {rooms.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelectedRoomIds([])}
            className={selectedRoomIds.length === 0 ? activeBtn : inactiveBtn}
            aria-pressed={selectedRoomIds.length === 0}
          >
            Все румы
          </button>
          {rooms.map((room) => {
            const active = selectedRoomIds.includes(room.id)
            return (
              <button
                key={room.id}
                onClick={() => toggleRoom(room.id)}
                className={active ? `${activeBtn} border-slate-500` : inactiveBtn}
                style={{ borderColor: active ? room.color : undefined, color: active ? room.color : undefined }}
                aria-pressed={active}
              >
                {room.name}
              </button>
            )
          })}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-10 text-center text-sm text-slate-500 shadow-lg shadow-black/40">
          Загрузка…
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {cards.map((c) => (
            <div key={c.label} className="rounded-xl border border-slate-700 bg-slate-800/80 p-4 shadow-lg shadow-black/40">
              <div className="text-[11px] uppercase tracking-wider text-slate-500">{c.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                <CardValue value={c.value} kind={c.kind} />
              </div>
              {c.hint && (
                <div className="mt-1 truncate text-xs" style={c.hintColor ? { color: c.hintColor } : undefined}>
                  <span className={c.hintColor ? undefined : 'text-slate-500'}>{c.hint}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="flex h-[400px] min-w-0 flex-col rounded-xl border border-slate-700 bg-slate-800/80 p-5 shadow-lg shadow-black/40">
          <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-medium text-slate-100">Календарь активности</h2>
            <div className="flex items-center gap-2 text-sm">
              <button onClick={() => shiftMonth(-1)} className={inactiveBtn}>
                ‹
              </button>
              <span className="min-w-32 text-center font-medium text-slate-200">
                {MONTHS_RU[calMonth - 1]} <span className="text-slate-500">{calYear}</span>
              </span>
              <button onClick={() => shiftMonth(1)} className={inactiveBtn}>
                ›
              </button>
            </div>
          </div>

          <div className="mb-3 flex shrink-0 flex-wrap items-center gap-4 text-xs text-slate-400">
            {calendar && (
              <>
                <span>
                  Турниров: <span className="font-semibold text-slate-200">{calendar.totalCount}</span>
                </span>
                <span>
                  Профит:{' '}
                  <span className={`font-semibold tabular-nums ${calendar.totalProfitUsd < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {formatAmount(calendar.totalProfitUsd, 'USD')}
                  </span>
                </span>
              </>
            )}
            {calendar?.blank && <span className="text-amber-400">{calendar.blank}</span>}
          </div>

          <div className="mb-1 grid shrink-0 grid-cols-7 text-center text-xs font-medium uppercase tracking-wider text-slate-600">
            {WEEK.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>

          <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 gap-1.5">
            {Array.from({ length: offset }).map((_, i) => (
              <div key={`pad-${i}`} />
            ))}
            {calendar?.days.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${d.count} турниров, профит ${d.profitUsd != null ? formatAmount(d.profitUsd, 'USD') : '—'}`}
                className={`flex flex-col items-center justify-center rounded-lg border text-sm font-medium tabular-nums ${cellCls(d.count)}`}
              >
                <span className="text-[10px] font-normal text-slate-500">{Number(d.date.slice(8))}</span>
                {d.count > 0 && <span>{d.count}</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="flex h-[400px] min-w-0 flex-col rounded-xl border border-slate-700 bg-slate-800/80 p-5 shadow-lg shadow-black/40">
          <h2 className="mb-4 shrink-0 text-lg font-medium uppercase tracking-wider text-slate-100">Турниров за день</h2>
          <TournamentsBarChart days={stats?.tournamentDays ?? []} periodDays={periodDays} />
        </div>
      </div>

      <div className="flex h-[520px] flex-col rounded-xl border border-slate-700 bg-slate-800/80 p-5 shadow-lg shadow-black/40">
        <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium uppercase tracking-wider text-slate-100">Профит</h2>
          {finalProfit != null && (
            <span className="text-sm">
              <span className="text-slate-400">Итог: </span>
              <span className={`font-semibold tabular-nums ${finalProfit < 0 ? 'text-red-400' : 'text-amber-400'}`}>
                {formatAmount(finalProfit, 'USD')}
              </span>
            </span>
          )}
        </div>
        <ProfitLineChart points={stats?.profitSeries ?? []} />
      </div>
    </div>
  )
}