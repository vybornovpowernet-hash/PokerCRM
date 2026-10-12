import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import {
  COMMON_CURRENCIES,
  DEFAULT_ROOM_COLOR,
  RATE_SOURCE_LABEL,
  ROOM_COLORS,
  type CurrentBalances,
  type Room,
  type RoomTemplate
} from '../lib/types'
import RoomNameCombobox from '../components/RoomNameCombobox'
import { formatAmount } from '../lib/money'
import { onBalancesChanged } from '../lib/events'

interface RoomFormState {
  id?: number
  name: string
  cashCurrency: string
  tournamentCurrency: string
  rateSource: string
  color: string
  isWallet: boolean
}

const EMPTY_FORM: RoomFormState = {
  name: '',
  cashCurrency: 'USD',
  tournamentCurrency: 'USD',
  rateSource: '',
  color: DEFAULT_ROOM_COLOR,
  isWallet: false
}

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [balances, setBalances] = useState<CurrentBalances | null>(null)
  const [templates, setTemplates] = useState<RoomTemplate[]>([])
  const [form, setForm] = useState<RoomFormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false)
  const colorPickerRef = useRef<HTMLDivElement>(null)
  const appliedNameRef = useRef('')

  useEffect(() => {
    api.rooms
      .templates()
      .then(setTemplates)
      .catch(() => undefined)
  }, [])

  async function refresh() {
    setLoading(true)
    try {
      setRooms(await api.rooms.list())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rooms')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    const load = () => {
      api.balances.current().then(setBalances).catch(() => undefined)
    }
    load()
    return onBalancesChanged(load)
  }, [])

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setIsColorPickerOpen(false)
      }
    }
    if (isColorPickerOpen) {
      document.addEventListener('mousedown', onDocMouseDown)
      return () => document.removeEventListener('mousedown', onDocMouseDown)
    }
    return undefined
  }, [isColorPickerOpen])

  function startEdit(room: Room) {
    appliedNameRef.current = ''
    setEditingId(room.id)
    setForm({
      id: room.id,
      name: room.name,
      cashCurrency: room.cashCurrency,
      tournamentCurrency: room.tournamentCurrency,
      rateSource: room.rateSource ?? '',
      color: room.color,
      isWallet: room.isWallet
    })
  }

  function resetForm() {
    appliedNameRef.current = ''
    setEditingId(null)
    setForm(EMPTY_FORM)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (editingId !== null && form.id) {
        await api.rooms.update(form.id, {
          name: form.name,
          cashCurrency: form.cashCurrency,
          tournamentCurrency: form.tournamentCurrency,
          rateSource: form.rateSource || null,
          color: form.color,
          isWallet: form.isWallet
        })
      } else {
        await api.rooms.create({
          name: form.name,
          cashCurrency: form.cashCurrency,
          tournamentCurrency: form.tournamentCurrency,
          rateSource: form.rateSource || null,
          color: form.color,
          isWallet: form.isWallet
        })
      }
      resetForm()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function handleDelete(room: Room) {
    if (!window.confirm(`Удалить рум «${room.name}»? Вся история к этому руму (транзакции, турниры) будет удалена.`)) return
    setError(null)
    try {
      await api.rooms.remove(room.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-100 shadow-inner outline-none transition focus:border-slate-500'

  const balanceFor = (roomId: number) => balances?.balances.find((b) => b.roomId === roomId) ?? null

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {error && <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}

      <form onSubmit={handleSubmit} className="rounded-xl border border-slate-700 bg-slate-800/80 p-5 space-y-4 shadow-lg shadow-black/40">
        <h2 className="text-lg font-medium text-slate-100">{editingId !== null ? 'Редактировать рум' : 'Новый рум'}</h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Название</label>
            <RoomNameCombobox
              value={form.name}
              options={templates}
              placeholder="Введи название или выбери шаблон…"
              inputClass={inputCls}
              onType={(v) =>
                setForm((prev) => ({ ...prev, name: v, rateSource: v === appliedNameRef.current ? prev.rateSource : '' }))
              }
              onSelect={(t) => {
                appliedNameRef.current = t.insertName
                setForm((prev) => ({ ...prev, name: t.insertName, rateSource: t.rateSource }))
              }}
            />
          </div>
          <div ref={colorPickerRef} className="relative w-fit">
            <button
              type="button"
              onClick={() => setIsColorPickerOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={isColorPickerOpen}
              className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-100 shadow-inner outline-none transition focus:border-slate-500"
            >
              <span className="h-4 w-4 rounded-full border border-slate-600" style={{ backgroundColor: form.color }} />
              <span className="text-xs text-slate-400">{isColorPickerOpen ? '▲' : '▼'}</span>
            </button>
            {isColorPickerOpen && (
              <div className="z-10 absolute mt-2 w-56 rounded-md bg-slate-800 border border-slate-700 shadow-lg p-3">
                <div className="grid grid-cols-5 gap-2">
                  {ROOM_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Цвет ${c}`}
                      title={c}
                      onClick={() => {
                        setForm({ ...form, color: c })
                        setIsColorPickerOpen(false)
                      }}
                      className={`h-6 w-6 rounded-full transition ${
                        form.color === c ? 'ring-2 ring-slate-100 ring-offset-2 ring-offset-slate-800' : 'border border-slate-600 hover:scale-110'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Валюта кассы</label>
              <select className={inputCls} value={form.cashCurrency} onChange={(e) => setForm({ ...form, cashCurrency: e.target.value })}>
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Валюта турниров</label>
              <select className={inputCls} value={form.tournamentCurrency} onChange={(e) => setForm({ ...form, tournamentCurrency: e.target.value })}>
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.isWallet}
              onChange={(e) => setForm({ ...form, isWallet: e.target.checked })}
              className="h-4 w-4 rounded border-slate-700 bg-slate-900"
            />
            Кошелек (биржа/транзит — без турниров)
          </label>
        </div>
        <div className="flex gap-3">
          <button type="submit" className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-white">
            {editingId !== null ? 'Сохранить' : 'Добавить'}
          </button>
          {editingId !== null && (
            <button type="button" onClick={resetForm} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800/60">
              Отмена
            </button>
          )}
        </div>
      </form>

      <div className="rounded-xl border border-slate-700 bg-slate-800/80 overflow-hidden shadow-lg shadow-black/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3">Рум</th>
              <th className="px-4 py-3 text-right">Баланс</th>
              <th className="px-4 py-3">Касса</th>
              <th className="px-4 py-3">Турниры</th>
              <th className="px-4 py-3">Курс</th>
              <th className="px-4 py-3 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  Загрузка…
                </td>
              </tr>
            )}
            {!loading && rooms.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  Пока нет румов. Добавь первый.
                </td>
              </tr>
            )}
            {rooms.map((room) => (
              <tr key={room.id} className="border-b border-slate-800/60 last:border-0">
                <td className="px-4 py-3 font-medium">
                  <span style={{ color: room.color }}>{room.name}</span>
                  {room.isWallet && (
                    <span className="ml-2 rounded border border-slate-600 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                      Кошелек
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {(() => {
                    const b = balanceFor(room.id)
                    if (!b) return <span className="text-slate-600">—</span>
                    return (
                      <span className={b.amount === 0 ? 'text-slate-400' : 'text-slate-100'}>
                        {formatAmount(b.amount, b.currency)}
                        {b.currency !== 'USD' && b.amountUsd != null && (
                          <span className="ml-2 text-xs text-slate-500">≈ {formatAmount(b.amountUsd, 'USD')}</span>
                        )}
                      </span>
                    )
                  })()}
                </td>
                <td className="px-4 py-3 text-slate-300">{room.cashCurrency}</td>
                <td className="px-4 py-3 text-slate-300">{room.tournamentCurrency}</td>
                <td className="px-4 py-3 text-slate-500">{RATE_SOURCE_LABEL[room.rateSource ?? ''] ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => startEdit(room)} className="rounded px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-slate-100">
                      Изменить
                    </button>
                    <button onClick={() => handleDelete(room)} className="rounded px-2 py-1 text-xs text-red-400 transition hover:bg-red-950/40 hover:text-red-300">
                      Удалить
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}