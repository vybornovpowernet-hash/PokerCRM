import { useEffect, useMemo, useState } from 'react'
import { api, type TransactionPayload } from '../lib/api'
import {
  DIRECTION_LABELS,
  TRANSACTION_TYPE_LABELS,
  WRITEOFF_REASON_LABELS,
  WRITEOFF_REASON_HINTS,
  WRITEOFF_REASONS,
  type Direction,
  type OrphanedDiscrepancy,
  type Room,
  type Transaction,
  type TransactionType,
  type WriteoffReason
} from '../lib/types'
import { formatAmount, parseUnits } from '../lib/money'
import { emitBalancesChanged } from '../lib/events'

const TODAY = new Date().toISOString().slice(0, 10)

interface FormState {
  id?: number
  roomId: number
  type: TransactionType
  amount: string
  fee: string
  direction: Direction
  counterpart: string
  destinationRoomId: number
  comment: string
}

const EMPTY_FORM: FormState = {
  roomId: 0,
  type: 'deposit',
  amount: '',
  fee: '',
  direction: 'in',
  counterpart: '',
  destinationRoomId: 0,
  comment: ''
}

const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-100 shadow-inner outline-none transition focus:border-slate-500'
const labelCls = 'mb-1 block text-xs text-slate-400'

function WarningIcon() {
  return (
    <svg className="inline-block h-3.5 w-3.5 shrink-0 text-amber-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

export default function TransactionsPage() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [discrepancies, setDiscrepancies] = useState<OrphanedDiscrepancy[]>([])
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [writeoffFor, setWriteoffFor] = useState<OrphanedDiscrepancy | null>(null)
  const [writeoffComment, setWriteoffComment] = useState('')
  const [writeoffReason, setWriteoffReason] = useState<WriteoffReason>('casino')
  const [writeoffBusy, setWriteoffBusy] = useState(false)
  const [writeoffError, setWriteoffError] = useState<string | null>(null)
  const [ackBusy, setAckBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState<{ type: TransactionType | ''; roomId: number | ''; dateFrom: string; dateTo: string }>({
    type: '',
    roomId: '',
    dateFrom: '',
    dateTo: ''
  })

  useEffect(() => {
    api.rooms.list().then(setRooms).catch(() => undefined)
  }, [])

  async function refresh() {
    setLoading(true)
    try {
      const res = await api.transactions.list({
        type: filter.type || undefined,
        roomId: filter.roomId || undefined,
        dateFrom: filter.dateFrom || undefined,
        dateTo: filter.dateTo || undefined
      })
      setTransactions(res.transactions)
      setDiscrepancies(res.discrepancies)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load transactions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [filter])

  const netChangeUsd = useMemo(() => {
    let sum = 0
    for (const t of transactions) {
      if (t.amountUsd === null) return null
      // casino is a signed gaming result; in/out flows use the direction formula
      sum += t.type === 'casino' ? t.amountUsd : t.direction === 'in' ? t.amountUsd : -t.amountUsd
    }
    return sum
  }, [transactions])

  const selectedRoom = rooms.find((r) => r.id === form.roomId)
  const otherRooms = rooms.filter((r) => r.id !== form.roomId)
  const roomColor = (roomId: number | null) => rooms.find((r) => r.id === roomId)?.color ?? '#e2e8f0'

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function pickRoom(id: number) {
    setForm((prev) => ({
      ...prev,
      roomId: id,
      destinationRoomId: prev.destinationRoomId === id ? 0 : prev.destinationRoomId
    }))
  }

  function pickType(type: TransactionType) {
    setForm((prev) => ({ ...prev, type, direction: type === 'deposit' ? 'in' : 'out', fee: type === 'casino' ? '' : prev.fee }))
  }

  function startEdit(t: Transaction) {
    setEditingId(t.id)
    setForm({
      id: t.id,
      roomId: t.roomId,
      type: t.type,
      amount: (t.amount / 100).toFixed(2).replace(/\.?0+$/, ''),
      fee: (t.fee / 100).toFixed(2).replace(/\.?0+$/, ''),
      direction: t.direction,
      counterpart: t.counterpart ?? '',
      destinationRoomId: t.destinationRoomId ?? 0,
      comment: t.comment ?? ''
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetForm() {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, roomId: rooms[0]?.id ?? 0 })
    setError(null)
  }

  useEffect(() => {
    resetForm()
  }, [rooms])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const isCasino = form.type === 'casino'
    const amount = parseUnits(form.amount, { signed: isCasino })
    if (amount === null || (isCasino ? amount === 0 : amount < 1)) {
      setError(
        isCasino
          ? 'Сумма казино должна быть ненулевой (выигрыш со знаком «+», проигрыш со знаком «-»)'
          : 'Сумма должна быть положительной (до 2 знаков после запятой)'
      )
      return
    }
    if (!selectedRoom) {
      setError('Выбери рум')
      return
    }
    if (form.type === 'transfer' && form.destinationRoomId === 0) {
      setError('Выбери рум-получатель (Куда)')
      return
    }
    const fee = isCasino ? 0 : parseUnits(form.fee) ?? 0
    const payload: TransactionPayload = {
      roomId: form.roomId,
      type: form.type,
      amount,
      fee,
      currency: selectedRoom.cashCurrency,
      direction: form.type === 'transfer' ? 'out' : form.direction,
      counterpart: form.counterpart || null,
      destinationRoomId: form.type === 'transfer' ? form.destinationRoomId : null,
      date: TODAY,
      comment: form.comment || null
    }
    try {
      if (editingId !== null && form.id !== undefined) {
        await api.transactions.update(form.id, payload)
      } else {
        await api.transactions.create(payload)
      }
      resetForm()
      emitBalancesChanged()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function handleDelete(t: Transaction) {
    if (!window.confirm(`Удалить транзакцию ${formatAmount(t.amount, t.currency)} от ${t.date}?`)) return
    setError(null)
    try {
      await api.transactions.remove(t.id)
      emitBalancesChanged()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function submitWriteoff() {
    if (!writeoffFor) return
    const comment = writeoffComment.trim()
    if (!comment) {
      setWriteoffError('Укажи причину списания')
      return
    }
    setWriteoffBusy(true)
    setWriteoffError(null)
    try {
      await api.transactions.writeoffDiscrepancy(writeoffFor.roomId, writeoffFor.date, comment, writeoffReason)
      setWriteoffFor(null)
      setWriteoffComment('')
      emitBalancesChanged()
      await refresh()
    } catch (e) {
      setWriteoffError(e instanceof Error ? e.message : 'Не удалось списать расхождение')
    } finally {
      setWriteoffBusy(false)
    }
  }

  async function acknowledgeDiscrepancy(d: OrphanedDiscrepancy) {
    const key = `${d.roomId}:${d.date}`
    if (ackBusy !== null) return
    setAckBusy(key)
    setError(null)
    try {
      // The server records the exact residual it computes — no fake casino row,
      // the balance stays untouched and the day simply stops being flagged.
      await api.tournaments.acknowledgeDiscrepancy(d.roomId, d.date)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось принять расхождение')
    } finally {
      setAckBusy(null)
    }
  }

  const directionLocked = form.type === 'deposit' || form.type === 'withdraw'
  const isCasino = form.type === 'casino'

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {error && <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}

      <form onSubmit={handleSubmit} className="rounded-xl border border-slate-700 bg-slate-800/80 p-5 space-y-4 shadow-lg shadow-black/40">
        <h2 className="mb-4 text-lg font-semibold text-slate-200">{editingId !== null ? 'Редактировать операцию' : 'Новая операция'}</h2>

        {rooms.length === 0 && (
          <p className="rounded-lg border border-amber-900 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
            Сначала добавь рум во вкладке «Румы».
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Тип</label>
            <select className={inputCls} value={form.type} onChange={(e) => pickType(e.target.value as TransactionType)}>
              {Object.entries(TRANSACTION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>{form.type === 'transfer' ? 'Откуда' : 'Рум'}</label>
            <select
              className={inputCls}
              value={form.roomId}
              onChange={(e) => pickRoom(Number(e.target.value))}
              style={selectedRoom ? { color: selectedRoom.color } : undefined}
            >
              <option value={0} disabled>
                — выбери рум —
              </option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.cashCurrency}
                </option>
              ))}
            </select>
          </div>
          {form.type === 'transfer' ? (
            <div>
              <label className={labelCls}>Куда</label>
              <select
                className={inputCls}
                value={form.destinationRoomId}
                onChange={(e) => update('destinationRoomId', Number(e.target.value))}
                style={rooms.find((r) => r.id === form.destinationRoomId) ? { color: roomColor(form.destinationRoomId) } : undefined}
              >
                <option value={0} disabled>
                  — выбери рум-получатель —
                </option>
                {otherRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.cashCurrency}
                  </option>
                ))}
              </select>
              {otherRooms.length === 0 && <p className="mt-1 text-xs text-amber-400">Нужен минимум второй рум для перевода</p>}
            </div>
          ) : isCasino ? (
            <div>
              <label className={labelCls}>Направление</label>
              <div className="w-full rounded-lg border border-slate-700 bg-slate-900/30 px-3 py-2 text-sm text-slate-400">
                По знаку суммы: «+» выигрыш, «-» проигрыш
              </div>
            </div>
          ) : (
            <div>
              <label className={labelCls}>Направление</label>
              <select
                className={inputCls}
                value={form.direction}
                onChange={(e) => update('direction', e.target.value as Direction)}
                disabled={directionLocked}
              >
                <option value="in">{DIRECTION_LABELS.in}</option>
                <option value="out">{DIRECTION_LABELS.out}</option>
              </select>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Сумма{selectedRoom ? `, ${selectedRoom.cashCurrency}` : ''}</label>
            <input
              className={inputCls}
              value={form.amount}
              onChange={(e) => update('amount', e.target.value)}
              placeholder={isCasino ? '100.00 или -100.00' : '100.00'}
              required
              inputMode={isCasino ? 'text' : 'decimal'}
            />
          </div>
          <div>
            <label className={labelCls}>Комиссия{selectedRoom ? `, ${selectedRoom.cashCurrency}` : ''}</label>
            <input
              className={inputCls}
              value={form.fee}
              onChange={(e) => update('fee', e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              disabled={isCasino}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Контрагент (карта, биржа…)</label>
            <input className={inputCls} value={form.counterpart} onChange={(e) => update('counterpart', e.target.value)} placeholder="Биржа" />
          </div>
          <div>
            <label className={labelCls}>Комментарий</label>
            <input className={inputCls} value={form.comment} onChange={(e) => update('comment', e.target.value)} />
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={rooms.length === 0} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-white disabled:opacity-40">
            {editingId !== null ? 'Сохранить' : 'Добавить'}
          </button>
          {editingId !== null && (
            <button type="button" onClick={resetForm} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800/60">
              Отмена
            </button>
          )}
        </div>
      </form>

      <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5 shadow-lg shadow-black/40">
        <h2 className="mb-4 text-lg font-semibold text-slate-200">История операций</h2>
        <div className="flex flex-wrap items-center gap-3">
        <select
          className={`${inputCls} w-auto`}
          value={filter.type}
          onChange={(e) => setFilter({ ...filter, type: e.target.value as TransactionType | '' })}
        >
          <option value="">Все типы</option>
          {Object.entries(TRANSACTION_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className={`${inputCls} w-auto`}
          value={filter.roomId}
          onChange={(e) => setFilter({ ...filter, roomId: e.target.value ? Number(e.target.value) : '' })}
          style={filter.roomId ? { color: roomColor(filter.roomId) } : undefined}
        >
          <option value="">Все румы</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <span className="text-sm text-slate-400">С:</span>
            <input type="date" className={`${inputCls} w-auto`} value={filter.dateFrom} onChange={(e) => setFilter({ ...filter, dateFrom: e.target.value })} />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-sm text-slate-400">По:</span>
            <input type="date" className={`${inputCls} w-auto`} value={filter.dateTo} onChange={(e) => setFilter({ ...filter, dateTo: e.target.value })} />
          </label>
        </div>
        <span className="ml-auto text-sm text-slate-400">
          Суммарно по фильтру:{' '}
          <span
            className={`font-medium ${
              netChangeUsd != null ? (netChangeUsd >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-300'
            }`}
          >
            {netChangeUsd != null ? `${netChangeUsd >= 0 ? '+' : ''}${formatAmount(netChangeUsd, 'USD')}` : '—'}
          </span>
          {netChangeUsd == null && <span className="ml-1 text-xs text-amber-400">(для части операций нет курса)</span>}
        </span>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/80 overflow-hidden shadow-lg shadow-black/40">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="w-[95px] whitespace-nowrap px-4 py-3">Дата</th>
              <th className="px-4 py-3">Рум</th>
              <th className="px-4 py-3">Тип</th>
              <th className="px-4 py-3">Направление</th>
              <th className="w-[110px] whitespace-nowrap px-4 py-3 text-right">Сумма</th>
              <th className="w-[100px] whitespace-nowrap px-4 py-3 text-right">Комиссия</th>
              <th className="whitespace-nowrap px-4 py-3">Контрагент</th>
              <th className="w-[200px] px-4 py-3">Комментарий</th>
              <th className="w-[190px] whitespace-nowrap px-4 py-3 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-slate-500">
                  Загрузка…
                </td>
              </tr>
            )}
            {!loading && transactions.length === 0 && discrepancies.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-slate-500">
                  Нет операций.
                </td>
              </tr>
            )}
            {!loading &&
              [...discrepancies]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((d) => (
                  <tr key={`d${d.roomId}:${d.date}`} className="border-b border-amber-900/40 bg-amber-950/30 last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 text-amber-400">{d.date}</td>
                    <td className="px-4 py-3 font-medium">
                      <span style={{ color: roomColor(d.roomId) }}>{d.roomName}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-amber-300">
                      <span className="inline-flex items-center gap-1.5">
                        <WarningIcon />
                        Расхождение
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">—</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-amber-300">{formatAmount(d.amountUsd, 'USD')}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-500">—</td>
                    <td className="px-4 py-3 text-slate-500">—</td>
                    <td className="px-4 py-3 text-xs text-amber-300/90">
                      Баланс не сходится с турнирами — внеси турниры, спиши или прими это расхождение
                    </td>
                    <td className="w-[190px] whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setWriteoffComment('')
                            setWriteoffReason('casino')
                            setWriteoffError(null)
                            setWriteoffFor(d)
                          }}
                          className="rounded px-2 py-1 text-xs text-amber-400 transition hover:bg-amber-950/40 hover:text-amber-300"
                        >
                          Списать
                        </button>
                        <button
                          onClick={() => acknowledgeDiscrepancy(d)}
                          disabled={ackBusy !== null}
                          title="Принять расхождение: деньги остаются как есть, профит дня будет считаться только по турнирам"
                          className="rounded px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200 disabled:opacity-40"
                        >
                          {ackBusy === `${d.roomId}:${d.date}` ? '…' : 'Принять'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            {transactions.map((t) => {
              const out = t.direction === 'out'
              const isCasinoRow = t.type === 'casino'
              return (
                <tr key={t.id} className="border-b border-slate-800/60 last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-400">{t.date}</td>
                  <td className="px-4 py-3 font-medium">
                    <span style={{ color: roomColor(t.roomId) }}>{t.roomName}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {isCasinoRow ? (
                      <span className="inline-flex rounded-full border border-violet-800 bg-violet-950/50 px-2 py-0.5 text-xs font-medium text-violet-300">
                        Казино
                      </span>
                    ) : (
                      TRANSACTION_TYPE_LABELS[t.type]
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {t.type === 'transfer' ? (
                    <>
                      → <span style={{ color: roomColor(t.destinationRoomId) }}>{t.destinationRoomName ?? '—'}</span>
                    </>
                  ) : isCasinoRow ? (
                    t.amount > 0 ? 'Выигрыш' : 'Проигрыш'
                  ) : (
                    DIRECTION_LABELS[t.direction]
                  )}
                  </td>
                  <td className={`whitespace-nowrap px-4 py-3 text-right font-medium ${isCasinoRow ? '' : t.type === 'transfer' ? 'text-amber-400' : out ? 'text-red-400' : 'text-emerald-400'}`}>
                    {isCasinoRow ? (
                      <span className={t.amount > 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {t.amount > 0 ? '+' : '-'}
                        {formatAmount(Math.abs(t.amount), t.currency)}
                      </span>
                    ) : (
                      <>
                        {t.type === 'transfer' ? '⇄ ' : out ? '−' : '+'}
                        {formatAmount(t.amount, t.currency)}
                      </>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-slate-400">{t.fee > 0 ? formatAmount(t.fee, t.currency) : '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{t.counterpart ?? '—'}</td>
                  <td className="max-w-0 w-full truncate px-4 py-3" title={t.comment ?? undefined}>
                    {t.comment ? (
                      <span className="text-slate-400">{t.comment}</span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="w-[190px] whitespace-nowrap px-4 py-3 text-right">
                    {t.writeoff ? (
                      <span
                        title={`Системное списание закрытия дня (причина: ${
                          t.writeoffReason ? WRITEOFF_REASON_LABELS[t.writeoffReason].toLowerCase() : 'не указана'
                        }): оно уже учтено в балансе за этот день, поэтому не редактируется`}
                        className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-500"
                      >
                        Списание{t.writeoffReason ? ` · ${WRITEOFF_REASON_LABELS[t.writeoffReason]}` : ''}
                      </span>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <button onClick={() => startEdit(t)} className="rounded px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-slate-100">
                          Изменить
                        </button>
                        <button onClick={() => handleDelete(t)} className="rounded px-2 py-1 text-xs text-red-400 transition hover:bg-red-950/40 hover:text-red-300">
                          Удалить
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {writeoffFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setWriteoffFor(null)}>
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-100">Списать расхождение</h3>
            <p className="mt-1 text-sm text-slate-400">
              <span style={{ color: roomColor(writeoffFor.roomId) }}>{writeoffFor.roomName}</span> · {writeoffFor.date} ·{' '}
              {formatAmount(writeoffFor.amountUsd, 'USD')}
            </p>
            <p className="mt-2 text-xs text-amber-300/80">
              Остаток дня запишется одной строкой казино-P&L с этой причиной и закроет сверку за день.
            </p>
            <div className="mt-4">
              <span className="mb-1 block text-xs text-slate-400">Причина списания</span>
              <div className="flex flex-wrap gap-2">
                {WRITEOFF_REASONS.map((reason) => {
                  const active = writeoffReason === reason
                  return (
                    <button
                      key={reason}
                      onClick={() => setWriteoffReason(reason)}
                      aria-pressed={active}
                      title={WRITEOFF_REASON_HINTS[reason]}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                        active
                          ? 'border-amber-500/60 bg-amber-950/40 text-amber-200'
                          : 'border-slate-700 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {WRITEOFF_REASON_LABELS[reason]}
                    </button>
                  )
                })}
              </div>
            </div>
            <label className="mt-4 block">
              <span className="mb-1 block text-xs text-slate-400">Комментарий (обязательно)</span>
              <input
                autoFocus
                className={inputCls}
                value={writeoffComment}
                onChange={(e) => {
                  setWriteoffComment(e.target.value)
                  setWriteoffError(null)
                }}
                placeholder="Например: играл в крэпс после турнира"
                maxLength={500}
              />
            </label>
            {writeoffError && <p className="mt-2 text-sm text-red-400">{writeoffError}</p>}
            <div className="mt-5 flex gap-3">
              <button
                disabled={writeoffBusy}
                onClick={submitWriteoff}
                className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-amber-300 disabled:opacity-40"
              >
                {writeoffBusy ? '…' : 'Списать'}
              </button>
              <button onClick={() => setWriteoffFor(null)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800/60">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}