import type { ChecklistStatus } from './types.js'

const CHECKLIST_STATUSES: readonly ChecklistStatus[] = ['pending', 'completed', 'failed']

export function isChecklistStatus(value: unknown): value is ChecklistStatus {
  return typeof value === 'string' && (CHECKLIST_STATUSES as readonly string[]).includes(value)
}

export function normalizeChecklistStatus(item: { status?: unknown; done?: unknown }): ChecklistStatus | null {
  if (isChecklistStatus(item.status)) return item.status
  if (typeof item.done === 'boolean') return item.done ? 'completed' : 'pending'
  return null
}
