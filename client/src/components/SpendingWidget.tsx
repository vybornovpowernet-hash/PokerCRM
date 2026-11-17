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
  type OverviewCosts,
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

type Tone = 'neutral' | 'expense' | 'profit' | 'gain'

/**
 * Виджет «Куда уходят деньги»: клиент только форматирует готовые числа сервера и
 * выбирает цвет и слово по знаку. Комиссии и курсовая разница — одна сущность
 * (`costs`), и складывает их сервер: здесь нет ни одного сложения.
 *
 * Цвета договорились так: вывод — это выигрыш (зелёный), «Комиссии» красные при
 * положительном итоге и зелёные при выигрыше на курсе, третья карточка красного не
 * бывает никогда. Предупреждающие строки янтарные, все остальные подписи серые.
 */
function toneClass(tone: Tone, value: number | null): string {
  if (value === null) return 'text-slate-500'
  if (tone === 'neutral') return 'text-slate-100'
  if (tone === 'gain') return 'text-emerald-400'
  if (tone === 'expense') return value > 0 ? 'text-red-400' : value < 0 ? 'text-emerald-400' : 'text-slate-100'
  return value > 0 ? 'text-emerald-400' : value < 0 ? 'text-red-400' : 'text-slate-100'
}

/** Прочерк вместо null: отсутствие курса не рисуется нулём. */
function usd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return formatSignedAmount(value, 'USD')
}

/** Величина числа: модуль для показа, без пересчёта самого результата. */
function magnitude(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return formatAmount(Math.abs(value), 'USD')
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

const OPERATIONS: Forms = ['операция', 'операции', 'операций']
// Дательный падеж: «нет курса по …».
const OPERATIONS_TO: Forms = ['операции', 'операциям', 'операциям']
const CASINO_ROWS_TO: Forms = ['строке казино', 'строкам казино', 'строкам казино']
const BONUS_ROWS_TO: Forms = ['строке бонуса', 'строкам бонуса', 'строкам бонуса']
const TRANSFERS_GENITIVE: Forms = ['перевода', 'переводов', 'переводов']

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

/**
 * Третья карточка: остаток от игры на вносе (`cash.netInUsd`). Название и цвет
 * выбираются только по знаку присланного числа, показывается величина (при минусе со
 * знаком плюс: минус во «внесено минус выведено» означает, что пользователь уже в плюсе).
 * Красного у этой карточки не бывает, а формула живёт только во всплывающей подсказке.
 */
function NetMetric({ net }: { net: number | null }) {
  const negative = net !== null && net < 0
  const positive = net !== null && net > 0
  const label = negative ? 'В плюсе' : positive ? 'Осталось отбить' : 'Вышли в ноль'
  return (
    <div title="Внесено минус выведено" className="rounded-lg border border-slate-700/70 bg-slate-900/30 px-3 py-2.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div data-value className={`tabular-nums text-base font-semibold ${negative ? 'text-emerald-400' : 'text-slate-100'}`}>
        {net === null ? '—' : negative ? `+${magnitude(net)}` : usd(net)}
      </div>
    </div>
  )
}

/** Комиссии: серверный итог и разбор, из чего он сложён. */
function CostsMetric({ costs }: { costs: OverviewCosts }) {
  const net = costs.fxNetLossUsd
  const spread = net === null || net === undefined ? 'на курсе —' : net < 0 ? `на курсе выгода ${magnitude(net)}` : `на курсе ${magnitude(net)}`
  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-900/30 px-3 py-2.5">
      <div className="text-xs text-slate-500">Комиссии</div>
      <div data-value className={`tabular-nums text-base font-semibold ${toneClass('expense', costs.totalUsd)}`}>
        {usd(costs.totalUsd)}
      </div>
      <div className="mt-0.5 text-[11px] leading-tight text-slate-500">{`прямые ${magnitude(costs.feesUsd)} · ${spread}`}</div>
      {costs.fxNotCountedTransfers > 0 && (
        <div className="mt-0.5 text-[11px] leading-tight text-slate-500">
          {`курс не учтён у ${costs.fxNotCountedTransfers} ${pluralRu(costs.fxNotCountedTransfers, TRANSFERS_GENITIVE)}`}
        </div>
      )}
      <RateGap count={costs.missingRateRows} forms={OPERATIONS_TO} tail=", сумма неполная" />
    </div>
  )
}

/** Строка «метка — значение»: `[data-value]` держит число и, если нужно, слово при нём. */
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

/** Янтарная строка «нет курса» своего блока: суммы здесь неполные, и это видно. */
function RateGap({ count, forms, tail }: { count: number; forms: Forms; tail: string }) {
  if (count === 0) return null
  return <div className="mt-0.5 text-[11px] leading-tight text-amber-300/90">{`нет курса по ${count} ${pluralRu(count, forms)}${tail}`}</div>
}

function Skeleton() {
  return (
    <div role="status" aria-label="Загрузка данных" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg border border-slate-700/50 bg-slate-700/20" />
        ))}
      </div>
      <div className="h-10 animate-pulse rounded-lg border border-slate-700/50 bg-slate-700/20" />
    </div>
  )
}

/** Секция с заголовком: `aria-label` даёт именованные области для навигации и тестов. */
function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-1.5">
      <h3 className="text-sm font-semibold text-slate-300">{title}</h3>
      {children}
      {note && <p className="text-[11px] leading-tight text-slate-500">{note}</p>}
    </section>
  )
}

const FEE_TYPES: OverviewFeeType[] = ['deposit', 'withdraw', 'transfer']
const REASONS: WriteoffReason[] = ['casino', 'fx', 'other']

/** В этом виджете списание остатка дня на курс называется по-своему, чтобы не путать его с «Комиссиями». */
function reasonLabel(reason: WriteoffReason): string {
  return reason === 'fx' ? 'Списание на курс' : WRITEOFF_REASON_LABELS[reason]
}

function Overview({ data, colorOf }: { data: MoneyOverview; colorOf: (roomId: number) => string }) {
  const { cash, fees, casino, bonus, costs } = data
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-4">
      <section aria-label="Сводка за период" className="space-y-2">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Внесено" value={cash.depositedUsd} tone="neutral" />
          <Metric label="Выведено" value={cash.withdrawnUsd} tone="gain" />
          <NetMetric net={cash.netInUsd} />
          <CostsMetric costs={costs} />
          <Metric label="Казино" value={casino.totalUsd} tone="profit" hint={`${casino.rows} ${pluralRu(casino.rows, OPERATIONS)}`} />
          <Metric label="Бонусы" value={bonus.totalUsd} tone="profit" hint={`${bonus.rows} ${pluralRu(bonus.rows, OPERATIONS)}`} />
        </div>
        <RateGap count={cash.missingRateRows} forms={OPERATIONS_TO} tail=" — суммы неполные" />
      </section>

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
      >
        Подробнее
        <svg aria-hidden="true" viewBox="0 0 16 16" className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Block
              title="Комиссии"
              note="Разница курса — это разница между курсом программы и суммой, которую зачислила касса рума. Итог складывает сервер."
            >
              <Line label="Прямые комиссии" value={costs.feesUsd} tone="expense" />
              {FEE_TYPES.map((type) => {
                const row = fees.byType[type]
                if (!row || row.count === 0) return null
                return <Line key={type} label={TRANSACTION_TYPE_LABELS[type]} value={row.usd} tone="expense" word={`· ${row.count}`} />
              })}
              <Line label="Потери на курсе" value={costs.fxLossesUsd} tone="expense" />
              <Line label="Выгоды на курсе" value={costs.fxGainsUsd} tone="gain" />
              <Line label="Итого" value={costs.totalUsd} tone="expense" />
            </Block>

            <Block title="Казино" note="Ручные строки казино и авто-списания остатка дня — разные вещи: вторые закрывают день, когда баланс не сходится с турнирами.">
              <Line label="Выигрыши" value={casino.winsUsd} tone="profit" />
              <Line label="Проигрыши" value={casino.lossesUsd} tone="profit" />
              <Line label="Записано вручную" value={casino.manualUsd} tone="profit" />
              <Line label="Авто-списания" value={casino.autoUsd} tone="profit" />
              <RateGap count={casino.missingRateRows} forms={CASINO_ROWS_TO} tail=" — суммы неполные" />
              <div className="space-y-1 border-t border-slate-700/60 pt-1.5">
                {REASONS.map((reason) => {
                  const row = casino.byReason[reason]
                  if (!row || row.count === 0) return null
                  return (
                    <Line
                      key={reason}
                      label={reasonLabel(reason)}
                      value={row.usd}
                      tone="profit"
                      word={`· ${row.count}`}
                      title={reason === 'fx' ? 'Остаток дня списан как разница курсов' : undefined}
                    />
                  )
                })}
                {casino.byReason.fx.count > 0 && (
                  <p className="text-[11px] leading-tight text-slate-500">ваши ручные списания остатка дня, в Комиссии не входят</p>
                )}
              </div>
            </Block>
            <Block title="Бонусы" note="Рейкбек, кэшбэк и промо от румов. Это заработок, а не внесённые деньги: в «Внесено» бонусов нет, и в «Казино» они не смешиваются.">
              <Line label="Начисления" value={bonus.creditedUsd} tone="profit" />
              <Line label="Удержания" value={bonus.withheldUsd} tone="profit" />
              <Line label="Итого" value={bonus.totalUsd} tone="profit" />
              <RateGap count={bonus.missingRateRows} forms={BONUS_ROWS_TO} tail=" — суммы неполные" />
            </Block>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-700/70">
            <table className="w-full text-sm" aria-label="Куда уходят деньги по румам">
              <thead>
                <tr className="border-b border-slate-700/70 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2">Рум</th>
                  <th className="px-3 py-2 text-right">Внесено</th>
                  <th className="px-3 py-2 text-right">Выведено</th>
                  <th className="px-3 py-2 text-right">Комиссии</th>
                  <th className="px-3 py-2 text-right">Казино</th>
                  <th className="px-3 py-2 text-right">Бонусы</th>
                </tr>
              </thead>
              <tbody>
                {data.rooms.map((row) => (
                  <tr key={row.roomId} className="border-b border-slate-800/60 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 font-medium" style={{ color: colorOf(row.roomId) }}>
                      {row.name}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-100">{usd(row.depositedUsd)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-400">{usd(row.withdrawnUsd)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${toneClass('expense', row.costsUsd)}`}>{usd(row.costsUsd)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${toneClass('profit', row.casinoUsd)}`}>{usd(row.casinoUsd)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${toneClass('profit', row.bonusUsd)}`}>{usd(row.bonusUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-700/70">
            <table className="w-full text-sm" aria-label="Куда шли переводы">
              <thead>
                <tr className="border-b border-slate-700/70 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2 whitespace-nowrap">Откуда → Куда</th>
                  <th className="px-3 py-2 text-right">Переводов</th>
                  <th className="px-3 py-2 text-right">Комиссии</th>
                </tr>
              </thead>
              <tbody>
                {data.routes.map((route) => (
                  <tr key={`${route.fromRoomId}|${route.toRoomId ?? 'gone'}`} className="border-b border-slate-800/60 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 font-medium">
                      <span style={{ color: colorOf(route.fromRoomId) }}>{route.fromRoomName}</span>
                      <span className="text-slate-500"> → </span>
                      {route.toRoomId === null ? <span className="text-slate-500">—</span> : <span style={{ color: colorOf(route.toRoomId) }}>{route.toRoomName}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-100">{route.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-400">{route.costsUsd > 0 ? formatAmount(route.costsUsd, 'USD') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-[11px] leading-tight text-slate-500">
              Суммы самих переводов нигде не показываются: это твои деньги между своими румами, а не расход.
            </p>
          </div>
        </div>
      )}
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
    data.bonus.rows === 0 &&
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
