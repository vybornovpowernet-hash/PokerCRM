import { memo, useMemo } from 'react'
import { formatAmount, formatSignedAmount } from '../lib/money'
import type { CurrentBalances, Room } from '../lib/types'

type BalanceRow = CurrentBalances['balances'][number]

interface Props {
  rooms: Room[]
  balances: BalanceRow[]
  totalUsd: number | null
}

interface Row {
  room: Room
  balance: BalanceRow | null
}

interface Segment {
  roomId: number
  name: string
  color: string
  amountUsd: number
  percent: number
}

interface Distribution {
  segments: Segment[]
  overdrawn: Row[]
  missingRate: Row[]
}

/**
 * Rounds shares so they always add up to `total`: floors first, then the leftover
 * units go to the largest fractional remainders (33/33/33 → 34/33/33, never 99).
 */
function largestRemainder(values: number[], total: number): number[] {
  const sum = values.reduce((acc, value) => acc + value, 0)
  if (sum <= 0) return values.map(() => 0)
  const exact = values.map((value) => (value / sum) * total)
  const rounded = exact.map((value) => Math.floor(value))
  let rest = total - rounded.reduce((acc, value) => acc + value, 0)
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder)
  for (const { index } of byRemainder) {
    if (rest <= 0) break
    rounded[index] = (rounded[index] ?? 0) + 1
    rest -= 1
  }
  return rounded
}

function buildDistribution(rooms: Room[], balances: BalanceRow[]): Distribution {
  const byRoom = new Map(balances.map((balance) => [balance.roomId, balance]))
  const rows = rooms.map((room) => ({ room, balance: byRoom.get(room.id) ?? null }))
  const positive = rows
    .filter((row) => (row.balance?.amountUsd ?? 0) > 0)
    .sort((a, b) => (b.balance?.amountUsd ?? 0) - (a.balance?.amountUsd ?? 0) || a.room.name.localeCompare(b.room.name, 'ru'))
  const percents = largestRemainder(
    positive.map((row) => row.balance?.amountUsd ?? 0),
    100
  )
  const segments = positive.map((row, index) => ({
    roomId: row.room.id,
    name: row.room.name,
    color: row.room.color,
    amountUsd: row.balance?.amountUsd ?? 0,
    percent: percents[index] ?? 0
  }))
  const overdrawn = rows.filter((row) => (row.balance?.amountUsd ?? 0) < 0)
  const missingRate = rows.filter((row) => row.balance !== null && row.balance.amountUsd === null)
  return { segments, overdrawn, missingRate }
}

export const BankrollDistribution = memo(function BankrollDistribution({ rooms, balances, totalUsd }: Props) {
  const distribution = useMemo(() => buildDistribution(rooms, balances), [rooms, balances])
  const total = totalUsd != null ? formatAmount(totalUsd, 'USD') : '—'

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5 shadow-lg shadow-black/40">
      <div className="text-xs uppercase tracking-wider text-slate-500">Распределение банкролла</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${totalUsd != null && totalUsd < 0 ? 'text-red-400' : 'text-slate-100'}`}>
        {total}
      </div>
      <div className="mt-1 text-xs text-slate-600">все румы и кошельки на текущую дату</div>

      <div
        role="img"
        aria-label="Распределение банкролла по румам"
        className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-900/70 ring-1 ring-inset ring-slate-700/60"
      >
        {distribution.segments.map((segment) => (
          <div
            key={segment.roomId}
            aria-hidden="true"
            title={`${segment.name} · ${segment.percent}% · ${formatAmount(segment.amountUsd, 'USD')}`}
            className="h-full min-w-[4px] transition-[flex-grow] duration-300 ease-out motion-reduce:transition-none"
            style={{
              flexBasis: 0,
              flexGrow: segment.amountUsd,
              backgroundColor: segment.color,
              boxShadow: 'inset -1px 0 0 rgba(2, 6, 23, 0.85)'
            }}
          />
        ))}
      </div>

      {distribution.segments.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
          {distribution.segments.map((segment) => (
            <li key={segment.roomId} className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-[2px] ring-1 ring-black/30"
                style={{ backgroundColor: segment.color }}
              />
              <span className="truncate font-medium" style={{ color: segment.color }}>{segment.name}</span>
              <span className="tabular-nums text-slate-300">{segment.percent}%</span>
              <span className="tabular-nums text-slate-500">{formatAmount(segment.amountUsd, 'USD')}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {balances.length === 0 ? (
        <div className="mt-3 text-xs text-slate-600">нет записанных балансов — заполни строки ниже</div>
      ) : distribution.segments.length === 0 ? (
        <div className="mt-3 text-xs text-slate-600">нет положительных балансов</div>
      ) : null}

      {distribution.overdrawn.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>отрицательные:</span>
          {distribution.overdrawn.map((row) => (
            <span key={row.room.id} className="flex items-center gap-1">
              <span className="font-medium" style={{ color: row.room.color }}>{row.room.name}</span>
              <span className="tabular-nums text-rose-300">{formatSignedAmount(row.balance?.amountUsd ?? 0, 'USD')}</span>
            </span>
          ))}
        </div>
      ) : null}

      {distribution.missingRate.length > 0 ? (
        <div className="mt-2 text-xs text-amber-400">
          нет курса: {distribution.missingRate.map((row) => row.room.name).join(', ')} — не в распределении
        </div>
      ) : null}
    </div>
  )
})
