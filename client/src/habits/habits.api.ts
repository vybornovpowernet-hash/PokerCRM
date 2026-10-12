import { request } from '../lib/api'
import type { Habit, HabitHistoryItem, HabitInput, HabitLogResult, HabitStatus, HabitWithLogs } from './habits.types'

export const habitsApi = {
  list: (month: string) => request<{ habits: HabitWithLogs[] }>(`/habits?month=${encodeURIComponent(month)}`).then((r) => r.habits),
  history: () => request<{ habits: HabitHistoryItem[] }>('/habits/history').then((r) => r.habits),
  create: (name: string, color: string) =>
    request<{ habit: Habit }>('/habits', { method: 'POST', body: JSON.stringify({ name, color }) }).then((r) => r.habit),
  update: (id: number, input: HabitInput) =>
    request<{ habit: Habit }>(`/habits/${id}`, { method: 'PUT', body: JSON.stringify(input) }).then((r) => r.habit),
  restore: (id: number) => request<{ habit: Habit }>(`/habits/${id}/restore`, { method: 'POST' }).then((r) => r.habit),
  reorder: (ids: number[]) => request<{ habits: Habit[] }>('/habits/order', { method: 'PUT', body: JSON.stringify({ ids }) }).then((r) => r.habits),
  setLog: (id: number, date: string, status: HabitStatus | null) =>
    request<{ log: HabitLogResult | null }>(`/habits/${id}/log`, { method: 'PUT', body: JSON.stringify({ date, status }) }).then((r) => r.log),
  archive: (id: number) => request<{ ok: true }>(`/habits/${id}`, { method: 'DELETE' }).then((r) => r.ok)
}
