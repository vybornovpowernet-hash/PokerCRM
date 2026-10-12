import { applyItemOrder, moveItemId } from '../lib/reorder'
import type { GoalWithProgress } from './goals.types'

export function applyGoalOrder(goals: GoalWithProgress[], ids: number[]): GoalWithProgress[] {
  return applyItemOrder(goals, ids)
}

export function moveGoalId(ids: number[], id: number, direction: -1 | 1): number[] {
  return moveItemId(ids, id, direction)
}
