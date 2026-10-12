import { queryString, request, UPLOAD_TIMEOUT_MS } from '../lib/api'
import type { ChecklistItem, GoalCloseOutcome, GoalEntry, GoalMetric, GoalWithProgress } from './goals.types'

export interface GoalInput {
  metric: GoalMetric
  targetUnits: number
  deadline?: string
  title?: string
  checklist?: string[]
}

export type GoalListFilters = {
  metric?: GoalMetric
  startDate?: string
  endDate?: string
  includeFinishedDaily?: string
  finishedOnly?: string
}

export const goalsApi = {
  list: (filters: GoalListFilters = {}) => request<{ goals: GoalWithProgress[] }>(`/goals${queryString(filters)}`).then((r) => r.goals),
  reorder: (ids: number[]) =>
    request<{ goals: GoalWithProgress[] }>('/goals/order', { method: 'PUT', body: JSON.stringify({ ids }) }).then((r) => r.goals),
  create: (input: GoalInput) =>
    request<{ goal: GoalWithProgress }>('/goals', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.goal),
  addEntry: (id: number, content: string, images: string[] = []) =>
    request<{ entry: GoalEntry }>(`/goals/${id}/entry`, { method: 'POST', body: JSON.stringify({ content, images }) }).then((r) => r.entry),
  updateEntry: (id: number, entryId: number, content: string, images: string[]) =>
    request<{ entry: GoalEntry }>(`/goals/${id}/entry/${entryId}`, { method: 'PUT', body: JSON.stringify({ content, images }) }).then((r) => r.entry),
  deleteEntry: (id: number, entryId: number) =>
    request<{ ok: true }>(`/goals/${id}/entry/${entryId}`, { method: 'DELETE' }).then((r) => r),
  uploadImage: (file: File) => {
    const form = new FormData()
    form.append('file', file, file.name)
    return request<{ path: string }>('/goals/images', { method: 'POST', body: form, timeoutMs: UPLOAD_TIMEOUT_MS }).then((r) => r.path)
  },
  close: (id: number, outcome: GoalCloseOutcome) =>
    request<{ goal: GoalWithProgress }>(`/goals/${id}/close`, { method: 'POST', body: JSON.stringify({ outcome }) }).then((r) => r.goal),
  acknowledge: (id: number) =>
    request<{ goal: GoalWithProgress }>(`/goals/${id}/acknowledge`, { method: 'POST' }).then((r) => r.goal),
  setChecklist: (id: number, items: ChecklistItem[]) =>
    request<{ goal: GoalWithProgress }>(`/goals/${id}/checklist`, { method: 'PUT', body: JSON.stringify({ items }) }).then((r) => r.goal)
}