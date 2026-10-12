import { withTransaction } from '../../db.js'
import { dayKey } from '../../lib/date.js'
import { getResolver } from './metrics.js'
import { entryExists, insertEntry, listEntries, requireGoal, settleGoal } from './db.js'
import type { Goal, GoalMetric, GoalProgress, GoalWithProgress, GoalsFacts } from './types.js'

const MILESTONES = [50, 75] as const

function isBinaryMetric(metric: GoalMetric): boolean {
  return metric === 'custom' || metric === 'daily'
}

function metricPercent(goal: Goal, value: number): number {
  return goal.targetUnits > 0 ? Math.min(100, Math.floor((value * 100) / goal.targetUnits)) : 0
}

function emitIfMissing(goal: Goal, milestone: number, content: string): void {
  if (!entryExists(goal.id, milestone)) {
    insertEntry(goal.id, 'system', content, milestone)
  }
}

/**
 * Live progress of a goal as of now. Exported so `closeGoal` can freeze the
 * exact snapshot that the history view shows.
 */
export function computeProgress(goal: Goal, facts: GoalsFacts): GoalProgress {
  const hasChecklist = goal.checklist.length > 0
  if (isBinaryMetric(goal.metric)) {
    const completedCount = goal.checklist.filter((item) => item.status === 'completed').length
    return hasChecklist
      ? { currentUnits: completedCount, percent: Math.floor((completedCount * 100) / goal.checklist.length), blank: false }
      : { currentUnits: null, percent: goal.status === 'achieved' ? 100 : 0, blank: false }
  }
  const current = getResolver(goal.metric).current(facts)
  return { currentUnits: current, percent: metricPercent(goal, current ?? 0), blank: current === null }
}

/**
 * A terminal goal shows the progress frozen at close time, not a value that
 * keeps drifting with the live bankroll.
 */
function withSnapshot(goal: Goal, computed: GoalProgress): GoalProgress {
  if (goal.status !== 'active' && goal.finalPercent !== null) {
    return { currentUnits: goal.finalUnits, percent: goal.finalPercent, blank: false }
  }
  return computed
}

export function reconcileGoal(goal: Goal, facts: GoalsFacts): GoalWithProgress {
  const progress = computeProgress(goal, facts)

  // Terminal goals (achieved/failed/closed) are immutable history: no
  // milestones, no auto-settle, only the frozen snapshot.
  if (goal.status !== 'active') {
    return { ...goal, progress: withSnapshot(goal, progress), entries: listEntries(goal.id) }
  }

  const hasChecklist = goal.checklist.length > 0
  const isBinary = isBinaryMetric(goal.metric)
  const allCompleted = hasChecklist && goal.checklist.every((item) => item.status === 'completed')
  const hasPending = goal.checklist.some((item) => item.status === 'pending')
  const resolver = getResolver(goal.metric)
  const current = isBinary ? null : resolver.current(facts)
  const value = current ?? 0
  const deadlinePassed = goal.deadline !== null && dayKey() > goal.deadline

  // Strict AND gate: a metric goal needs BOTH the metric and the checklist
  // (when present); a custom/daily checklist goal is done by its checklist alone.
  const metricReached = !isBinary && current !== null && value >= goal.targetUnits
  const reached = isBinary ? allCompleted : hasChecklist ? metricReached && allCompleted : metricReached

  // A daily goal is owned by its day: once every item is resolved it settles on
  // the spot. All completed is a win; a failed item makes the whole day a miss.
  const dailyResolvedWithFailure = goal.metric === 'daily' && hasChecklist && !hasPending && !allCompleted

  // Deadline auto-fail only when progress is trackable: a metric goal must have
  // a converted current value (blank bankroll days stay conservative), a
  // custom/daily checklist goal always is. A binary goal without a checklist
  // is manual.
  const canFailOnDeadline = isBinary ? hasChecklist : current !== null

  // A daily goal is owned by its day, so any automatic resolution is final on
  // the spot: no acknowledgement toast, it lands straight in the daily history.
  const autoAck = goal.metric === 'daily'

  let updated: Goal = goal
  if (reached) {
    updated = withTransaction(() => {
      const content = isBinary ? 'Все пункты выполнены' : resolver.achievedContent(current as number)
      emitIfMissing(goal, 100, content)
      settleGoal(goal.id, 'achieved', { percent: 100, units: progress.currentUnits }, autoAck)
      return requireGoal(goal.id)
    })
  } else if (dailyResolvedWithFailure) {
    updated = withTransaction(() => {
      insertEntry(goal.id, 'system', 'Не все пункты выполнены', null)
      settleGoal(goal.id, 'failed', { percent: progress.percent, units: progress.currentUnits }, autoAck)
      return requireGoal(goal.id)
    })
  } else if (canFailOnDeadline && deadlinePassed) {
    updated = withTransaction(() => {
      insertEntry(goal.id, 'system', 'Время цели истекло, цель не достигнута', null)
      settleGoal(goal.id, 'failed', { percent: progress.percent, units: progress.currentUnits }, autoAck)
      return requireGoal(goal.id)
    })
  } else if (!isBinary && current !== null) {
    updated = withTransaction(() => {
      for (const milestone of MILESTONES) {
        const threshold = Math.floor((goal.targetUnits * milestone) / 100)
        if (value < threshold) break
        emitIfMissing(goal, milestone, resolver.milestoneContent(milestone, current as number))
      }
      return requireGoal(goal.id)
    })
  }

  return { ...updated, progress: withSnapshot(updated, progress), entries: listEntries(updated.id) }
}

/**
 * Reconciling a goal whose state is already terminal never touches the facts or
 * mutates anything: the progress is the frozen snapshot and the entries are
 * read-only history. `listGoals` uses this instead of `reconcileGoal` when the
 * whole requested subset is finished (e.g. the monthly daily view), so a
 * read-only query never pays for `collectGoalsFacts`.
 */
export function lightReconcile(goal: Goal): GoalWithProgress {
  const progress =
    goal.finalPercent !== null ? { currentUnits: goal.finalUnits, percent: goal.finalPercent, blank: false } : { currentUnits: null, percent: 0, blank: false }
  return { ...goal, progress, entries: listEntries(goal.id) }
}
