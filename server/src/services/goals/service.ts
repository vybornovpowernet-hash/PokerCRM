import { HttpError } from '../../lib/errors.js'
import { dayKey, isValidDayKey } from '../../lib/date.js'
import { withTransaction } from '../../db.js'
import { deleteDiaryImage, isDiaryImagePath } from '../uploads.js'
import { diaryTextLength, sanitizeDiaryHtml } from './diaryHtml.js'
import { normalizeChecklistStatus } from './checklist.js'
import { collectGoalsFacts, acknowledgeGoalRow, deleteEntry, entryExists, getEntryRow, insertEntry, insertGoal, listGoalRows, requireGoal, setGoalSortOrder, settleGoal, updateChecklist, updateEntry } from './db.js'
import { getResolver } from './metrics.js'
import { computeProgress, lightReconcile, reconcileGoal } from './reconcile.js'
import type { ChecklistItem, GoalCloseOutcome, GoalEntry, GoalMetric, GoalWithProgress } from './types.js'

const VALID_METRICS = new Set<GoalMetric>(['bankroll', 'distance', 'custom', 'daily'])

function validateMetric(value: unknown): GoalMetric {
  if (typeof value !== 'string' || !VALID_METRICS.has(value as GoalMetric)) {
    throw new HttpError(400, 'metric: must be bankroll, distance, custom or daily')
  }
  return value as GoalMetric
}

function isBinaryMetric(metric: GoalMetric): boolean {
  return metric === 'custom' || metric === 'daily'
}

function validateTargetUnits(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new HttpError(400, 'targetUnits: must be a positive integer')
  }
  return value as number
}

function validateTitle(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new HttpError(400, 'title: must be a string')
  const title = value.trim()
  if (title.length < 1 || title.length > 100) throw new HttpError(400, 'title: must be 1-100 characters')
  return title
}

function validateOutcome(value: unknown): GoalCloseOutcome {
  if (value !== 'achieved' && value !== 'failed') {
    throw new HttpError(400, 'outcome: must be achieved or failed')
  }
  return value
}

function validateDeadline(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !isValidDayKey(value)) throw new HttpError(400, 'deadline: invalid date')
  if (value < dayKey()) throw new HttpError(400, 'deadline: must not be in the past')
  return value
}

const MAX_ENTRY_CONTENT = 5000

function validateContent(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'content: must be a string')
  const html = sanitizeDiaryHtml(value).trim()
  const length = diaryTextLength(html)
  if (length < 1 || length > MAX_ENTRY_CONTENT) throw new HttpError(400, `content: must be 1-${MAX_ENTRY_CONTENT} characters`)
  return html
}

const MAX_ENTRY_IMAGES = 10

function validateImages(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new HttpError(400, 'images: must be an array')
  if (value.length > MAX_ENTRY_IMAGES) throw new HttpError(400, `images: must not exceed ${MAX_ENTRY_IMAGES} files`)
  const images: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!isDiaryImagePath(raw)) throw new HttpError(400, 'images: invalid path')
    if (seen.has(raw)) throw new HttpError(400, 'images: paths must be unique')
    seen.add(raw)
    images.push(raw)
  }
  return images
}

const MAX_CHECKLIST_ITEMS = 50
const MAX_CHECKLIST_ITEM_TEXT = 200

function validateChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'items: must be an array')
  if (value.length > MAX_CHECKLIST_ITEMS) throw new HttpError(400, `items: must not exceed ${MAX_CHECKLIST_ITEMS} items`)
  const items: ChecklistItem[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) throw new HttpError(400, 'items: each item must be an object')
    const item = raw as Record<string, unknown>
    if (typeof item.id !== 'string' || item.id.length < 1 || item.id.length > 36) throw new HttpError(400, 'items: id must be 1-36 characters')
    if (seen.has(item.id)) throw new HttpError(400, 'items: ids must be unique')
    if (typeof item.text !== 'string') throw new HttpError(400, 'items: text must be a string')
    const text = item.text.trim()
    if (text.length < 1 || text.length > MAX_CHECKLIST_ITEM_TEXT) throw new HttpError(400, `items: text must be 1-${MAX_CHECKLIST_ITEM_TEXT} characters`)
    const status = normalizeChecklistStatus({ status: item.status, done: item.done })
    if (status === null) throw new HttpError(400, 'items: status must be pending, completed or failed')
    seen.add(item.id)
    items.push({ id: item.id, text, status })
  }
  return items
}

export function listGoals(
  input: { metric?: unknown; startDate?: unknown; endDate?: unknown; includeFinishedDaily?: unknown; finishedOnly?: unknown } = {},
): GoalWithProgress[] {
  const filter = validateListOptions(input)
  const rows = listGoalRows(filter)
  const allFinished = rows.length === 0 || rows.every((goal) => goal.status !== 'active')
  if (allFinished) return rows.map((goal) => lightReconcile(goal))
  const facts = collectGoalsFacts()
  return rows.map((goal) => reconcileGoal(goal, facts))
}

function validateListOptions(input: {
  metric?: unknown
  startDate?: unknown
  endDate?: unknown
  includeFinishedDaily?: unknown
  finishedOnly?: unknown
}): { metric?: GoalMetric; dateStart?: string; dateEnd?: string; includeFinishedDaily: boolean; finishedOnly: boolean } {
  let metric: GoalMetric | undefined
  if (input.metric !== undefined && input.metric !== '') {
    if (typeof input.metric !== 'string' || !VALID_METRICS.has(input.metric as GoalMetric)) {
      throw new HttpError(400, 'metric: must be bankroll, distance, custom or daily')
    }
    metric = input.metric as GoalMetric
  }
  let dateStart: string | undefined
  let dateEnd: string | undefined
  if (input.startDate !== undefined && input.startDate !== '') {
    if (typeof input.startDate !== 'string' || !isValidDayKey(input.startDate)) throw new HttpError(400, 'startDate: invalid date')
    dateStart = input.startDate
  }
  if (input.endDate !== undefined && input.endDate !== '') {
    if (typeof input.endDate !== 'string' || !isValidDayKey(input.endDate)) throw new HttpError(400, 'endDate: invalid date')
    dateEnd = input.endDate
  }
  if (dateStart && dateEnd && dateStart > dateEnd) throw new HttpError(400, 'startDate: must not be after endDate')
  return {
    metric,
    dateStart,
    dateEnd,
    includeFinishedDaily: input.includeFinishedDaily === '1' || input.includeFinishedDaily === true,
    finishedOnly: input.finishedOnly === '1' || input.finishedOnly === true
  }
}

function validateOrderIds(value: unknown): number[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'ids: must be an array')
  const ids: number[] = []
  for (const raw of value) {
    if (!Number.isInteger(raw) || (raw as number) <= 0) throw new HttpError(400, 'ids: must contain positive integers')
    if (ids.includes(raw as number)) throw new HttpError(400, 'ids: must not contain duplicates')
    ids.push(raw as number)
  }
  const known = new Set(listGoalRows({ includeFinishedDaily: true }).map((goal) => goal.id))
  for (const id of ids) {
    if (!known.has(id)) throw new HttpError(400, `ids: unknown goal ${id}`)
  }
  return ids
}

export function reorderGoals(input: unknown): GoalWithProgress[] {
  const ids = validateOrderIds(input)
  const current = listGoalRows({ includeFinishedDaily: true })
  const moved = new Set(ids)
  const rest = current.filter((goal) => !moved.has(goal.id)).map((goal) => goal.id)
  const order = [...ids, ...rest]
  withTransaction(() => order.forEach((id, index) => setGoalSortOrder(id, index)))
  return listGoals()
}

export function createGoal(input: {
  metric: unknown
  targetUnits: unknown
  deadline?: unknown
  title?: unknown
  checklist?: unknown
}): GoalWithProgress {
  const metric = validateMetric(input.metric)
  const title = validateTitle(input.title)
  if (isBinaryMetric(metric) && title === null) throw new HttpError(400, 'title: required for custom and daily goals')
  const deadline = metric === 'daily' ? dayKey() : validateDeadline(input.deadline)
  const targetUnits = isBinaryMetric(metric) ? 1 : validateTargetUnits(input.targetUnits)
  const checklist = validateCreationChecklist(input.checklist)
  const goal = withTransaction(() => insertGoal({ metric, targetUnits, deadline, title: isBinaryMetric(metric) ? title : null, checklist }))
  return reconcileGoal(goal, collectGoalsFacts())
}

function validateCreationChecklist(value: unknown): ChecklistItem[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new HttpError(400, 'checklist: must be an array of strings')
  if (value.length > MAX_CHECKLIST_ITEMS) throw new HttpError(400, `checklist: must not exceed ${MAX_CHECKLIST_ITEMS} items`)
  const items: ChecklistItem[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'string') throw new HttpError(400, 'checklist: each item must be a string')
    const text = raw.trim()
    if (text.length < 1 || text.length > MAX_CHECKLIST_ITEM_TEXT) throw new HttpError(400, `checklist: text must be 1-${MAX_CHECKLIST_ITEM_TEXT} characters`)
    if (seen.has(text)) throw new HttpError(400, 'checklist: items must be unique')
    seen.add(text)
    items.push({ id: crypto.randomUUID(), text, status: 'pending' })
  }
  return items
}

export function addUserEntry(id: number, content: unknown, images?: unknown): GoalEntry {
  requireGoal(id)
  const text = validateContent(content)
  const attachments = validateImages(images)
  return insertEntry(id, 'user', text, null, attachments)
}

export function updateUserEntry(id: number, entryId: number, content: unknown, images: unknown): GoalEntry {
  requireGoal(id)
  const existing = getEntryRow(id, entryId)
  if (!existing) throw new HttpError(404, 'Entry not found')
  if (existing.kind !== 'user') throw new HttpError(400, 'Only diary notes can be edited')
  const text = validateContent(content)
  const attachments = validateImages(images)
  const updated = withTransaction(() => updateEntry(id, entryId, text, attachments))
  for (const path of existing.images) {
    if (!attachments.includes(path)) deleteDiaryImage(path)
  }
  return updated
}

export function deleteUserEntry(id: number, entryId: number): void {
  requireGoal(id)
  const existing = getEntryRow(id, entryId)
  if (!existing) throw new HttpError(404, 'Entry not found')
  if (existing.kind !== 'user') throw new HttpError(400, 'Only diary notes can be deleted')
  withTransaction(() => deleteEntry(id, entryId))
  for (const path of existing.images) deleteDiaryImage(path)
}

export function closeGoal(id: number, outcome: unknown): GoalWithProgress {
  const goal = requireGoal(id)
  if (goal.status !== 'active') throw new HttpError(400, 'Only active goals can be closed')
  const settled = validateOutcome(outcome)
  const facts = collectGoalsFacts()
  const progress = computeProgress(goal, facts)
  const snapshot = { percent: progress.percent, units: progress.currentUnits }
  withTransaction(() => {
    if (settled === 'achieved') {
      const resolver = getResolver(goal.metric)
      const current = resolver.current(facts)
      const content = current !== null ? resolver.achievedContent(current) : 'Цель достигнута'
      if (current !== null && !entryExists(goal.id, 100)) {
        insertEntry(goal.id, 'system', content, 100)
      }
    } else {
      insertEntry(goal.id, 'system', 'Цель не достигнута', null)
    }
    settleGoal(goal.id, settled, snapshot, true)
  })
  return reconcileGoal(requireGoal(goal.id), collectGoalsFacts())
}

export function acknowledgeGoal(id: number): GoalWithProgress {
  const goal = requireGoal(id)
  if (goal.status === 'active') throw new HttpError(400, 'Only finished goals can be acknowledged')
  withTransaction(() => acknowledgeGoalRow(id))
  return reconcileGoal(requireGoal(id), collectGoalsFacts())
}

export function setChecklist(id: number, items: unknown): GoalWithProgress {
  const goal = requireGoal(id)
  if (goal.status !== 'active') throw new HttpError(400, 'Only active goals can change their checklist')
  const checklist = validateChecklist(items)
  const updated = withTransaction(() => updateChecklist(goal.id, checklist))
  return reconcileGoal(updated, collectGoalsFacts())
}