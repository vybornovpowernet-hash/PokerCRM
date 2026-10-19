import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatAmount, formatUnits, parseUnits } from '../lib/money'
import { emitBalancesChanged, onBalancesChanged } from '../lib/events'
import { TournamentPopup } from '../components/TournamentPopup'
import type { CurrentBalances, RateInfo, Room } from '../lib/types'

const TODAY = new Date().toISOString().slice(0, 10)

function cleanInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const dot = cleaned.indexOf('.')
  return dot === -1 ? cleaned : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '')
}

function formatThousands(value: string): string {
  const parts = value.split('.')
  const whole = parts[0] ?? ''
  const frac = parts[1]
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return frac !== undefined ? `${grouped}.${frac}` : grouped
}

const inputCls =
  'rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-100 shadow-inner outline-none transition focus:border-slate-500'

/** One feed: its latest known rate, the day it belongs to, and its own freshness. */
function RateLine({ label, feed }: { label: string; feed?: RateInfo }) {
  // a feed with no rate was never fetched: "no data" is not the same as "stale"
  const state = feed?.rate == null ? 'unknown' : feed.stale ? 'stale' : 'fresh'
  const dot = state === 'unknown' ? 'bg-slate-600' : state === 'stale' ? 'bg-amber-400' : 'bg-emerald-500'
  const status = state === 'unknown' ? 'нет данных' : state === 'stale' ? 'устарел' : 'актуально'
  return (
    <div className="flex items-baseline justify-between gap-2 text-slate-200">
      <span className="flex items-baseline gap-1.5">
        <span className="text-slate-500">{label}</span>
        {feed?.date && <span className="text-[11px] text-slate-600">{feed.date}</span>}
      </span>
      <span className="flex items-baseline gap-2">
        <span className="tabular-nums">{feed?.rate != null ? feed.rate.toFixed(4) : '—'}</span>
        <span role="img" aria-label={status} title={`Курс ${status}`} className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      </span>
    </div>
  )
}

export default function BalancesPage() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [data, setData] = useState<CurrentBalances | null>(null)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState<Record<number, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tournamentFor, setTournamentFor] = useState<{ room: Room; date: string } | null>(null)

  async function refresh() {
    setLoading(true)
    try {
      setData(await api.balances.current())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load balances')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    api.rooms
      .list()
      .then(setRooms)
      .catch(() => undefined)
    refresh()
    return onBalancesChanged(refresh)
  }, [])

  function latestByRoom(roomId: number) {
    return data?.balances.find((b) => b.roomId === roomId) ?? null
  }

  async function saveRoom(room: Room) {
    setError(null)
    const amount = parseUnits(drafts[room.id] ?? '')
    if (amount === null || amount < 0) {
      setError('Сумма некорректна (до 2 знаков, не отрицательная)')
      return
    }
    setSaving((prev) => ({ ...prev, [room.id]: true }))
    try {
      await api.balances.upsert({ roomId: room.id, date: TODAY, amount, currency: room.cashCurrency })
      await refresh()
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[room.id]
        return next
      })
      emitBalancesChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving((prev) => ({ ...prev, [room.id]: false }))
    }
  }

  const staleAny = data?.balances.some((b) => b.amountUsd === null) ?? false

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {error && <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5 shadow-lg shadow-black/40">
          <div className="text-xs uppercase tracking-wider text-slate-500">Банкролл (USD)</div>
          <div className={`mt-1 text-3xl font-semibold tabular-nums ${data?.totalUsd != null && data.totalUsd < 0 ? 'text-red-400' : 'text-slate-100'}`}>
            {data?.totalUsd != null ? formatAmount(data.totalUsd, 'USD') : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-600">все румы и кошельки на текущую дату</div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5 shadow-lg shadow-black/40">
          <div className="text-xs uppercase tracking-wider text-slate-500">Курсы</div>
          <div className="mt-1 space-y-1 text-sm">
            <RateLine label="USD/RUB" feed={data?.rates.usdRub} />
            <RateLine label="EUR/USD" feed={data?.rates.eurUsd} />
            <RateLine label="USD/CNY" feed={data?.rates.cnyUsd} />
            {data && (
              <div className={`mt-1 flex justify-between text-xs ${data.rates.stale ? 'text-amber-400' : 'text-emerald-500'}`}>
                <span>статус</span>
                <span>{data.rates.stale ? 'часть курсов устарела' : 'актуально'}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5 shadow-lg shadow-black/40">
        <div className="mb-4">
          <h2 className="text-lg font-medium text-slate-100">Румы</h2>
          <p className="text-xs text-slate-500">запиши баланс рума → рядом появится «Заполнить турниры»</p>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-500">Загрузка…</div>
        ) : rooms.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">Пока нет румов — добавь их во вкладке «Румы».</div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {rooms.map((r) => {
              const latest = latestByRoom(r.id)
              const draftValue = drafts[r.id] ?? (latest && latest.currency === r.cashCurrency ? formatUnits(latest.amount) : '')
              const showTournaments = latest?.pendingImport === true
              const tourneyDate = latest?.date ?? TODAY
              return (
                <div key={r.id} className="flex flex-col gap-4 py-4 first:pt-1 last:pb-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-base font-medium" style={{ color: r.color }}>{r.name}</span>
                      <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">{r.cashCurrency}</span>
                    </div>
                    {latest ? (
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className={`text-2xl font-semibold tabular-nums ${latest.amount === 0 ? 'text-slate-400' : 'text-slate-50'}`}>
                          {formatAmount(latest.amount, latest.currency)}
                        </span>
                        {r.cashCurrency !== 'USD' && (
                          <span className="text-sm tabular-nums text-slate-500">
                            {latest.amountUsd != null ? `≈ ${formatAmount(latest.amountUsd, 'USD')}` : 'нет курса'}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="mt-1 block text-sm text-slate-600">нет записи</span>
                    )}
                    {latest && (
                      <div className="mt-0.5 text-xs text-slate-600">
                        {latest.source === 'auto' ? 'авто-расчет · ' : ''}обновлено {latest.date}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-stretch gap-2 sm:items-end">
                    <div className="flex items-center gap-2">
                      <input
                        className={`${inputCls} w-40 text-right tabular-nums`}
                        type="text"
                        value={formatThousands(draftValue)}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [r.id]: cleanInput(e.target.value) }))}
                        placeholder="0.00"
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={`Новый баланс ${r.name}`}
                      />
                      <button
                        onClick={() => saveRoom(r)}
                        disabled={saving[r.id]}
                        className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-white disabled:opacity-40"
                      >
                        {saving[r.id] ? '…' : 'Записать'}
                      </button>
                    </div>
                    {showTournaments && (
                      <button
                        onClick={() => setTournamentFor({ room: r, date: tourneyDate })}
                        className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
                      >
                        Заполнить турниры на {tourneyDate}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {staleAny && <div className="mt-3 text-xs text-amber-400">Для части румов нет курса конвертации — проверьте курсы валют.</div>}
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