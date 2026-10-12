import { formatMinUnits } from '../../lib/money.js'
import type { GoalMetric, GoalsFacts } from './types.js'

export interface MetricResolver {
  label: string
  current(facts: GoalsFacts): number | null
  formatTarget(targetUnits: number): string
  formatCurrent(current: number): string
  milestoneContent(milestone: number, current: number): string
  achievedContent(current: number): string
}

function plural(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'турнир'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'турнира'
  return 'турниров'
}

export const METRIC_RESOLVERS: Record<GoalMetric, MetricResolver> = {
  bankroll: {
    label: 'Банкролл',
    current: (facts) => facts.currentBankrollUsd,
    formatTarget: (targetUnits) => formatMinUnits(targetUnits, 'USD'),
    formatCurrent: (current) => formatMinUnits(current, 'USD'),
    milestoneContent: (milestone, current) => `Пройдено ${milestone}% — банкролл ${formatMinUnits(current, 'USD')}`,
    achievedContent: (current) => `Цель достигнута — банкролл ${formatMinUnits(current, 'USD')}`
  },
  distance: {
    label: 'Сыграно турниров',
    current: (facts) => facts.tournamentCount,
    formatTarget: (targetUnits) => `${targetUnits} ${plural(targetUnits)}`,
    formatCurrent: (current) => `${current} ${plural(current)}`,
    milestoneContent: (milestone, current) => `Пройдено ${milestone}% — сыграно ${current} ${plural(current)}`,
    achievedContent: (current) => `Цель достигнута — сыграно ${current} ${plural(current)}`
  },
  custom: {
    label: 'Своя',
    current: () => 0,
    formatTarget: () => '',
    formatCurrent: () => '',
    milestoneContent: () => '',
    achievedContent: () => 'Цель достигнута'
  },
  daily: {
    label: 'Ежедневник',
    current: () => 0,
    formatTarget: () => '',
    formatCurrent: () => '',
    milestoneContent: () => '',
    achievedContent: () => 'Все дела дня выполнены'
  }
}

export function getResolver(metric: GoalMetric): MetricResolver {
  const resolver = METRIC_RESOLVERS[metric]
  if (!resolver) throw new Error(`Unknown goal metric: ${metric}`)
  return resolver
}