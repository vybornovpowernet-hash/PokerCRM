export type HabitStatus = 'done' | 'partial' | 'missed'

export interface Habit {
  id: number
  name: string
  color: string
  createdAt: string
  startDay: string
  archivedAt: string | null
  sortOrder: number
}

export interface HabitWithLogs extends Habit {
  logs: Record<string, HabitStatus>
}

export interface HabitStats {
  done: number
  partial: number
  missed: number
  tracked: number
  completionRate: number | null
  firstDate: string | null
  lastDate: string | null
  longestDoneStreak: number
}

export interface HabitHistoryItem extends Habit {
  logs: Record<string, HabitStatus>
  stats: HabitStats
}

/**
 * Ответ GET /api/habits: список месяца плюс игровой «сегодня» сервера. `today`
 * может не прийти (старый сервер) — тогда клиент не подсвечивает день и не
 * блокирует будущие клетки, то есть остаётся при прежнем поведении.
 */
export interface HabitsListResult {
  habits: HabitWithLogs[]
  today: string | null
}

export interface HabitLogResult {
  date: string
  status: HabitStatus
}

export interface HabitInput {
  name?: string
  color?: string
}
