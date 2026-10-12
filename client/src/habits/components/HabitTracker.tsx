import { useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Reorder, useDragControls } from 'motion/react'
import type { HabitStatus, HabitWithLogs } from '../habits.types'
import { dayKey, dayLabel, habitMonthProgress, monthDays, overallMonthProgress, pluralRu, type MonthDay } from '../metrics'
import { HabitPopover } from './HabitPopover'
import { CloseIcon, GripIcon, PencilIcon } from './icons'

interface HabitTrackerProps {
  habits: HabitWithLogs[]
  month: string
  isCurrentMonth: boolean
  onSetLog: (id: number, date: string, status: HabitStatus | null) => Promise<void>
  onEdit: (habit: HabitWithLogs) => void
  onArchive: (id: number) => Promise<void>
  onReorder: (ids: number[]) => void
  onOrderCommit: () => void
  onMove: (id: number, direction: -1 | 1) => void
}

interface Anchor {
  habitId: number
  date: string
  x: number
  cellTop: number
  cellBottom: number
}

interface HabitRowProps {
  habit: HabitWithLogs
  days: MonthDay[]
  today: string
  isCurrentMonth: boolean
  confirmDelete: number | null
  setConfirmDelete: (id: number | null) => void
  onEdit: (habit: HabitWithLogs) => void
  onArchive: (id: number) => Promise<void>
  onOpenCell: (anchor: Anchor) => void
  onOrderCommit: () => void
  onMove: (id: number, direction: -1 | 1) => void
}

const actionCls =
  'flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors duration-150 hover:bg-white/5 hover:text-slate-200'

export function HabitTracker({ habits, month, isCurrentMonth, onSetLog, onEdit, onArchive, onReorder, onOrderCommit, onMove }: HabitTrackerProps) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  const days = monthDays(month)
  const today = dayKey(new Date())
  const overall = overallMonthProgress(habits, days)
  const anchorHabit = anchor ? habits.find((h) => h.id === anchor.habitId) : undefined

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-slate-800/60 shadow-[0_30px_90px_-40px_rgba(0,0,0,0.95)] ring-1 ring-inset ring-white/[0.03] backdrop-blur-xl">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-48 border-b border-white/[0.06] border-r border-r-white/[0.05] bg-slate-800 px-3.5 py-2.5 text-left text-xs font-medium text-slate-400">
                Привычка
              </th>
              {days.map((d) => (
                <th
                  key={d.date}
                  className={`min-w-8 border-b border-white/[0.06] px-0.5 py-2 text-center ${
                    d.date === today ? 'bg-indigo-400/[0.07]' : ''
                  }`}
                >
                  <div className={`text-xs font-semibold tabular-nums ${d.date === today ? 'text-indigo-200' : 'text-slate-300'}`}>
                    {d.day}
                  </div>
                  <div className={`text-[10px] ${d.weekend ? 'text-rose-400/60' : 'text-slate-600'}`}>{d.weekday}</div>
                </th>
              ))}
              <th className="min-w-16 border-b border-l border-white/[0.06] border-l-white/[0.05] px-2 py-2 text-center text-[11px] font-medium text-slate-400">
                Прогресс
              </th>
            </tr>
          </thead>
          <Reorder.Group
            as="tbody"
            axis="y"
            values={habits.map((h) => h.id)}
            onReorder={onReorder}
            aria-label="Порядок привычек. Перетащите строку или нажмите Alt + стрелки вверх/вниз, чтобы переместить привычку"
          >
            {habits.map((h) => (
              <HabitRow
                key={h.id}
                habit={h}
                days={days}
                today={today}
                isCurrentMonth={isCurrentMonth}
                confirmDelete={confirmDelete}
                setConfirmDelete={setConfirmDelete}
                onEdit={onEdit}
                onArchive={onArchive}
                onOpenCell={setAnchor}
                onOrderCommit={onOrderCommit}
                onMove={onMove}
              />
            ))}
          </Reorder.Group>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-3.5 py-2.5 text-xs text-slate-400">
        <span>Общий прогресс за месяц</span>
        <span className="tabular-nums text-slate-300">
          <span className="font-semibold">{overall.percent === null ? '—' : `${overall.percent}%`}</span>
          <span className="text-slate-500">
            {' '}
            · {overall.success} из {overall.tracked} {pluralRu(overall.tracked, 'отметки', 'отметок', 'отметок')}
          </span>
        </span>
      </div>

      {anchor && anchorHabit && (
        <HabitPopover
          x={anchor.x}
          cellTop={anchor.cellTop}
          cellBottom={anchor.cellBottom}
          label={`${anchorHabit.name} · ${dayLabel(anchor.date)}`}
          status={anchorHabit.logs[anchor.date] ?? null}
          onSelect={(status) => {
            setAnchor(null)
            void onSetLog(anchor.habitId, anchor.date, status)
          }}
          onClose={() => setAnchor(null)}
        />
      )}
    </div>
  )
}

function HabitRow({
  habit,
  days,
  today,
  isCurrentMonth,
  confirmDelete,
  setConfirmDelete,
  onEdit,
  onArchive,
  onOpenCell,
  onOrderCommit,
  onMove
}: HabitRowProps) {
  const dragControls = useDragControls()
  const [dragging, setDragging] = useState(false)

  const progress = habitMonthProgress(habit, days)
  const progressCls =
    progress === null ? 'text-slate-600' : progress >= 80 ? 'text-emerald-300' : progress >= 50 ? 'text-amber-300' : 'text-rose-300'

  // The whole row is the grab surface, but a press on a day cell or on an action
  // belongs to that control: framer only skips drags that start on text inputs,
  // so the listener is disabled entirely and started by hand here. The grip is a
  // button too, hence the explicit `data-drag-handle` escape hatch.
  const startDrag = (event: ReactPointerEvent<HTMLTableRowElement>) => {
    if (event.button !== 0) return
    const target = event.target as Element | null
    if (!target) return
    if (!target.closest('[data-drag-handle]') && target.closest('button, a, input, select, textarea, [data-no-drag]')) return
    dragControls.start(event)
  }

  const moveByKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    onMove(habit.id, event.key === 'ArrowUp' ? -1 : 1)
  }

  return (
    <Reorder.Item
      as="tr"
      value={habit.id}
      layout
      dragListener={false}
      dragControls={dragControls}
      dragElastic={0}
      onPointerDown={startDrag}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => {
        setDragging(false)
        onOrderCommit()
      }}
      className="group relative"
    >
      <td
        className={`sticky left-0 z-10 border-b border-white/[0.04] border-r border-r-white/[0.05] px-3.5 py-1.5 ${
          dragging ? 'bg-slate-700' : 'bg-slate-800'
        }`}
        style={{ minWidth: '12rem' }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              data-drag-handle
              onKeyDown={moveByKeyboard}
              aria-label={`Переместить «${habit.name}». Перетащите строку или нажмите Alt + стрелку вверх/вниз`}
              title="Перетащите или Alt+↑/↓"
              className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center rounded text-slate-700 transition-colors duration-150 hover:text-slate-400 focus-visible:text-slate-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400/50 active:cursor-grabbing"
            >
              <GripIcon className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-0 truncate text-[15px] font-medium" style={{ color: habit.color }} title={habit.name}>
              {habit.name}
            </span>
          </div>
          <div className="flex w-14 shrink-0 items-center justify-end gap-0.5">
            {isCurrentMonth && !habit.archivedAt && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(null)
                    onEdit(habit)
                  }}
                  aria-label={`Изменить ${habit.name}`}
                  title="Изменить"
                  className={`${actionCls} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
                >
                  <PencilIcon />
                </button>
                {confirmDelete === habit.id ? (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDelete(null)
                      void onArchive(habit.id)
                    }}
                    aria-label={`Подтвердить удаление: ${habit.name}`}
                    title="Подтвердить удаление"
                    className="rounded-md bg-rose-500/20 px-1.5 py-0.5 text-[11px] font-medium text-rose-300 transition hover:bg-rose-500/30"
                  >
                    Точно?
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(habit.id)}
                    aria-label={`Удалить ${habit.name}`}
                    title="Убрать в архив"
                    className={`${actionCls} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
                  >
                    <CloseIcon />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </td>
      {days.map((d) => {
        const status = habit.logs[d.date] ?? null
        const isToday = d.date === today
        return (
          <td key={d.date} className={`border-b border-white/[0.04] p-0.5 text-center ${isToday ? 'bg-indigo-400/[0.07]' : ''}`}>
            <button
              type="button"
              aria-label={`${habit.name}, ${d.day} ${d.weekday}`}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                onOpenCell({ habitId: habit.id, date: d.date, x: rect.left, cellTop: rect.top, cellBottom: rect.bottom })
              }}
              className={`h-9 w-full rounded-md text-sm transition-colors duration-150 ${
                status === 'done'
                  ? 'bg-emerald-500/15 font-semibold text-emerald-300 hover:bg-emerald-500/25'
                  : status === 'partial'
                    ? 'bg-amber-500/15 font-semibold text-amber-300 hover:bg-amber-500/25'
                    : status === 'missed'
                      ? 'bg-rose-500/15 font-semibold text-rose-300 hover:bg-rose-500/25'
                      : isToday
                        ? 'bg-slate-700/40 text-slate-500 ring-1 ring-inset ring-indigo-400/40 hover:text-slate-300'
                        : 'text-slate-500 opacity-0 group-hover:opacity-100 hover:text-slate-200'
              }`}
            >
              {status === 'done' ? '✓' : status === 'partial' ? '%' : status === 'missed' ? '✕' : '·'}
            </button>
          </td>
        )
      })}
      <td className="border-b border-white/[0.04] border-l border-l-white/[0.05] px-1.5 py-0.5 text-center">
        <span className={`text-xs font-semibold tabular-nums ${progressCls}`}>{progress === null ? '—' : `${progress}%`}</span>
      </td>
    </Reorder.Item>
  )
}
