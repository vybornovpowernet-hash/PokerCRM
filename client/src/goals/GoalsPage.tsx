import { useRef, useState } from 'react'
import { AnimatePresence, motion, Reorder } from 'motion/react'
import { GoalCard } from './components/GoalCard'
import { GoalCreator } from './components/GoalCreator'
import { GoalsBackground } from './components/GoalsBackground'
import { MonthPicker } from './components/MonthPicker'
import { addMonths, currentMonthKey, historyDate } from './metrics'
import { moveGoalId } from './order'
import { useDailyGoals } from './useDailyGoals'
import { useGoals } from './useGoals'
import type { GoalInput } from './goals.api'

type GoalsTab = 'active' | 'history' | 'daily'

const TABS: { id: GoalsTab; label: string }[] = [
  { id: 'active', label: 'Активные' },
  { id: 'history', label: 'История' },
  { id: 'daily', label: 'Ежедневник' }
]

export function GoalsPage() {
  const goals = useGoals()
  const daily = useDailyGoals()
  const [creating, setCreating] = useState(false)
  const [tab, setTab] = useState<GoalsTab>('active')
  const draggedOrder = useRef<number[] | null>(null)

  const loading = goals.goals === null || (tab === 'daily' && daily.goals === null)
  const pageError = goals.goals === null ? goals.error : null

  if (pageError) {
    return (
      <div className="relative z-10 flex min-h-[40vh] items-center justify-center">
        <GoalsBackground />
        <p className="text-sm text-rose-300">{pageError}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="relative z-10 flex min-h-[40vh] items-center justify-center">
        <GoalsBackground />
        <p className="text-sm text-slate-500">Загрузка…</p>
      </div>
    )
  }

  const create = async (input: GoalInput) => {
    await goals.createGoal(input)
    setCreating(false)
    daily.reload()
  }

  const activeGoals = goals.goals!.filter((goal) => goal.status === 'active' || goal.acknowledgedAt === null)
  const historyGoals = goals.goals!
    .filter((goal) => goal.acknowledgedAt !== null && goal.metric !== 'daily')
    .sort((a, b) => (historyDate(b) ?? '').localeCompare(historyDate(a) ?? ''))
  const dailyGoals = (daily.goals ?? [])
    .filter((goal) => goal.status !== 'active')
    .slice()
    .sort((a, b) => (b.deadline ?? '').localeCompare(a.deadline ?? '') || a.sortOrder - b.sortOrder)

  const visibleGoals: Record<GoalsTab, typeof activeGoals> = {
    active: activeGoals,
    history: historyGoals,
    daily: dailyGoals
  }
  const activeIds = activeGoals.map((goal) => goal.id)
  const counts: Record<GoalsTab, number> = {
    active: activeGoals.length,
    history: historyGoals.length,
    daily: dailyGoals.length
  }
  const dailyError = tab === 'daily' ? daily.error : null

  const defaultExpanded = tab !== 'history'

  // Reorder.Group fires onReorder while the pointer moves, so the drag only
  // previews the new order locally; it is written to the server once on release.
  const handleReorder = (ids: number[]) => {
    draggedOrder.current = ids
    goals.applyOrder(ids)
  }

  const commitOrder = () => {
    const ids = draggedOrder.current
    draggedOrder.current = null
    if (!ids) return
    void goals.reorder(ids).catch(() => undefined)
  }

  const moveGoal = (id: number, direction: -1 | 1) => {
    const next = moveGoalId(activeIds, id, direction)
    if (next === activeIds) return
    void goals.reorder(next).catch(() => undefined)
  }

  const renderCard = (goal: (typeof activeGoals)[number], sortable: boolean) => (
    <GoalCard
      key={goal.id}
      goal={goal}
      defaultExpanded={defaultExpanded}
      onClose={goals.closeGoal}
      onSetChecklist={goals.setChecklist}
      onAddEntry={goals.addEntry}
      onEditEntry={goals.editEntry}
      onDeleteEntry={goals.deleteEntry}
      onUploadImage={goals.uploadImage}
      readOnly={goal.status !== 'active'}
      sortable={sortable}
      onOrderCommit={commitOrder}
      onMove={moveGoal}
    />
  )

  const list = visibleGoals[tab]

  return (
    <div className="relative">
      <GoalsBackground />

      <div className="relative z-10">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-100">Цели</h2>
            <p className="mt-1 text-sm text-slate-400">Прогресс считается автоматически из балансов и турниров</p>
          </div>
          {!creating && (
            <button
              onClick={() => {
                setTab('active')
                setCreating(true)
              }}
              className="shrink-0 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400"
            >
              Новая цель
            </button>
          )}
        </div>

        {pageError === null && goals.error && (
          <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">{goals.error}</div>
        )}
        {dailyError && (
          <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">{dailyError}</div>
        )}

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5" role="tablist" aria-label="Разделы целей">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  tab === item.id ? 'bg-indigo-500/90 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.label}
                <span className={`ml-1.5 tabular-nums ${tab === item.id ? 'text-white/70' : 'text-slate-600'}`}>{counts[item.id]}</span>
              </button>
            ))}
          </div>
          {tab === 'daily' && (
            <MonthPicker
              month={daily.month}
              onPrev={daily.prevMonth}
              onNext={daily.nextMonth}
              nextDisabled={addMonths(daily.month, 1) > currentMonthKey()}
            />
          )}
        </div>

        <AnimatePresence initial={false}>
          {creating && tab === 'active' && (
            <motion.div
              key="creator"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <GoalCreator onCancel={() => setCreating(false)} onCreate={create} />
            </motion.div>
          )}
        </AnimatePresence>

        {list.length === 0 && !(creating && tab === 'active') && (
          <div className="rounded-2xl border border-dashed border-slate-700/70 bg-white/[0.02] p-12 text-center">
            {tab === 'active' ? (
              <>
                <p className="text-sm text-slate-400">Целей пока нет. Создайте первую — прогресс подтянется автоматически.</p>
                <button
                  onClick={() => setCreating(true)}
                  className="mt-4 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400"
                >
                  Создать цель
                </button>
              </>
            ) : tab === 'history' ? (
              <p className="text-sm text-slate-400">История пуста. Достигнутые и не достигнутые цели появятся здесь.</p>
            ) : (
              <p className="text-sm text-slate-400">Завершённых дел в этом месяце пока нет. Дела отмечайте во вкладке «Активные».</p>
            )}
          </div>
        )}

        {tab === 'active' ? (
          <Reorder.Group
            as="ul"
            axis="y"
            values={activeIds}
            onReorder={handleReorder}
            aria-label="Активные цели. Перетащите карточку или нажмите Alt+стрелка вверх/вниз, чтобы изменить порядок"
            className="flex flex-col gap-4"
          >
            <AnimatePresence initial={false}>{activeGoals.map((goal) => renderCard(goal, true))}</AnimatePresence>
          </Reorder.Group>
        ) : (
          <ul className="flex flex-col gap-4">
            <AnimatePresence initial={false}>{list.map((goal) => renderCard(goal, false))}</AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  )
}