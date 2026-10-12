import { getDb } from '../../db.js'
import { convertToUsd } from '../rates/convert.js'
import { mttOnly } from '../tournamentScope.js'
import { HttpError } from '../../lib/errors.js'
import { normalizeChecklistStatus } from './checklist.js'
import type { ChecklistItem, Goal, GoalEntry, GoalEntryKind, GoalMetric, GoalsFacts, GoalSnapshot, GoalStatus, GoalTerminalStatus } from './types.js'

interface GoalRow {
  id: number
  metric: GoalMetric
  target_units: number
  currency: string
  deadline: string | null
  title: string | null
  checklist: string
  status: string
  created_at: string
  achieved_at: string | null
  failed_at: string | null
  closed_at: string | null
  acknowledged_at: string | null
  final_percent: number | null
  final_units: number | null
  sort_order: number
}

interface GoalEntryRow {
  id: number
  goal_id: number
  kind: GoalEntryKind
  content: string
  images: string
  milestone: number | null
  created_at: string
}

function normalizeStatus(status: string): GoalStatus {
  return status === 'closed' ? 'failed' : (status as GoalStatus)
}

function mapGoal(r: GoalRow): Goal {
  return {
    id: r.id,
    metric: r.metric,
    targetUnits: r.target_units,
    currency: r.currency,
    deadline: r.deadline,
    title: r.title,
    checklist: parseChecklist(r.checklist),
    status: normalizeStatus(r.status),
    createdAt: r.created_at,
    achievedAt: r.achieved_at,
    failedAt: r.failed_at,
    closedAt: r.closed_at,
    acknowledgedAt: r.acknowledged_at,
    finalPercent: r.final_percent,
    finalUnits: r.final_units,
    sortOrder: r.sort_order
  }
}

function parseChecklist(raw: string): ChecklistItem[] {
  try {
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.map((item: unknown) => {
      if (typeof item !== 'object' || item === null) return null
      const entry = item as Record<string, unknown>
      if (typeof entry.id !== 'string' || typeof entry.text !== 'string') return null
      const status = normalizeChecklistStatus({ status: entry.status, done: entry.done })
      if (status === null) return null
      return { id: entry.id, text: entry.text, status }
    }).filter((item: ChecklistItem | null): item is ChecklistItem => item !== null)
  } catch {
    return []
  }
}

function mapEntry(r: GoalEntryRow): GoalEntry {
  return {
    id: r.id,
    goalId: r.goal_id,
    kind: r.kind,
    content: r.content,
    images: parseImages(r.images),
    milestone: r.milestone,
    createdAt: r.created_at
  }
}

function parseImages(raw: string): string[] {
  try {
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

export function collectGoalsFacts(): GoalsFacts {
  const balances = getDb()
    .prepare(
      `SELECT b.room_id, b.date, b.amount, b.currency
       FROM balance_entries b
       JOIN (SELECT room_id, MAX(date) AS max_date FROM balance_entries GROUP BY room_id) latest
         ON latest.room_id = b.room_id AND latest.max_date = b.date`
    )
    .all() as unknown as { room_id: number; date: string; amount: number; currency: string }[]

  let currentBankrollUsd = 0
  let blank = false
  for (const row of balances) {
    const usd = convertToUsd(row.amount, row.currency, row.date, row.room_id)
    if (usd === null) {
      blank = true
      break
    }
    currentBankrollUsd += usd
  }

  // distance counts classic MTT tournaments only — MBR (hyper-turbo) is
  // isolated from analytics while its money still flows through balances.
  const tournamentCount = (getDb().prepare(`SELECT COUNT(*) AS c FROM tournaments WHERE 1 = 1${mttOnly('is_mbr')}`).get() as { c: number }).c

  return {
    currentBankrollUsd: blank ? null : currentBankrollUsd,
    tournamentCount
  }
}

export interface GoalListFilter {
  metric?: GoalMetric
  dateStart?: string
  dateEnd?: string
  includeFinishedDaily?: boolean
  finishedOnly?: boolean
}

export function listGoalRows(filters: GoalListFilter = {}): Goal[] {
  const clauses: string[] = []
  const params: Array<string | number> = []
  if (filters.metric) {
    clauses.push('metric = ?')
    params.push(filters.metric)
  }
  if (filters.dateStart) {
    clauses.push('deadline >= ?')
    params.push(filters.dateStart)
  }
  if (filters.dateEnd) {
    clauses.push('deadline <= ?')
    params.push(filters.dateEnd)
  }
  if (filters.finishedOnly) {
    clauses.push("status <> 'active'")
  } else if (!filters.includeFinishedDaily) {
    clauses.push("NOT (metric = 'daily' AND status <> 'active')")
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''
  const rows = getDb().prepare(`SELECT * FROM goals${where} ORDER BY sort_order, id`).all(...params) as unknown as GoalRow[]
  return rows.map(mapGoal)
}

export function getGoalRow(id: number): Goal | null {
  const row = getDb().prepare('SELECT * FROM goals WHERE id = ?').get(id) as unknown as GoalRow | undefined
  return row ? mapGoal(row) : null
}

export function requireGoal(id: number): Goal {
  const goal = getGoalRow(id)
  if (!goal) throw new HttpError(404, 'Goal not found')
  return goal
}

export function insertGoal(input: {
  metric: GoalMetric
  targetUnits: number
  deadline: string | null
  title: string | null
  checklist?: ChecklistItem[]
}): Goal {
  const checklist = input.checklist ?? []
  const info = getDb()
    .prepare('INSERT INTO goals (metric, target_units, deadline, title, checklist, sort_order) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MIN(sort_order), 0) - 1 FROM goals))')
    .run(input.metric, input.targetUnits, input.deadline, input.title, JSON.stringify(checklist))
  return requireGoal(Number(info.lastInsertRowid))
}

export function setGoalSortOrder(id: number, sortOrder: number): void {
  getDb().prepare('UPDATE goals SET sort_order = ? WHERE id = ?').run(sortOrder, id)
}

export function settleGoal(id: number, status: GoalTerminalStatus, snapshot: GoalSnapshot, acknowledged = false): void {
  const col = status === 'achieved' ? 'achieved_at' : 'failed_at'
  const ack = acknowledged ? ", acknowledged_at = datetime('now')" : ''
  getDb()
    .prepare(`UPDATE goals SET status = ?, ${col} = datetime('now'), final_percent = ?, final_units = ?${ack} WHERE id = ?`)
    .run(status, snapshot.percent, snapshot.units, id)
}

export function acknowledgeGoalRow(id: number): void {
  const info = getDb().prepare("UPDATE goals SET acknowledged_at = datetime('now') WHERE id = ?").run(id)
  if (Number(info.changes) === 0) throw new HttpError(404, 'Goal not found')
}

export function listEntries(goalId: number): GoalEntry[] {
  const rows = getDb()
    .prepare('SELECT * FROM goal_entries WHERE goal_id = ? ORDER BY created_at, id')
    .all(goalId) as unknown as GoalEntryRow[]
  return rows.map(mapEntry)
}

export function insertEntry(goalId: number, kind: GoalEntryKind, content: string, milestone: number | null, images: string[] = []): GoalEntry {
  const info = getDb()
    .prepare('INSERT INTO goal_entries (goal_id, kind, content, images, milestone) VALUES (?, ?, ?, ?, ?)')
    .run(goalId, kind, content, JSON.stringify(images), milestone)
  const row = getDb().prepare('SELECT * FROM goal_entries WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as GoalEntryRow
  return mapEntry(row)
}

export function getEntryRow(goalId: number, entryId: number): GoalEntry | null {
  const row = getDb().prepare('SELECT * FROM goal_entries WHERE id = ? AND goal_id = ?').get(entryId, goalId) as unknown as GoalEntryRow | undefined
  return row ? mapEntry(row) : null
}

export function updateEntry(goalId: number, entryId: number, content: string, images: string[]): GoalEntry {
  const info = getDb()
    .prepare('UPDATE goal_entries SET content = ?, images = ? WHERE id = ? AND goal_id = ?')
    .run(content, JSON.stringify(images), entryId, goalId)
  if (Number(info.changes) === 0) throw new HttpError(404, 'Entry not found')
  const row = getDb().prepare('SELECT * FROM goal_entries WHERE id = ?').get(entryId) as unknown as GoalEntryRow
  return mapEntry(row)
}

export function deleteEntry(goalId: number, entryId: number): GoalEntry {
  const entry = getEntryRow(goalId, entryId)
  if (!entry) throw new HttpError(404, 'Entry not found')
  getDb().prepare('DELETE FROM goal_entries WHERE id = ? AND goal_id = ?').run(entryId, goalId)
  return entry
}

export function entryExists(goalId: number, milestone: number): boolean {
  return getDb().prepare('SELECT 1 FROM goal_entries WHERE goal_id = ? AND milestone = ?').get(goalId, milestone) !== undefined
}

export function updateChecklist(goalId: number, checklist: ChecklistItem[]): Goal {
  const info = getDb().prepare('UPDATE goals SET checklist = ? WHERE id = ?').run(JSON.stringify(checklist), goalId)
  if (Number(info.changes) === 0) throw new HttpError(404, 'Goal not found')
  return requireGoal(goalId)
}