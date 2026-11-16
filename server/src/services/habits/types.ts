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

export interface HabitLog {
  date: string
  status: HabitStatus
}

export interface HabitWithLogs extends Habit {
  logs: Record<string, HabitStatus>
}

/** GET /api/habits: список месяца плюс игровое «сегодня» от сервера. */
export interface HabitListResult {
  habits: HabitWithLogs[]
  today: string
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
