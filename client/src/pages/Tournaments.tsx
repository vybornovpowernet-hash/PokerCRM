import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { formatAmount } from '../lib/money'
import type { MbrSummary, Room, TournamentGroup, TournamentSummary } from '../lib/types'

const PRESETS = [
  { id: 'day', label: 'За день' },
  { id: 'week', label: 'За неделю' },
  { id: 'month', label: 'За месяц' },
  { id: 'year', label: 'За год' }
] as const

type PresetId = (typeof PRESETS)[number]['id']
type SortKey = 'label' | 'count' | 'buyin' | 'totalProfitUsd' | 'roiPercent' | 'bestRank' | 'avgEntrants'
type SortDir = 'asc' | 'desc' | null

const buttonCls = 'rounded-lg border px-3 py-1.5 text-sm transition whitespace-nowrap'
const activeBtn = `${buttonCls} border-slate-500 bg-slate-700 text-slate-100`
const inactiveBtn = `${buttonCls} border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-100`
const inputCls =
  'rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-100 shadow-inner outline-none transition focus:border-slate-500'
const thCls = 'px-3 py-2 text-left text-[11px] uppercase tracking-wider text-slate-500 whitespace-nowrap'

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

function profitCls(v: number | null): string {
  if (v === null) return 'text-slate-500'
  if (v > 0) return 'text-emerald-400'
  if (v < 0) return 'text-red-400'
  return 'text-slate-200'
}

function cellValue(v: number | null, kind: 'usd' | 'int') {
  return v === null ? '—' : kind === 'usd' ? formatAmount(v, 'USD') : String(v)
}

interface Card {
  label: string
  value: number | null
  kind: 'usd' | 'int' | 'pct' | 'num'
}

function CardValue({ value, kind }: { value: number | null; kind: Card['kind'] }) {
  if (value === null) return <span className="text-slate-500">—</span>
  if (kind === 'pct') {
    const color = value > 0 ? 'text-emerald-400' : value < 0 ? 'text-red-400' : 'text-slate-100'
    return <span className={color}>{value}%</span>
  }
  const text = kind === 'usd' ? formatAmount(value, 'USD') : String(value)
  const color = kind === 'usd' ? (value < 0 ? 'text-red-400' : value > 0 ? 'text-emerald-400' : 'text-slate-100') : 'text-slate-100'
  return <span className={color}>{text}</span>
}

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
  right
}: {
  label: string
  sortKey: SortKey
  active: boolean
  dir: SortDir
  onSort: (key: SortKey) => void
  right?: boolean
}) {
  return (
    <th className={`${thCls} ${right ? 'text-right' : ''}`}>
      <button
        onClick={() => onSort(sortKey)}
        className={`flex items-center gap-1 uppercase transition hover:text-slate-200 ${right ? 'justify-end' : ''}`}
        title={`Сортировать по «${label}»`}
      >
        {label}
        <span className="text-[10px] text-slate-600">{active ? (dir === 'desc' ? '▼' : dir === 'asc' ? '▲' : '') : ''}</span>
      </button>
    </th>
  )
}

export default function TournamentsPage() {
  const initial = rangeFor('month')
  const [preset, setPreset] = useState<PresetId | null>('month')
  const [dateFrom, setDateFrom] = useState(initial.from)
  const [dateTo, setDateTo] = useState(initial.to)
  const [rooms, setRooms] = useState<Room[]>([])
  const [selectedRoomIds, setSelectedRoomIds] = useState<number[]>([])
  const [summary, setSummary] = useState<TournamentSummary | null>(null)
  const [mbr, setMbr] = useState<MbrSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('totalProfitUsd')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    api.rooms
      .list()
      .then((list) => setRooms(list.filter((r) => !r.isWallet)))
      .catch(() => setRooms([]))
  }, [])

  useEffect(() => {
    setLoading(true)
    api.tournaments
      .summary(dateFrom, dateTo, selectedRoomIds)
      .then((r) => {
        setSummary(r.summary)
        setMbr(r.mbr)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить турниры'))
      .finally(() => setLoading(false))
  }, [dateFrom, dateTo, selectedRoomIds])

  function selectPreset(id: PresetId) {
    setPreset(id)
    const r = rangeFor(id)
    setDateFrom(r.from)
    setDateTo(r.to)
  }

  function toggleRoom(id: number) {
    setSelectedRoomIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]))
  }

  function onSort(next: SortKey) {
    if (next === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : d === 'asc' ? null : 'desc'))
    } else {
      setSortKey(next)
      setSortDir('desc')
    }
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const groups = useMemo(() => {
    if (!summary) return []
    if (sortDir === null) return [...summary.groups]
    const dir = sortDir === 'desc' ? -1 : 1
    const val = (v: TournamentGroup): number | null => {
      if (sortKey === 'buyin') return v.count > 0 ? v.totalBuyinUsd / v.count : null
      return v[sortKey] as number | null
    }
    return [...summary.groups].sort((a, b) => {
      if (sortKey === 'label') return a.label.localeCompare(b.label, 'ru') * dir
      const av = val(a)
      const bv = val(b)
      if (av === null || bv === null) {
        if (av === null && bv === null) return 0
        return av === null ? 1 : -1
      }
      if ((sortKey === 'bestRank' || sortKey === 'avgEntrants') && (av === 0 || bv === 0)) {
        if (av === 0 && bv === 0) return 0
        return av === 0 ? 1 : -1
      }
      return (av - bv) * dir
    })
  }, [summary, sortKey, sortDir])

  const { abi, afs } = useMemo(() => {
    if (!summary) return { abi: null, afs: null }
    let sumBuyin = 0
    let sumCount = 0
    let afsWeight = 0
    let afsCount = 0
    for (const g of summary.groups) {
      sumBuyin += g.totalBuyinUsd
      sumCount += g.count
      if (g.avgEntrants !== null && g.avgEntrants > 0) {
        afsWeight += g.avgEntrants * g.count
        afsCount += g.count
      }
    }
    const totalUsd = sumBuyin / 100
    return { abi: sumCount > 0 ? Math.round(Number((totalUsd / sumCount).toFixed(2)) * 100) : null, afs: afsCount > 0 ? Math.round(afsWeight / afsCount) : null }
  }, [summary])

  const cards: Card[] = [
    { label: 'Сыграно турниров', value: summary?.count ?? null, kind: 'int' },
    { label: 'Общий профит', value: summary?.totalProfitUsd ?? null, kind: 'usd' },
    { label: 'ROI', value: summary?.roiPercent ?? null, kind: 'pct' },
    { label: 'ABI', value: abi, kind: 'usd' },
    { label: 'AFS', value: afs, kind: 'int' }
  ]

  const mbrCards: Card[] = [
    { label: 'Сыграно', value: mbr?.count ?? null, kind: 'int' },
    { label: 'Общий профит', value: mbr?.totalProfitUsd ?? null, kind: 'usd' },
    { label: 'ROI', value: mbr?.roiPercent ?? null, kind: 'pct' },
    { label: 'Среднее место', value: mbr?.avgPosition ?? null, kind: 'num' }
  ]

  return (
    <div className="space-y-6">
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
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {cards.map((c) => (
              <div key={c.label} className="rounded-xl border border-slate-700 bg-slate-800/80 p-4 shadow-lg shadow-black/40">
                <div className="text-[11px] uppercase tracking-wider text-slate-500">{c.label}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  <CardValue value={c.value} kind={c.kind} />
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-800/80 shadow-lg shadow-black/40">
            {summary?.blank && <div className="border-b border-amber-900/60 bg-amber-950/40 px-4 py-2 text-xs text-amber-300">{summary.blank}</div>}
            {groups.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">Нет турниров за период</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <SortHeader label="Название" sortKey="label" active={sortKey === 'label'} dir={sortDir} onSort={onSort} />
                    <SortHeader label="Сыграно" sortKey="count" active={sortKey === 'count'} dir={sortDir} onSort={onSort} />
                    <SortHeader label="Бай-ин" sortKey="buyin" active={sortKey === 'buyin'} dir={sortDir} onSort={onSort} right />
                    <SortHeader label="Профит" sortKey="totalProfitUsd" active={sortKey === 'totalProfitUsd'} dir={sortDir} onSort={onSort} />
                    <SortHeader label="ROI" sortKey="roiPercent" active={sortKey === 'roiPercent'} dir={sortDir} onSort={onSort} />
                    <SortHeader label="Место" sortKey="bestRank" active={sortKey === 'bestRank'} dir={sortDir} onSort={onSort} right />
                    <SortHeader label="AFS" sortKey="avgEntrants" active={sortKey === 'avgEntrants'} dir={sortDir} onSort={onSort} right />
                    <th className="px-3 py-2" aria-hidden />
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <GroupRows key={g.key} group={g} expanded={expanded.has(g.key)} onToggle={() => toggle(g.key)} />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <section className="rounded-xl border border-violet-900/60 bg-violet-950/20 shadow-lg shadow-black/40">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-violet-900/40 px-4 py-3">
              <h2 className="text-sm font-medium text-violet-200">Mystery Battle Royale</h2>
              <span className="text-[11px] uppercase tracking-wider text-violet-400/70">Hyper-turbo · 18-max · вне классических MTT-метрик</span>
            </div>
            {mbr && mbr.count > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
                  {mbrCards.map((c) => (
                    <div key={c.label} className="rounded-lg border border-violet-900/40 bg-slate-900/40 p-3">
                      <div className="text-[11px] uppercase tracking-wider text-violet-400/70">{c.label}</div>
                      <div className="mt-1 text-xl font-semibold tabular-nums">
                        <CardValue value={c.value} kind={c.kind} />
                      </div>
                    </div>
                  ))}
                </div>
                {mbr.blank && <div className="px-4 pb-2 text-xs text-amber-300">{mbr.blank}</div>}
                {mbr.breakdown.length > 0 && (
                  <div className="overflow-x-auto border-t border-violet-900/40">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[11px] uppercase tracking-wider text-violet-400/70">
                          <th className="px-4 py-2 text-left">Бай-ин</th>
                          <th className="px-3 py-2 text-right">Сыграно</th>
                          <th className="px-3 py-2 text-right">Профит</th>
                          <th className="px-3 py-2 text-right">ROI</th>
                          <th className="px-4 py-2 text-right">Ср. место</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mbr.breakdown.map((row) => (
                          <tr key={row.buyin} className="border-t border-violet-900/30">
                            <td className="px-4 py-2 tabular-nums text-slate-100">{formatAmount(row.buyin, 'USD')}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-300">{row.count}</td>
                            <td className={`px-3 py-2 text-right tabular-nums ${profitCls(row.profit)}`}>{formatAmount(row.profit, 'USD')}</td>
                            <td className={`px-3 py-2 text-right tabular-nums ${profitCls(row.roi)}`}>{row.roi === null ? '—' : `${row.roi}%`}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-300">{row.avgPosition ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <div className="px-4 py-4 text-sm text-slate-500">Нет MBR-турниров за период</div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function GroupRows({ group, expanded, onToggle }: { group: TournamentGroup; expanded: boolean; onToggle: () => void }) {
  const labelled = group.bestRank !== null || group.avgEntrants !== null
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer border-b border-slate-800/60 transition hover:bg-slate-800/40">
        <td className="px-3 py-2.5">
          <span className="flex items-center gap-2 text-slate-100">
            <span className={`inline-block w-3 text-xs text-slate-500 transition ${expanded ? 'rotate-90' : ''}`}>▶</span>
            <span className="truncate">{group.label}</span>
          </span>
        </td>
        <td className="px-3 py-2.5 tabular-nums text-slate-300">{group.count}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{group.count > 0 ? cellValue(Math.round(group.totalBuyinUsd / group.count), 'usd') : '—'}</td>
        <td className={`px-3 py-2.5 text-right tabular-nums ${profitCls(group.totalProfitUsd)}`}>{cellValue(group.totalProfitUsd, 'usd')}</td>
        <td className={`px-3 py-2.5 text-right tabular-nums ${profitCls(group.roiPercent)}`}>
          {group.roiPercent === null ? '—' : `${group.roiPercent}%`}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{group.bestRank ?? '—'}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{group.avgEntrants ?? '—'}</td>
        <td className="px-3 py-2.5 text-slate-500" aria-hidden>
          {expanded ? '−' : '+'}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-800/60 bg-slate-900/40">
          <td colSpan={8} className="px-4 py-3">
            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-1.5 text-left">Дата</th>
                    <th className="px-3 py-1.5 text-left">Рум</th>
                    <th className="px-3 py-1.5 text-right">Место</th>
                    <th className="px-3 py-1.5 text-right">Профит</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((r, i) => (
                    <tr key={`${r.date}-${i}`} className="border-b border-slate-800/50 last:border-0">
                      <td className="px-3 py-1.5 tabular-nums text-slate-400">{r.date}</td>
                      <td className="px-3 py-1.5 text-slate-300">{r.roomName}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{r.place ?? '—'}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${profitCls(r.profitUsd)}`}>{cellValue(r.profitUsd, 'usd')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!labelled && (
              <p className="mt-2 text-xs text-slate-500">
                Ручные строки (без названия): агрегируются по лимиту бай-ина.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  )
}