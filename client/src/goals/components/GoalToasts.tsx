import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { goalsApi } from '../goals.api'
import { goalOutcomeTitle, goalPhrase } from '../metrics'
import { emitGoalsChanged, onGoalsChanged } from '../../lib/events'
import { usePoll } from '../../lib/usePoll'
import type { GoalWithProgress } from '../goals.types'

function pendingKey(goals: GoalWithProgress[]): string {
  return goals
    .filter((goal) => goal.status !== 'active' && goal.acknowledgedAt === null)
    .map((goal) => `${goal.id}:${goal.status}`)
    .join(',')
}

export function GoalToasts() {
  const [goals, setGoals] = useState<GoalWithProgress[]>([])
  const [busyId, setBusyId] = useState<number | null>(null)
  const signatureRef = useRef('')

  const load = async () => {
    try {
      const list = await goalsApi.list()
      const key = pendingKey(list)
      if (key !== signatureRef.current) {
        signatureRef.current = key
        emitGoalsChanged()
      }
      setGoals(list)
    } catch {
      // background poll / event refresh must never surface an unhandled rejection
    }
  }

  usePoll(load, 30_000)

  useEffect(() => onGoalsChanged(() => void load()), [])

  const pending = goals.filter((goal) => goal.status !== 'active' && goal.acknowledgedAt === null)

  const acknowledge = async (id: number) => {
    setBusyId(id)
    try {
      const updated = await goalsApi.acknowledge(id)
      setGoals((prev) => prev.map((goal) => (goal.id === id ? updated : goal)))
      emitGoalsChanged()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      <AnimatePresence initial={false}>
        {pending.map((goal) => {
          const achieved = goal.status === 'achieved'
          return (
            <motion.div
              key={goal.id}
              role="status"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-3 shadow-2xl shadow-black/50 backdrop-blur-xl ${
                achieved ? 'border-emerald-500/40 bg-emerald-950/80' : 'border-rose-500/40 bg-rose-950/80'
              }`}
            >
              <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${achieved ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${achieved ? 'text-emerald-200' : 'text-rose-200'}`}>
                  {goalOutcomeTitle(goal)}: {goalPhrase(goal)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void acknowledge(goal.id)}
                disabled={busyId === goal.id}
                aria-label="Подтвердить уведомление"
                className={`shrink-0 rounded-lg p-1 transition disabled:opacity-50 ${
                  achieved ? 'text-emerald-300/70 hover:bg-emerald-500/20 hover:text-emerald-100' : 'text-rose-300/70 hover:bg-rose-500/20 hover:text-rose-100'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
