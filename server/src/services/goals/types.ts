export type GoalMetric = 'bankroll' | 'distance' | 'custom' | 'daily'
export type GoalStatus = 'active' | 'achieved' | 'failed'
export type GoalTerminalStatus = Exclude<GoalStatus, 'active'>
export type GoalCloseOutcome = 'achieved' | 'failed'
export type GoalEntryKind = 'system' | 'user'

export type ChecklistStatus = 'pending' | 'completed' | 'partial' | 'failed'

export interface ChecklistItem {
  id: string
  text: string
  status: ChecklistStatus
}

export interface Goal {
  id: number
  metric: GoalMetric
  targetUnits: number
  currency: string
  deadline: string | null
  title: string | null
  checklist: ChecklistItem[]
  status: GoalStatus
  createdAt: string
  achievedAt: string | null
  failedAt: string | null
  closedAt: string | null
  acknowledgedAt: string | null
  finalPercent: number | null
  finalUnits: number | null
  sortOrder: number
}

export interface GoalSnapshot {
  percent: number
  units: number | null
}

export interface GoalEntry {
  id: number
  goalId: number
  kind: GoalEntryKind
  content: string
  images: string[]
  milestone: number | null
  createdAt: string
}

export interface GoalsFacts {
  currentBankrollUsd: number | null
  tournamentCount: number
}

export interface GoalProgress {
  currentUnits: number | null
  percent: number
  blank: boolean
}

export interface GoalWithProgress extends Goal {
  progress: GoalProgress
  entries: GoalEntry[]
}