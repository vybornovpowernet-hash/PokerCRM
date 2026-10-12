import { useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react'
import { AchievedHalo } from './AchievedHalo'
import { ConfirmDialog } from './ConfirmDialog'
import { EntryComposer } from './EntryComposer'
import { GoalChecklist } from './GoalChecklist'
import { GoalOutcomeDialog } from './GoalOutcomeDialog'
import { GoalRing } from './GoalRing'
import { GoalTimeline } from './GoalTimeline'
import {
  checklistProgressLabel,
  currentLabel,
  formatDateShort,
  goalPhrase,
  goalTimeLabel,
  historyDate,
  STATUS_LABELS,
  targetLabel
} from '../metrics'
import type { ChecklistItem, GoalCloseOutcome, GoalStatus, GoalWithProgress } from '../goals.types'

interface GoalCardProps {
  goal: GoalWithProgress
  defaultExpanded?: boolean
  onClose: (id: number, outcome: GoalCloseOutcome) => Promise<unknown>
  onSetChecklist: (id: number, items: ChecklistItem[]) => Promise<unknown>
  onAddEntry: (id: number, content: string, images: string[]) => Promise<unknown>
  onEditEntry: (id: number, entryId: number, content: string, images: string[]) => Promise<unknown>
  onDeleteEntry: (id: number, entryId: number) => Promise<unknown>
  onUploadImage: (file: File) => Promise<string>
  readOnly?: boolean
  sortable?: boolean
  onOrderCommit?: () => void
  onMove?: (id: number, direction: -1 | 1) => void
}

const STATUS_CHIP: Record<GoalStatus, string> = {
  active: 'border-slate-600/60 bg-slate-500/10 text-slate-300',
  achieved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  failed: 'border-rose-500/40 bg-rose-500/10 text-rose-300'
}

const STATUS_CHIP_DOT: Record<GoalStatus, string> = {
  active: 'bg-slate-400',
  achieved: 'bg-emerald-400',
  failed: 'bg-rose-400'
}

interface PendingClose {
  outcome: GoalCloseOutcome
  title: string
  message: string
  confirmLabel: string
  tone: 'danger' | 'default'
}

export function GoalCard({ goal, defaultExpanded = false, onClose, onSetChecklist, onAddEntry, onEditEntry, onDeleteEntry, onUploadImage, readOnly = false, sortable = false, onOrderCommit, onMove }: GoalCardProps) {
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingClose | null>(null)
  const [outcomeOpen, setOutcomeOpen] = useState(false)
  const [override, setOverride] = useState<boolean | null>(null)
  const open = override ?? defaultExpanded
  const dragControls = useDragControls()
  const dragged = useRef(false)

  const isBinary = goal.metric === 'custom' || goal.metric === 'daily'
  const hasChecklist = goal.checklist.length > 0
  const hasProgress = !isBinary || hasChecklist
  const pct = goal.progress.blank ? 0 : goal.progress.percent
  const isActive = goal.status === 'active'
  const timeInfo = goalTimeLabel(goal)
  const completed = historyDate(goal)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const confirmClose = async () => {
    if (!pending) return
    const outcome = pending.outcome
    setPending(null)
    await run(() => onClose(goal.id, outcome)).catch(() => undefined)
  }

  const chooseOutcome = async (outcome: GoalCloseOutcome) => {
    setOutcomeOpen(false)
    await run(() => onClose(goal.id, outcome)).catch(() => undefined)
  }

  // The whole card is the grab surface, but a press that lands on a control
  // (text field, link, or anything flagged with `data-no-drag`) must be left to
  // that control. Framer only skips drags that start on text inputs, so the
  // listener is disabled entirely and started by hand here.
  const startDrag = (event: ReactPointerEvent<HTMLLIElement>) => {
    if (event.button !== 0) return
    const target = event.target as Element | null
    if (target?.closest('input, textarea, select, a, [data-no-drag]')) return
    dragged.current = false
    dragControls.start(event)
  }

  const toggleCard = () => {
    // A drag ends with a plain click on whatever is under the pointer; that
    // click must not also expand the card.
    if (dragged.current) {
      dragged.current = false
      return
    }
    setOverride((prev) => ((prev ?? defaultExpanded) ? false : true))
  }

  const moveByKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!sortable || !onMove || !event.altKey) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    onMove(goal.id, event.key === 'ArrowUp' ? -1 : 1)
  }

  const cardClass = `relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/40 backdrop-blur-xl ${
    sortable ? 'group cursor-grab active:cursor-grabbing' : ''
  }`

  const cardBody = (
    <>
      <AchievedHalo active={goal.status === 'achieved'} />

      <div className="absolute right-5 top-5 z-10 flex items-center gap-3" data-no-drag>
        {sortable && (
          <span aria-hidden="true" className="text-slate-600 transition-colors duration-150 group-hover:text-slate-400">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.6" />
              <circle cx="15" cy="6" r="1.6" />
              <circle cx="9" cy="12" r="1.6" />
              <circle cx="15" cy="12" r="1.6" />
              <circle cx="9" cy="18" r="1.6" />
              <circle cx="15" cy="18" r="1.6" />
            </svg>
          </span>
        )}
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_CHIP[goal.status]}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_CHIP_DOT[goal.status]}`} />
          {STATUS_LABELS[goal.status]}
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setOutcomeOpen(true)}
            disabled={busy}
            aria-label="Закрыть цель"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-500/15 hover:text-slate-200 disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={toggleCard}
        onKeyDown={moveByKeyboard}
        aria-expanded={open}
        aria-controls={`goal-details-${goal.id}`}
        className="block w-full rounded-xl text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50"
      >
        <div className="flex items-start gap-6 pr-16">
          <GoalRing percent={pct} status={goal.status} binary={isBinary && !hasChecklist} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-semibold tracking-tight text-slate-100">{goalPhrase(goal)}</h3>
              <span
                aria-hidden="true"
                className={`ml-auto shrink-0 text-slate-500 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </div>

            {hasProgress && (
              <p className="mt-1.5 text-sm text-slate-400">
                {isBinary ? (
                  <>
                    <span className="font-medium tabular-nums text-slate-200">{checklistProgressLabel(goal.checklist)}</span>
                    <span className="mx-1.5 text-slate-600">выполнено</span>
                  </>
                ) : goal.progress.blank ? (
                  <span className="text-amber-300/90">Прогресс недоступен — не хватает данных о курсах</span>
                ) : (
                  <>
                    <span className="font-medium tabular-nums text-slate-200">{currentLabel(goal.metric, goal.progress.currentUnits as number)}</span>
                    <span className="mx-1.5 text-slate-600">из</span>
                    {targetLabel(goal)}
                  </>
                )}
              </p>
            )}

            {!isActive && completed ? (
              <p className="mt-1 text-xs text-slate-500">
                {STATUS_LABELS[goal.status]} · {formatDateShort(completed)}
              </p>
            ) : (
              <p className={`mt-1 text-xs ${timeInfo.overdue ? 'text-rose-300/90' : 'text-slate-500'}`}>
                {timeInfo.text}
                {goal.deadline && <span className="text-slate-600"> · до {formatDateShort(goal.deadline)}</span>}
              </p>
            )}

            {hasProgress && (
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-800/80">
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    backgroundColor: goal.status === 'failed' ? '#fb7185' : '#34d399'
                  }}
                  initial={{ width: '0%' }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.9, ease: 'easeOut' }}
                />
              </div>
            )}
          </div>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="details"
            id={`goal-details-${goal.id}`}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="overflow-hidden"
            data-no-drag
          >
            <div className="mt-5 border-t border-white/5 pt-5">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Чеклист
                <span className="h-px flex-1 bg-gradient-to-r from-slate-700 to-transparent" />
              </div>

              <GoalChecklist
                items={goal.checklist}
                busy={busy}
                readOnly={readOnly}
                onChange={(items) => onSetChecklist(goal.id, items)}
              />
            </div>

            <div className="mt-5 border-t border-white/5 pt-5">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Дневник
                <span className="h-px flex-1 bg-gradient-to-r from-slate-700 to-transparent" />
              </div>

              <GoalTimeline
                entries={goal.entries}
                readonly={readOnly}
                busy={busy}
                onEditEntry={(entryId, content, images) => onEditEntry(goal.id, entryId, content, images)}
                onDeleteEntry={(entryId) => onDeleteEntry(goal.id, entryId)}
              />

              {!readOnly && (
                <div className="mt-4">
                  <EntryComposer
                    busy={busy}
                    onAdd={(content, images) => onAddEntry(goal.id, content, images)}
                    onUpload={onUploadImage}
                    actions={
                      goal.status === 'active' && (
                        <div className="flex flex-wrap items-center gap-2">
                          {isBinary && goal.checklist.length === 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setPending({
                                  outcome: 'achieved',
                                  title: goal.metric === 'daily' ? 'День выполнен?' : 'Отметить цель выполненной?',
                                  message: goal.metric === 'daily' ? 'Дело перейдёт в ежедневник как выполненное.' : 'Цель перейдёт в историю как достигнутая.',
                                  confirmLabel: goal.metric === 'daily' ? 'Выполнено' : 'Выполнена',
                                  tone: 'default'
                                })
                              }
                              disabled={busy}
                              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
                            >
                              {goal.metric === 'daily' ? 'Выполнено' : 'Выполнена'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setPending({
                                outcome: 'failed',
                                title: goal.metric === 'daily' ? 'День не выполнен?' : 'Отметить цель не достигнутой?',
                                message: goal.metric === 'daily' ? 'Дело перейдёт в ежедневник как не выполненное.' : 'Цель перейдёт в историю как не достигнутая.',
                                confirmLabel: 'Завершить',
                                tone: isBinary ? 'default' : 'danger'
                              })
                            }
                            disabled={busy}
                            className={`rounded-lg border px-3 py-1.5 text-sm transition disabled:opacity-50 ${
                              isBinary
                                ? 'border-slate-600/60 text-slate-300 hover:bg-slate-700/40'
                                : 'border-rose-500/40 text-rose-300 hover:bg-rose-500/10'
                            }`}
                          >
                            Завершить
                          </button>
                        </div>
                      )
                    }
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {pending && (
        <ConfirmDialog
          title={pending.title}
          message={pending.message}
          confirmLabel={pending.confirmLabel}
          tone={pending.tone}
          busy={busy}
          onConfirm={() => void confirmClose()}
          onCancel={() => setPending(null)}
        />
      )}

      {outcomeOpen && (
        <GoalOutcomeDialog
          goalName={goalPhrase(goal)}
          busy={busy}
          onChoose={(outcome) => void chooseOutcome(outcome)}
          onCancel={() => setOutcomeOpen(false)}
        />
      )}
    </>
  )

  const enterExit = {
    initial: { opacity: 0, scale: 0.96, y: 10 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.96, transition: { duration: 0.15 } }
  }

  if (sortable) {
    return (
      <Reorder.Item
        value={goal.id}
        layout
        {...enterExit}
        dragListener={false}
        dragControls={dragControls}
        dragElastic={0}
        whileDrag={{ scale: 1.015 }}
        onPointerDown={startDrag}
        onDragStart={() => {
          dragged.current = true
        }}
        onDragEnd={() => onOrderCommit?.()}
        className={cardClass}
      >
        {cardBody}
      </Reorder.Item>
    )
  }

  return (
    <motion.li layout {...enterExit} className={cardClass}>
      {cardBody}
    </motion.li>
  )
}
