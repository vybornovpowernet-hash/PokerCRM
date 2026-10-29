import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { formatAmount } from '../lib/money'
import { TournamentPopup } from '../components/TournamentPopup'
import type { ReconcileFlag, Room, SessionDay } from '../lib/types'

const TODAY = new Date().toISOString().slice(0, 10)
const monthStart = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-100 shadow-inner outline-none transition focus:border-slate-500'

const rowGridCls = 'grid grid-cols-12 items-center'
const roomCellCls = 'col-span-4 px-4 py-2'
const deltaCellCls = 'col-span-3 px-4 py-2 text-right'
const profitCellCls = 'col-span-3 px-4 py-2 text-right'
const actionCellCls = 'col-span-2 px-4 py-2 text-right'

export default function SessionsPage() {
  const [range, setRange] = useState({ from: monthStart(), to: TODAY })
  const [sessions, setSessions] = useState<SessionDay[]>([])
  const [flags, setFlags] = useState<ReconcileFlag[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tournamentFor, setTournamentFor] = useState<{ room: Room; date: string } | null>(null)
  const mountedRef = useRef(true)
  const refreshSeq = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    api.rooms
      .list()
      .then((list) => setRooms(list.filter((r) => !r.isWallet)))
      .catch(() => undefined)
  }, [])

  const roomColor = (roomId: number) => rooms.find((r) => r.id === roomId)?.color ?? '#e2e8f0'
  const findRoom = (roomId: number) => rooms.find((r) => r.id === roomId) ?? null

  const openTournaments = (roomId: number, date: string) => {
    const room = findRoom(roomId)
    if (room) setTournamentFor({ room, date })
  }

  async function refresh() {
    const seq = ++refreshSeq.current
    setLoading(true)
    setError(null)
    try {
      const [sessionsRes, flagsRes] = await Promise.all([api.sessions.list(range.from, range.to), api.tournaments.reconcileSummary(range.from, range.to)])
      if (!mountedRef.current || seq !== refreshSeq.current) return
      setSessions(sessionsRes)
      setFlags(flagsRes)
    } catch (e) {
      if (!mountedRef.current || seq !== refreshSeq.current) return
      setError(e instanceof Error ? e.message : 'Failed to load sessions')
    } finally {
      if (mountedRef.current && seq === refreshSeq.current) setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [range])

  const summary = useMemo(() => {
    const totals = sessions.flatMap((s) => (s.totalUsd != null ? [s.totalUsd] : []))
    if (totals.length === 0) return { total: 0, days: 0, best: null, worst: null }
    return {
      total: totals.reduce((a, b) => a + b, 0),
      days: sessions.length,
      best: Math.max(...totals),
      worst: Math.min(...totals)
    }
  }, [sessions])

  const newestFirst = useMemo(() => [...sessions].reverse(), [sessions])

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {error && <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-700 bg-slate-800/80 p-4 shadow-lg shadow-black/40">
        <div>
          <label className="mb-1 block text-xs text-slate-400">С</label>
          <input type="date" className={`${inputCls} w-auto`} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">По</label>
          <input type="date" className={`${inputCls} w-auto`} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </div>
        <div className="ml-auto grid grid-cols-3 gap-6 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500">Итого</div>
            <div className={`font-semibold tabular-nums ${summary.total >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatAmount(summary.total, 'USD')}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500">Лучший день</div>
            <div className="font-medium tabular-nums text-emerald-400">{summary.best != null ? formatAmount(summary.best, 'USD') : '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500">Худший день</div>
            <div className="font-medium tabular-nums text-red-400">{summary.worst != null ? formatAmount(summary.worst, 'USD') : '—'}</div>
          </div>
        </div>
      </div>

      {loading && <div className="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-8 text-center text-sm text-slate-500">Загрузка…</div>}
      {!loading && sessions.length === 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-8 text-center text-sm text-slate-500">
          Нет сессий за выбранный период. Запиши балансы во вкладке «Балансы».
        </div>
      )}

      <div className="space-y-4">
        {newestFirst.map((day) => {
          const dayConvertible = day.rooms.filter((r) => r.pokerProfitUsd != null).map((r) => r.pokerProfitUsd as number)
          const total = dayConvertible.length > 0 ? dayConvertible.reduce((a, b) => a + b, 0) : null
          const dayFlags = flags.filter((f) => f.date === day.date)
          const anyFlagged = dayFlags.some((f) => f.flagged)
          const tournamentDays = dayFlags.filter((f) => f.tournamentCount > 0)
          return (
            <div key={day.date} className="rounded-xl border border-slate-700 bg-slate-800/80 overflow-hidden shadow-lg shadow-black/40">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-slate-100">{day.date}</span>
                  {anyFlagged && (
                    <button
                      onClick={() => openTournaments(dayFlags.find((f) => f.flagged)?.roomId ?? 0, day.date)}
                      className="flex items-center gap-1 rounded-full border border-amber-700/60 bg-amber-950/50 px-2.5 py-0.5 text-xs text-amber-300 transition hover:border-amber-600 hover:bg-amber-900/40"
                      title="Расхождение между турнирами и дельтой баланса > 5%"
                    >
                      расхождение
                    </button>
                  )}
                  {tournamentDays.length > 0 && !anyFlagged && (
                    <button
                      onClick={() => openTournaments(tournamentDays[0]?.roomId ?? 0, day.date)}
                      className="rounded-full border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
                      title="Турниры за этот день записаны (в пределах 5%)"
                    >
                      {tournamentDays.reduce((a, f) => a + f.tournamentCount, 0)} турн.
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-semibold tabular-nums ${total != null && total < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {total != null ? formatAmount(total, 'USD') : 'нет курса'}
                  </span>
                  <button
                    onClick={() => openTournaments(day.rooms[0]?.roomId ?? 0, day.date)}
                    className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
                  >
                    Турниры
                  </button>
                </div>
              </div>
              <div className={`${rowGridCls} border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500`}>
                <div className={roomCellCls}>Рум</div>
                <div className={deltaCellCls}>Дельта</div>
                <div className={profitCellCls}>Профит</div>
                <div className={actionCellCls} />
              </div>
              {day.rooms.map((r) => (
                <div key={r.roomId} className={`${rowGridCls} text-sm border-b border-slate-800/40 last:border-0`}>
                  <div className={roomCellCls}>
                    <span className="font-medium" style={{ color: roomColor(r.roomId) }}>{r.roomName}</span>
                    {r.casinoUsd > 0 && (
                      <div className="mt-0.5 text-xs tabular-nums text-emerald-400/80">↳ Казино: +{formatAmount(r.casinoUsd, 'USD')}</div>
                    )}
                    {r.casinoUsd < 0 && (
                      <div className="mt-0.5 text-xs tabular-nums text-rose-400/80">↳ Казино: −{formatAmount(Math.abs(r.casinoUsd), 'USD')}</div>
                    )}
                    {r.acknowledgedUsd !== 0 && (
                      <div className="mt-0.5 text-xs tabular-nums text-slate-500" title="Расхождение принято пользователем: деньги не списаны и в профит не входят">
                        ↳ принято расхождение: {r.acknowledgedUsd < 0 ? '−' : '+'}
                        {formatAmount(Math.abs(r.acknowledgedUsd), 'USD')}
                      </div>
                    )}
                  </div>
                  <div className={`${deltaCellCls} tabular-nums ${r.convertible && r.delta !== null ? 'text-slate-300' : 'text-amber-400/80'}`}>
                    {r.convertible && r.delta !== null ? formatAmount(r.delta, r.currency) : 'нет курса'}
                  </div>
                  <div className={`${profitCellCls} font-medium tabular-nums ${r.pokerProfitUsd != null ? (r.pokerProfitUsd < 0 ? 'text-red-400' : 'text-emerald-400') : 'text-slate-600'}`}>
                    {r.pokerProfitUsd != null ? `${r.pokerProfitUsd < 0 ? '−' : '+'}${formatAmount(Math.abs(r.pokerProfitUsd), 'USD')}` : '—'}
                  </div>
                  <div className={actionCellCls}>
                    <button
                      onClick={() => openTournaments(r.roomId, day.date)}
                      className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
                      title="Редактировать турниры этого рума за день"
                    >
                      изменить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <TournamentPopup
        open={tournamentFor !== null}
        room={tournamentFor?.room ?? null}
        date={tournamentFor?.date ?? TODAY}
        onClose={() => setTournamentFor(null)}
        onChanged={refresh}
      />
    </div>
  )
}