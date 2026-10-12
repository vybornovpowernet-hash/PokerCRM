import { useCallback, useEffect, useRef, useState } from 'react'
import { goalsApi } from './goals.api'
import { onGoalsChanged } from '../lib/events'
import { addMonths, currentMonthKey, monthEnd, monthStart } from './metrics'
import type { GoalWithProgress } from './goals.types'

export interface DailyGoalsState {
  month: string
  goals: GoalWithProgress[] | null
  error: string | null
  goToMonth: (month: string) => void
  prevMonth: () => void
  nextMonth: () => void
  reload: () => Promise<void>
}

export function useDailyGoals(): DailyGoalsState {
  const [month, setMonth] = useState<string>(currentMonthKey())
  const [goals, setGoals] = useState<GoalWithProgress[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cacheRef = useRef(new Map<string, GoalWithProgress[]>())
  const monthRef = useRef(month)
  monthRef.current = month

  const load = useCallback(async (monthKey: string) => {
    try {
      const list = await goalsApi.list({
        metric: 'daily',
        startDate: monthStart(monthKey),
        endDate: monthEnd(monthKey),
        includeFinishedDaily: '1',
        finishedOnly: '1'
      })
      const normalized = list ?? []
      cacheRef.current.set(monthKey, normalized)
      if (monthRef.current === monthKey) {
        setGoals(normalized)
        setError(null)
      }
    } catch (err) {
      if (monthRef.current === monthKey) {
        setError(err instanceof Error ? err.message : 'Не удалось загрузить ежедневник')
      }
    }
  }, [])

  useEffect(() => {
    void load(month)
  }, [load, month])

  useEffect(() => onGoalsChanged(() => void load(month)), [load, month])

  const goToMonth = useCallback(
    (monthKey: string) => {
      setMonth(monthKey)
      const cached = cacheRef.current.get(monthKey)
      if (cached) {
        setGoals(cached)
      } else {
        void load(monthKey)
      }
    },
    [load]
  )

  const prevMonth = useCallback(() => goToMonth(addMonths(month, -1)), [goToMonth, month])
  const nextMonth = useCallback(() => goToMonth(addMonths(month, 1)), [goToMonth, month])
  const reload = useCallback(() => load(month), [load, month])

  return { month, goals, error, goToMonth, prevMonth, nextMonth, reload }
}