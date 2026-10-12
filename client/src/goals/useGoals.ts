import { useCallback, useEffect, useState } from 'react'
import { goalsApi, type GoalInput } from './goals.api'
import { applyGoalOrder } from './order'
import { emitGoalsChanged, onGoalsChanged } from '../lib/events'
import type { ChecklistItem, GoalCloseOutcome, GoalWithProgress } from './goals.types'

function message(err: unknown): string {
  return err instanceof Error ? err.message : 'Не удалось выполнить запрос'
}

export interface GoalsState {
  goals: GoalWithProgress[] | null
  error: string | null
  busy: boolean
  applyOrder: (ids: number[]) => void
  reorder: (ids: number[]) => Promise<GoalWithProgress[]>
  reload: () => Promise<void>
  createGoal: (input: GoalInput) => Promise<GoalWithProgress>
  closeGoal: (id: number, outcome: GoalCloseOutcome) => Promise<GoalWithProgress>
  acknowledge: (id: number) => Promise<GoalWithProgress>
  setChecklist: (id: number, items: ChecklistItem[]) => Promise<GoalWithProgress>
  addEntry: (id: number, content: string, images: string[]) => Promise<void>
  editEntry: (id: number, entryId: number, content: string, images: string[]) => Promise<void>
  deleteEntry: (id: number, entryId: number) => Promise<void>
  uploadImage: (file: File) => Promise<string>
}

function apiError(setError: (msg: string | null) => void, err: unknown): void {
  setError(message(err))
}

export function useGoals(): GoalsState {
  const [goals, setGoals] = useState<GoalWithProgress[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const applyOrder = useCallback((ids: number[]) => {
    setGoals((prev) => (prev ? applyGoalOrder(prev, ids) : prev))
  }, [])

  const reload = useCallback(async () => {
    setBusy(true)
    try {
      setGoals(await goalsApi.list())
      setError(null)
    } catch (err) {
      apiError(setError, err)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => onGoalsChanged(() => void reload()), [reload])

  const reorder = useCallback(
    async (ids: number[]) => {
      setGoals((prev) => (prev ? applyGoalOrder(prev, ids) : prev))
      setError(null)
      try {
        const next = await goalsApi.reorder(ids)
        setGoals(next)
        return next
      } catch (err) {
        apiError(setError, err)
        await reload()
        throw err
      }
    },
    [reload]
  )

  const createGoal = useCallback(async (input: GoalInput) => {
    try {
      const goal = await goalsApi.create(input)
      setGoals((prev) => [goal, ...(prev ?? [])])
      setError(null)
      emitGoalsChanged()
      return goal
    } catch (err) {
      apiError(setError, err)
      throw err
    }
  }, [])

  const closeGoal = useCallback(async (id: number, outcome: GoalCloseOutcome) => {
    try {
      const goal = await goalsApi.close(id, outcome)
      setGoals((prev) => (prev ? prev.map((g) => (g.id === id ? goal : g)) : prev))
      setError(null)
      emitGoalsChanged()
      return goal
    } catch (err) {
      apiError(setError, err)
      throw err
    }
  }, [])

  const acknowledge = useCallback(async (id: number) => {
    try {
      const goal = await goalsApi.acknowledge(id)
      setGoals((prev) => (prev ? prev.map((g) => (g.id === id ? goal : g)) : prev))
      setError(null)
      emitGoalsChanged()
      return goal
    } catch (err) {
      apiError(setError, err)
      throw err
    }
  }, [])

  const setChecklist = useCallback(async (id: number, items: ChecklistItem[]) => {
    try {
      const goal = await goalsApi.setChecklist(id, items)
      setGoals((prev) => (prev ? prev.map((g) => (g.id === id ? goal : g)) : prev))
      setError(null)
      emitGoalsChanged()
      return goal
    } catch (err) {
      apiError(setError, err)
      throw err
    }
  }, [])

  const addEntry = useCallback(async (id: number, content: string, images: string[] = []) => {
    try {
      const entry = await goalsApi.addEntry(id, content, images)
      setGoals((prev) => (prev ? prev.map((g) => (g.id === id ? { ...g, entries: [...g.entries, entry] } : g)) : prev))
      setError(null)
    } catch (err) {
      apiError(setError, err)
      throw err
    }
  }, [])

  const editEntry = useCallback(async (id: number, entryId: number, content: string, images: string[]) => {
    try {
      const entry = await goalsApi.updateEntry(id, entryId, content, images)
      setGoals((prev) =>
        prev ? prev.map((g) => (g.id === id ? { ...g, entries: g.entries.map((e) => (e.id === entryId ? entry : e)) } : g)) : prev
      )
      setError(null)
    } catch (err) {
      apiError(setError, err)
      throw err
    }
  }, [])

  const deleteEntry = useCallback(async (id: number, entryId: number) => {
    try {
      await goalsApi.deleteEntry(id, entryId)
      setGoals((prev) => (prev ? prev.map((g) => (g.id === id ? { ...g, entries: g.entries.filter((e) => e.id !== entryId) } : g)) : prev))
      setError(null)
    } catch (err) {
      apiError(setError, err)
      throw err
    }
  }, [])

  const uploadImage = useCallback((file: File) => goalsApi.uploadImage(file), [])

  return {
    goals,
    error,
    busy,
    applyOrder,
    reorder,
    reload,
    createGoal,
    closeGoal,
    acknowledge,
    setChecklist,
    addEntry,
    editEntry,
    deleteEntry,
    uploadImage
  }
}