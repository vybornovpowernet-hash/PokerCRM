import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { PeriodFilter } from './PeriodFilter'
import { rangeFor } from '../lib/date'
import { formatAmount, formatSignedAmount } from '../lib/money'
import {
  DEFAULT_ROOM_COLOR,
  TRANSACTION_TYPE_LABELS,
  WRITEOFF_REASON_LABELS,
  type MoneyOverview,
  type OverviewFeeType,
  type Room,
  type WriteoffReason
} from '../lib/types'

interface SpendingWidgetProps {
  /** Румы нужны только для цвета имени: суммы приходят с сервера готовыми. */
  rooms: Room[]
  /** Растёт после создания/правки/удаления операции: виджет переспрашивает свои цифры. */
  reloadToken?: number
}

type Tone = 'neutral' | 'cost' | 'profit' | 'loss'

/**
 * Виджет «Куда уходят деньги»: клиент только форматирует готовые числа сервера и
 * выбирает цвет и слово по знаку. Никаких сложений и пересчётов на клиенте — в том
 * числе счётчиками: `missingRateRows` у кассы, комиссий и казино считается по разным
 * полям одной строки, поэтому они показываются отдельными предупреждениями, а не суммой.
 */
function toneClass(tone: Tone, value: number | null): string {
  if (value === null) return 'text-slate-500'
  if (tone === 'neutral') return 'text-slate-100'
  if (tone === 'cost') return 'text-red-400'
  if (value > 0) return tone === 'loss' ? 'text-red-400' : 'text-emerald-400'
  if (value < 0) return tone === 'loss' ? 'text-emerald-400' : 'text-red-400'
  return 'text-slate-100'
}

/** Прочерк вместо null: отсутствие курса не рисуется нулём. */
function usd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return formatSignedAmount(value, 'USD')
}

type Forms = readonly [string, string, string]

/** Русское согласование числительного (1 / 2-4 / 5+). */
function pluralRu(count: number, forms: Forms): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

const TRANSFERS: Forms = ['перевод', 'перевода', 'переводов']
const OPERATIONS: Forms = ['операция', 'операции', 'операций']
const ROWS: Forms = ['строка', 'строки', 'строк']
// Дательный падеж: «нет курса по …».
const OPERATIONS_TO: Forms = ['операции', 'операциям', 'операциям']
const FEES_TO: Forms = ['комиссии', 'комиссиям', 'комиссиям']
const CASINO_ROWS_TO: Forms = ['строке казино', 'строкам казино', 'строкам казино']

function Metric({ label, value, tone, hint }: { label: string; value: number | null; tone: Tone; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-900/30 px-3 py-2.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div data-value className={`tabular-nums text-base font-semibold ${toneClass(tone, value)}`}>
        {usd(value)}
      </div>
      {hint && <div className="mt-0.5 text-[11px] leading-tight text-slate-500">{hint}</div>}
    </div>
  )
}

/** Строка «метка — значение»: `[data-value]` держит сумму и, если нужно, слово по знаку. */
function Line({ label, value, tone, word, title }: { label: string; value: number | null; tone: Tone; word?: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm" title={title}>
      <span className="text-slate-400">{label}</span>
      <span data-value className={`tabular-nums ${toneClass(tone, value)}`}>
        {usd(value)}
        {word ? ` ${word}` : ''}
      </span>
    </div>
  )
}

function RateGap({ count, forms }: { count: number; forms: Forms }) {
  if (count === 0) return null
  return <p className="text-xs leading-tight text-amber-300">{`нет курса по ${count} ${pluralRu(count, forms)} — суммы неполные`}</p>
}

function Skeleton() {
  return (
    <div role="status" aria-label="Загрузка данных" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg border border-slate-700/50 bg-slate-700/20" />
        ))}
      </div>
      <div className="h-24 animate-pulse rounded-lg border border-slate-700/50 bg-slate-700/20" />
      <div className="h-40 animate-pulse rounded-lg border border-slate-700/50 bg-slate-700/20" />
    </div>
  )
}

/** Секция с заголовком: `aria-label` нужен, чтобы карточки и таблицы не путались между собой. */
function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-300">{title}</h3>
      {children}
      {note && <p className="text-[11px] leading-tight text-slate-500">{note}</p>}
    </section>
  )
}

const FEE_TYPES: OverviewFeeType[] = ['deposit', 'withdraw', 'transfer']
const REASONS: WriteoffReason[] = ['casino', 'fx', 'other']

function Overview({ data, colorOf }: { data: MoneyOverview; colorOf: (roomId: number) => string }) {
  const { cash, fees, casino, fx } = data
  const net = fx.netLossUsd
  const excludedTotal = fx.excluded.noDestAmount + fx.excluded.noRate + fx.excluded.sameCurrency
  const currencies = Object.entries(fees.byCurrency)

  return (
    <div className="space-y-5">
      <section aria-label="Сводка за период" className="space-y-2">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Внесено" value={cash.depositedUsd} tone="neutral" />
          <Metric label="Выведено" value={cash.withdrawnUsd} tone="cost" />
          <Metric label="Чистый внос" value={cash.netInUsd} tone="profit" hint="внесено минус выведено, без комиссий и переводов" />
          <Metric label="Комиссии" value={fees.totalUsd} tone="cost" hint={`${fees.rows} ${pluralRu(fees.rows, OPERATIONS)}`} />
          <Metric label="Казино" value={casino.totalUsd} tone="profit" hint={`${casino.rows} ${pluralRu(casino.rows, ROWS)}`} />
          <Metric
            label="Курсовая разница"
            value={net}
            tone="loss"
            hint={net > 0 ? 'чистая потеря' : net < 0 ? 'чистая выгода' : 'по курсу сошлось'}
          />
        </div>
        <RateGap count={cash.missingRateRows} forms={OPERATIONS_TO} />
      </section>

      <Block title="Комиссии за период" note="Комиссия удержана румом и уже входит в то, что ушло с баланса, поэтому к «выведено» она не прибавляется.">
        <div className="space-y-1">
          {FEE_TYPES.map((type) => {
            const row = fees.byType[type]
            if (row.count === 0) return null
            return <Line key={type} label={TRANSACTION_TYPE_LABELS[type]} value={row.usd} tone="cost" word={`· ${row.count}`} />
          })}
          <RateGap count={fees.missingRateRows} forms={FEES_TO} />
          {currencies.length > 0 && (
            <p className="text-[11px] text-slate-500">
              в валютах операций: {currencies.map(([code, raw]) => `${code} ${formatAmount(raw, code)}`).join(' · ')}
            </p>
          )}
          <div className="mt-2 space-y-1 border-t border-slate-700/60 pt-2">
            {fees.byRoom.map((row) => (
              <Line key={row.roomId} label={row.name} value={row.usd} tone="cost" word={`· ${row.count}`} />
            ))}
          </div>
        </div>
      </Block>

      <Block title="Казино за период" note="Ручные строки казино и авто-списания остатка дня — разные вещи: вторые закрывают день, когда баланс не сходится с турнирами.">
        <div className="space-y-1">
          <Line label="Выигрыши" value={casino.winsUsd} tone="profit" />
          <Line label="Проигрыши" value={casino.lossesUsd} tone="profit" />
          <Line label="Записано вручную" value={casino.manualUsd} tone="profit" />
          <Line label="Авто-списания" value={casino.autoUsd} tone="profit" />
          <RateGap count={casino.missingRateRows} forms={CASINO_ROWS_TO} />
          <div className="mt-2 space-y-1 border-t border-slate-700/60 pt-2">
            {REASONS.map((reason) => {
              const row = casino.byReason[reason]
              if (row.count === 0) return null
              return (
                <Line
                  key={reason}
                  label={WRITEOFF_REASON_LABELS[reason]}
                  value={row.usd}
                  tone="profit"
                  word={`· ${row.count}`}
                  title={reason === 'fx' ? 'Остаток дня списан как разница курсов' : undefined}
                />
              )
            })}
            {casino.byReason.fx.count > 0 && (
              <p className="text-[11px] leading-tight text-amber-300/80">ваши ручные списания, не путать с расчётной курсовой разницей</p>
            )}
          </div>
        </div>
      </Block>

      <Block title="Курсовая разница по переводам" note="Считается только там, где вписана точная сумма зачисления: курс кассы рума против курса ленты на дату.">
        <div className="space-y-1">
          <Line label="Потери на курсе" value={fx.lossesUsd} tone="cost" word="потеря" />
          <Line label="Выгоды на курсе" value={fx.gainsUsd} tone="profit" word="выгода" />
          <Line label="Чистый итог" value={net} tone="loss" word={net > 0 ? 'потеря' : net < 0 ? 'выгода' : undefined} />
          <p className="text-[11px] text-slate-500">
            по {fx.rows} {pluralRu(fx.rows, TRANSFERS)} с точной суммой зачисления
          </p>
          {excludedTotal > 0 && (
            <div className="mt-2 space-y-1 border-t border-slate-700/60 pt-2 text-xs text-slate-400">
              {fx.excluded.noDestAmount > 0 && (
                <p>
                  {fx.excluded.noDestAmount} {pluralRu(fx.excluded.noDestAmount, TRANSFERS)} без точной суммы зачисления
                </p>
              )}
              {fx.excluded.noRate > 0 && (
                <p>
                  {fx.excluded.noRate} {pluralRu(fx.excluded.noRate, TRANSFERS)} без курса
                </p>
              )}
              {fx.excluded.sameCurrency > 0 && (
                <p className="text-slate-500">
                  {fx.excluded.sameCurrency} {pluralRu(fx.excluded.sameCurrency, TRANSFERS)} между румами одной валюты
                </p>
              )}
              {fx.excluded.noDestAmount > 0 && (
                <p className="text-[11px] text-amber-300/80">впишите сумму зачисления через «Изменить», чтобы учесть</p>
              )}
            </div>
          )}
        </div>
      </Block>

      <div className="overflow-x-auto rounded-lg border border-slate-700/70">
        <table className="w-full text-sm" aria-label="Куда уходят деньги по румам">
          <thead>
            <tr className="border-b border-slate-700/70 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2">Рум</th>
              <th className="px-3 py-2 text-right">Внесено</th>
              <th className="px-3 py-2 text-right">Выведено</th>
              <th className="px-3 py-2 text-right">Комиссии</th>
              <th className="px-3 py-2 text-right">Казино</th>
              <th className="px-3 py-2 whitespace-nowrap text-right">Курс. разница</th>
              <th className="px-3 py-2 text-right">Переводы</th>
            </tr>
          </thead>
          <tbody>
            {data.rooms.map((row) => (
              <tr key={row.roomId} className="border-b border-slate-800/60 last:border-0">
                <td className="whitespace-nowrap px-3 py-2 font-medium" style={{ color: colorOf(row.roomId) }}>
                  {row.name}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-100">{usd(row.depositedUsd)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-red-400">{usd(row.withdrawnUsd)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-red-400">{usd(row.feesUsd)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${toneClass('profit', row.casinoUsd)}`}>{usd(row.casinoUsd)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${toneClass('loss', row.fxUsd)}`}>{usd(row.fxUsd)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-400" title="переводов вошло / вышло">
                  ↑{row.transfersIn} ↓{row.transfersOut}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-700/70">
        <table className="w-full text-sm" aria-label="Маршруты переводов">
          <thead>
            <tr className="border-b border-slate-700/70 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2">Откуда</th>
              <th className="px-3 py-2">Куда</th>
              <th className="px-3 py-2 text-right">Переводов</th>
              <th className="px-3 py-2 text-right">Комиссии</th>
            </tr>
          </thead>
          <tbody>
            {data.routes.map((route) => (
              <tr key={`${route.fromRoomId}|${route.toRoomId ?? 'gone'}`} className="border-b border-slate-800/60 last:border-0">
                <td className="whitespace-nowrap px-3 py-2 font-medium" style={{ color: colorOf(route.fromRoomId) }}>
                  {route.fromRoomName}
                </td>
                <td
                  className="whitespace-nowrap px-3 py-2 font-medium"
                  style={route.toRoomId === null ? undefined : { color: colorOf(route.toRoomId) }}
                >
                  {route.toRoomId === null ? '—' : route.toRoomName}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-100">{route.count}</td>
                <td className="px-3 py-2 text-right tabular-nums text-red-400">
                  {route.feeUsd > 0 ? formatAmount(route.feeUsd, 'USD') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-3 py-2 text-[11px] text-slate-500">
          Суммы самих переводов нигде не складываются: это твои деньги между своими румами, а не расход.
        </p>
      </div>
    </div>
  )
}

export function SpendingWidget({ rooms, reloadToken = 0 }: SpendingWidgetProps) {
  const [range, setRange] = useState(() => rangeFor('month'))
  const [data, setData] = useState<MoneyOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  // Номер последнего запроса: ответ прежнего периода, пришедший с опозданием, отбрасывается.
  const latestRequest = useRef(0)

  const complete = range.from !== '' && range.to !== ''

  useEffect(() => {
    if (!complete) {
      setLoading(false)
      return
    }
    const ticket = ++latestRequest.current
    setLoading(true)
    setError(null)
    api.transactions
      .overview(range.from, range.to)
      .then((result) => {
        if (ticket !== latestRequest.current) return
        setData(result)
      })
      .catch((e: unknown) => {
        if (ticket !== latestRequest.current) return
        setError(e instanceof Error ? e.message : 'Не удалось загрузить сводку')
      })
      .finally(() => {
        if (ticket === latestRequest.current) setLoading(false)
      })
  }, [complete, range.from, range.to, reloadToken, attempt])

  const colorOf = useMemo(() => {
    const byId = new Map(rooms.map((r) => [r.id, r.color]))
    return (roomId: number) => byId.get(roomId) ?? DEFAULT_ROOM_COLOR
  }, [rooms])

  const empty =
    data !== null &&
    data.rooms.length === 0 &&
    data.routes.length === 0 &&
    data.cash.depositedUsd === 0 &&
    data.cash.withdrawnUsd === 0 &&
    data.fees.rows === 0 &&
    data.casino.rows === 0 &&
    data.fx.rows === 0

  return (
    <section className="rounded-xl border border-slate-700 bg-slate-800/80 p-5 space-y-4 shadow-lg shadow-black/40">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-slate-200">Куда уходят деньги</h2>
        <span className="text-xs text-slate-500">не зависит от фильтров истории · все суммы в USD</span>
      </div>

      <PeriodFilter dateFrom={range.from} dateTo={range.to} onChange={setRange} defaultPreset="month" />

      {!complete && <p className="rounded-lg border border-slate-700 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">Выберите период</p>}

      {complete && loading && <Skeleton />}

      {complete && !loading && error && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          <span>{error}</span>
          <button
            onClick={() => setAttempt((n) => n + 1)}
            className="rounded-lg border border-red-800 px-3 py-1 text-xs text-red-200 transition hover:bg-red-900/40"
          >
            Повторить
          </button>
        </div>
      )}

      {complete && !loading && !error && empty && (
        <p className="rounded-lg border border-slate-700 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">За период операций нет</p>
      )}

      {complete && !loading && !error && data !== null && !empty && <Overview data={data} colorOf={colorOf} />}
    </section>
  )
}
