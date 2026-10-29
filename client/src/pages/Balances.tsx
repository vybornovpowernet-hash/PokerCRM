import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../lib/api'
import { formatAmount, formatSignedAmount, normalizeAmountInput, parseUnits } from '../lib/money'
import { emitBalancesChanged, onBalancesChanged } from '../lib/events'
import { TournamentPopup } from '../components/TournamentPopup'
import { BankrollDistribution } from '../components/BankrollDistribution'
import type { CurrentBalances, RateInfo, Room } from '../lib/types'

const TODAY = new Date().toISOString().slice(0, 10)

const NO_BALANCES: CurrentBalances['balances'] = []

const inputCls =
  'w-full min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-right text-sm tabular-nums text-slate-100 shadow-inner outline-none transition placeholder:text-slate-600 focus:border-slate-500 focus-visible:ring-2 focus-visible:ring-slate-500/30 sm:w-40 sm:flex-none'

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

const RatesCard = memo(function RatesCard({ rates }: { rates: CurrentBalances['rates'] | null }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5 shadow-lg shadow-black/40">
      <div className="text-xs uppercase tracking-wider text-slate-500">Курсы</div>
      <div className="mt-1 space-y-1 text-sm">
        <RateLine label="USD/RUB" feed={rates?.usdRub} />
        <RateLine label="EUR/USD" feed={rates?.eurUsd} />
        <RateLine label="USD/CNY" feed={rates?.cnyUsd} />
        {rates ? (
          <div className={`mt-1 flex justify-between text-xs ${rates.stale ? 'text-amber-400' : 'text-emerald-500'}`}>
            <span>статус</span>
            <span>{rates.stale ? 'часть курсов устарела' : 'актуально'}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
})

interface RowProps {
  room: Room
  latest: CurrentBalances['balances'][number] | null
  draft: string
  saving: boolean
  onDraftChange: (roomId: number, value: string) => void
  onSave: (room: Room, draft: string) => void
  onOpenTournaments: (room: Room, date: string) => void
}

const RoomBalanceRow = memo(function RoomBalanceRow({
  room,
  latest,
  draft,
  saving,
  onDraftChange,
  onSave,
  onOpenTournaments
}: RowProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const units = parseUnits(draft)
  const comparable = latest === null || latest.currency === room.cashCurrency
  const currentUnits = latest === null ? 0 : comparable ? latest.amount : null
  const delta = units !== null && currentUnits !== null ? units - currentUnits : null
  const dirty = units !== null && (currentUnits === null || units !== currentUnits)
  const negative = latest !== null && latest.amount < 0
  const tourneyDate = latest?.date ?? TODAY
  const deltaText = delta !== null && dirty ? `${delta > 0 ? '+' : ''}${formatSignedAmount(delta, room.cashCurrency)}` : ''
  const describedBy = latest ? `balance-current-${room.id} balance-delta-${room.id}` : `balance-delta-${room.id}`

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dirty || saving) return
    inputRef.current?.focus()
    onSave(room, draft)
  }

  return (
    <div className="flex flex-col gap-3 py-4 first:pt-1 last:pb-1 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-medium" style={{ color: room.color }}>{room.name}</span>
          <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">{room.cashCurrency}</span>
        </div>
        {latest ? (
          <div className="mt-1 flex items-baseline gap-2">
            <span
              id={`balance-current-${room.id}`}
              title={negative ? 'отрицательный баланс' : undefined}
              className={`text-2xl font-semibold tabular-nums ${
                negative ? 'text-rose-300' : latest.amount === 0 ? 'text-slate-400' : 'text-slate-50'
              }`}
            >
              {formatSignedAmount(latest.amount, latest.currency)}
            </span>
            {room.cashCurrency !== 'USD' ? (
              <span className="text-sm tabular-nums text-slate-500">
                {latest.amountUsd != null ? `≈ ${formatAmount(latest.amountUsd, 'USD')}` : 'нет курса'}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="mt-1 block text-sm text-slate-600">нет записи</span>
        )}
        {latest ? (
          <div className="mt-0.5 text-xs text-slate-600">
            {latest.source === 'auto' ? 'авто-расчет · ' : ''}обновлено {latest.date}
          </div>
        ) : null}
        {latest && !comparable ? (
          <div className="mt-1 text-xs text-amber-400">баланс записан в {latest.currency} — дельта не считается</div>
        ) : null}
        {latest?.pendingImport ? (
          <button
            type="button"
            onClick={() => onOpenTournaments(room, tourneyDate)}
            className="mt-2 rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/40"
          >
            Заполнить турниры на {tourneyDate}
          </button>
        ) : null}
      </div>

      <form className="flex w-full shrink-0 items-center gap-2 sm:w-auto" onSubmit={submit}>
        <span
          id={`balance-delta-${room.id}`}
          className={`min-w-0 shrink-0 text-right text-sm font-medium tabular-nums sm:min-w-[6.5rem] ${
            delta === null || delta === 0 ? '' : delta > 0 ? 'text-emerald-400' : 'text-rose-400'
          }`}
          title={dirty ? `изменение к балансу от ${latest?.date ?? 'нуля'}` : undefined}
        >
          {deltaText}
        </span>
        <input
          ref={inputRef}
          id={`balance-input-${room.id}`}
          name={`balance-${room.id}`}
          className={inputCls}
          type="text"
          value={draft}
          onChange={(event) => onDraftChange(room.id, normalizeAmountInput(event.target.value))}
          placeholder="Новый баланс"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-label={`Новый баланс ${room.name}`}
          aria-describedby={describedBy}
        />
        <button
          type="submit"
          disabled={!dirty || saving}
          aria-label={`Записать баланс ${room.name}`}
          className="shrink-0 whitespace-nowrap rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/50"
        >
          {saving ? '…' : 'Записать'}
        </button>
      </form>
    </div>
  )
})

export default function BalancesPage() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [data, setData] = useState<CurrentBalances | null>(null)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState<Record<number, boolean>>({})
  const [notice, setNotice] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [tournamentFor, setTournamentFor] = useState<{ room: Room; date: string } | null>(null)

  const refresh = useCallback(async (mode: 'initial' | 'silent' = 'silent') => {
    if (mode === 'initial') setInitialLoading(true)
    try {
      setData(await api.balances.current())
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Не удалось загрузить балансы' })
    } finally {
      if (mode === 'initial') setInitialLoading(false)
    }
  }, [])

  useEffect(() => {
    api.rooms
      .list()
      .then(setRooms)
      .catch(() => undefined)
    void refresh('initial')
    return onBalancesChanged(() => {
      void refresh('silent')
    })
  }, [refresh])

  const balanceByRoom = useMemo(() => new Map((data?.balances ?? NO_BALANCES).map((balance) => [balance.roomId, balance])), [data])

  const handleDraftChange = useCallback((roomId: number, value: string) => {
    setDrafts((prev) => ({ ...prev, [roomId]: value }))
    setNotice((prev) => (prev?.kind === 'ok' ? null : prev))
  }, [])

  const handleOpenTournaments = useCallback((room: Room, date: string) => {
    setTournamentFor({ room, date })
  }, [])

  const handleSave = useCallback(
    async (room: Room, draft: string) => {
      const amount = parseUnits(draft)
      if (amount === null || amount < 0) {
        setNotice({ kind: 'error', text: 'Сумма некорректна (до 2 знаков, не отрицательная)' })
        return
      }
      setNotice(null)
      setSaving((prev) => ({ ...prev, [room.id]: true }))
      try {
        await api.balances.upsert({ roomId: room.id, date: TODAY, amount, currency: room.cashCurrency })
        await refresh()
        setDrafts((prev) => {
          const next = { ...prev }
          delete next[room.id]
          return next
        })
        setNotice({ kind: 'ok', text: `Баланс ${room.name} записан` })
        emitBalancesChanged()
      } catch (err) {
        setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Не удалось сохранить' })
      } finally {
        setSaving((prev) => ({ ...prev, [room.id]: false }))
      }
    },
    [refresh]
  )

  const staleAny = data?.balances.some((balance) => balance.amountUsd === null) ?? false
  const noticeCls =
    notice?.kind === 'error' ? 'border-red-900 bg-red-950/40 text-red-300' : 'border-emerald-900 bg-emerald-950/40 text-emerald-300'

  return (
    <div className="space-y-6">
      {notice ? (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          aria-live={notice.kind === 'ok' ? 'polite' : undefined}
          className={`rounded-lg border px-4 py-3 text-sm ${noticeCls}`}
        >
          {notice.text}
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/80 p-5 shadow-lg shadow-black/40">
          <div className="mb-4">
            <h2 className="text-lg font-medium text-slate-100">Румы</h2>
            <p className="text-xs text-slate-500">запиши баланс рума → рядом появится «Заполнить турниры»</p>
          </div>

          {initialLoading ? (
            <div className="py-8 text-center text-sm text-slate-500">Загрузка…</div>
          ) : rooms.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">Пока нет румов — добавь их во вкладке «Румы».</div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {rooms.map((room) => (
                <RoomBalanceRow
                  key={room.id}
                  room={room}
                  latest={balanceByRoom.get(room.id) ?? null}
                  draft={drafts[room.id] ?? ''}
                  saving={saving[room.id] ?? false}
                  onDraftChange={handleDraftChange}
                  onSave={handleSave}
                  onOpenTournaments={handleOpenTournaments}
                />
              ))}
            </div>
          )}

          {staleAny ? (
            <div className="mt-3 text-xs text-amber-400">Для части румов нет курса конвертации — проверьте курсы валют.</div>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <BankrollDistribution rooms={rooms} balances={data?.balances ?? NO_BALANCES} totalUsd={data?.totalUsd ?? null} />
          <RatesCard rates={data?.rates ?? null} />
        </aside>
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
