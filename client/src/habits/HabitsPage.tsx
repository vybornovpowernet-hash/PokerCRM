import { useEffect, useRef, useState } from 'react'
import { DEFAULT_ROOM_COLOR } from '../lib/types'
import { moveItemId } from '../lib/reorder'
import { useHabits } from './useHabits'
import type { HabitWithLogs } from './habits.types'
import { charCount, MAX_HABIT_NAME } from './metrics'
import { MonthNavigator } from './components/MonthNavigator'
import { HabitTracker } from './components/HabitTracker'
import { HabitHistory } from './components/HabitHistory'
import { HabitEditor } from './components/HabitEditor'
import { ColorPicker } from './components/ColorPicker'

type View = 'tracker' | 'history'

const TABS: { key: View; label: string }[] = [
  { key: 'tracker', label: 'Трекер' },
  { key: 'history', label: 'История' }
]

export function HabitsPage() {
  const habits = useHabits()
  const [view, setView] = useState<View>('tracker')
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_ROOM_COLOR)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<HabitWithLogs | null>(null)
  const draggedOrder = useRef<number[] | null>(null)

  const { history, loadHistory } = habits

  useEffect(() => {
    if (history === null) void loadHistory()
  }, [history, loadHistory])

  const add = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving || charCount(name) > MAX_HABIT_NAME) return
    setSaving(true)
    try {
      await habits.createHabit(trimmed, color)
      setName('')
      setView('tracker')
    } finally {
      setSaving(false)
    }
  }

  if (habits.error && habits.habits === null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-rose-300">{habits.error}</p>
      </div>
    )
  }

  if (habits.habits === null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-slate-500">Загрузка…</p>
      </div>
    )
  }

  const tooLong = charCount(name) > MAX_HABIT_NAME

  // Reorder.Group fires onReorder while the pointer moves, so a drag only
  // previews the new order locally; it is written to the server once on release.
  const handleReorder = (ids: number[]) => {
    draggedOrder.current = ids
    habits.applyOrder(ids)
  }

  const commitOrder = () => {
    const ids = draggedOrder.current
    draggedOrder.current = null
    if (!ids) return
    void habits.reorder(ids).catch(() => undefined)
  }

  const moveHabit = (id: number, direction: -1 | 1) => {
    const ids = (habits.habits ?? []).map((habit) => habit.id)
    const next = moveItemId(ids, id, direction)
    if (next === ids) return
    void habits.reorder(next).catch(() => undefined)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-100">Привычки</h2>
          <p className="mt-1 text-sm text-slate-400">Отмечайте выполненные или пропущенные дни в сетке</p>
        </div>
        <div className="inline-flex rounded-xl border border-white/10 bg-slate-900/50 p-1" role="tablist" aria-label="Разделы привычек">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={view === tab.key}
              onClick={() => setView(tab.key)}
              className={`rounded-lg px-3.5 py-1.5 text-sm transition-colors duration-150 ${
                view === tab.key ? 'bg-slate-700/70 font-medium text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {habits.error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">{habits.error}</div>
      )}

      {view === 'history' ? (
        <HabitHistory items={history ?? []} loading={habits.historyLoading} onRestore={habits.restoreHabit} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <form
              className="relative z-20 flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded-2xl border border-white/[0.06] bg-slate-800/50 p-2 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.95)] ring-1 ring-inset ring-white/[0.03] backdrop-blur-xl"
              onSubmit={(e) => {
                e.preventDefault()
                void add()
              }}
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Новая привычка"
                aria-label="Название новой привычки"
                className="min-w-56 flex-1 rounded-xl border border-white/10 bg-slate-900/60 px-3.5 py-2.5 text-sm text-slate-100 outline-none transition-colors duration-150 placeholder:text-slate-500 focus-visible:border-indigo-400/60 focus-visible:ring-2 focus-visible:ring-indigo-500/20"
              />
              <ColorPicker value={color} onChange={setColor} label="Цвет новой привычки" />
              <button
                type="submit"
                disabled={!name.trim() || saving || tooLong}
                className="rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Добавить
              </button>
            </form>
            <MonthNavigator month={habits.month} onMonthChange={(m) => habits.setMonth(m)} />
          </div>

          {habits.habits.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.06] bg-slate-800/40 p-10 text-center text-sm text-slate-500 ring-1 ring-inset ring-white/[0.03]">
              Привычек пока нет. Добавьте первую, чтобы вести трекинг.
            </div>
          ) : (
            <HabitTracker
              habits={habits.habits}
              month={habits.month}
              isCurrentMonth={habits.isCurrentMonth}
              onSetLog={habits.setLog}
              onEdit={setEditing}
              onArchive={habits.archiveHabit}
              onReorder={handleReorder}
              onOrderCommit={commitOrder}
              onMove={moveHabit}
            />
          )}
        </>
      )}

      {editing && (
        <HabitEditor
          habit={editing}
          onSave={async (input) => {
            await habits.updateHabit(editing.id, input)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
