import { useCallback, useEffect, useRef, useState } from 'react'
import { habitsApi } from './habits.api'
import { currentMonthKey } from './metrics'
import { applyItemOrder } from '../lib/reorder'
import type { HabitHistoryItem, HabitInput, HabitStatus, HabitWithLogs } from './habits.types'

function message(err: unknown): string {
  return err instanceof Error ? err.message : 'Не удалось выполнить запрос'
}

export interface HabitsState {
  habits: HabitWithLogs[] | null
  month: string
  isCurrentMonth: boolean
  error: string | null
  busy: boolean
  history: HabitHistoryItem[] | null
  historyLoading: boolean
  setMonth: (month: string) => void
  reload: () => Promise<void>
  applyOrder: (ids: number[]) => void
  reorder: (ids: number[]) => Promise<void>
  createHabit: (name: string, color: string) => Promise<void>
  updateHabit: (id: number, input: HabitInput) => Promise<void>
  setLog: (id: number, date: string, status: HabitStatus | null) => Promise<void>
  archiveHabit: (id: number) => Promise<void>
  loadHistory: () => Promise<void>
  restoreHabit: (id: number) => Promise<void>
}

export function useHabits(): HabitsState {
  const [habits, setHabits] = useState<HabitWithLogs[] | null>(null)
  const [month, setMonthState] = useState<string>(currentMonthKey())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<HabitHistoryItem[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const mountedRef = useRef(true)
  const seqRef = useRef(0)
  const historySeqRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = useCallback(async (targetMonth: string) => {
    const seq = ++seqRef.current
    setBusy(true)
    try {
      const list = await habitsApi.list(targetMonth)
      if (!mountedRef.current || seq !== seqRef.current) return
      setHabits(list)
      setError(null)
    } catch (err) {
      if (!mountedRef.current || seq !== seqRef.current) return
      setError(message(err))
    } finally {
      if (mountedRef.current && seq === seqRef.current) setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load(month)
  }, [load, month])

  const setMonth = useCallback((targetMonth: string) => {
    setMonthState(targetMonth)
  }, [])

  const reload = useCallback(async () => {
    await load(month)
  }, [load, month])

  const applyOrder = useCallback((ids: number[]) => {
    setHabits((prev) => (prev ? applyItemOrder(prev, ids) : prev))
  }, [])

  // The grid is dragged on the current month too, and the order is global — the
  // same habit keeps its place on every month. The request carries the ids in
  // their new order; a failure reloads the month so the grid never shows an
  // order the server does not have.
  const reorder = useCallback(
    async (ids: number[]) => {
      setHabits((prev) => (prev ? applyItemOrder(prev, ids) : prev))
      try {
        await habitsApi.reorder(ids)
        setError(null)
      } catch (err) {
        setError(message(err))
        await load(month)
      }
    },
    [load, month]
  )

  const createHabit = useCallback(
    async (name: string, color: string) => {
      try {
        const habit = await habitsApi.create(name, color)
        setError(null)
        setMonthState(currentMonthKey())
        if (month === currentMonthKey()) {
          setHabits((prev) => [{ ...habit, logs: {} }, ...(prev ?? [])])
        }
      } catch (err) {
        setError(message(err))
        throw err
      }
    },
    [month]
  )

  const updateHabit = useCallback(async (id: number, input: HabitInput) => {
    try {
      const habit = await habitsApi.update(id, input)
      setError(null)
      setHabits((prev) => (prev ? prev.map((h) => (h.id === id ? { ...h, ...habit } : h)) : prev))
      setHistory((prev) => (prev ? prev.map((h) => (h.id === id ? { ...h, ...habit } : h)) : prev))
    } catch (err) {
      setError(message(err))
      throw err
    }
  }, [])

  const setLog = useCallback(async (id: number, date: string, status: HabitStatus | null) => {
    try {
      await habitsApi.setLog(id, date, status)
      setError(null)
      setHabits((prev) =>
        prev ? prev.map((h) => (h.id === id ? { ...h, logs: applyLog(h.logs, date, status) } : h)) : prev
      )
    } catch (err) {
      setError(message(err))
      throw err
    }
  }, [])

  const archiveHabit = useCallback(async (id: number) => {
    try {
      await habitsApi.archive(id)
      setError(null)
      setHabits((prev) => (prev ? prev.filter((h) => h.id !== id) : prev))
      setHistory(null)
    } catch (err) {
      setError(message(err))
      throw err
    }
  }, [])

  const loadHistory = useCallback(async () => {
    const seq = ++historySeqRef.current
    setHistoryLoading(true)
    try {
      const list = await habitsApi.history()
      if (!mountedRef.current || seq !== historySeqRef.current) return
      setHistory(list)
      setError(null)
    } catch (err) {
      if (!mountedRef.current || seq !== historySeqRef.current) return
      setError(message(err))
    } finally {
      if (mountedRef.current && seq === historySeqRef.current) setHistoryLoading(false)
    }
  }, [])

  const restoreHabit = useCallback(
    async (id: number) => {
      try {
        await habitsApi.restore(id)
        setError(null)
        setHistory((prev) => (prev ? prev.filter((h) => h.id !== id) : prev))
        await load(month)
      } catch (err) {
        setError(message(err))
        throw err
      }
    },
    [load, month]
  )

  return {
    habits,
    month,
    isCurrentMonth: month === currentMonthKey(),
    error,
    busy,
    history,
    historyLoading,
    setMonth,
    reload,
    applyOrder,
    reorder,
    createHabit,
    updateHabit,
    setLog,
    archiveHabit,
    loadHistory,
    restoreHabit
  }
}

function applyLog(logs: Record<string, HabitStatus>, date: string, status: HabitStatus | null): Record<string, HabitStatus> {
  const next: Record<string, HabitStatus> = { ...logs }
  if (status === null) {
    delete next[date]
  } else {
    next[date] = status
  }
  return next
}
