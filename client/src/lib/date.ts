export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Whole calendar month shifted by `delta` months. `Date` normalizes both the year
 * rollover and the leap February on its own; the base is always the range start.
 */
export function monthBounds(baseKey: string, delta: number): { from: string; to: string } {
  const [year, month] = baseKey.split('-').map(Number) as [number, number]
  const first = new Date(year, month - 1 + delta, 1)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
  return { from: dayKey(first), to: dayKey(last) }
}

export type PresetId = 'day' | 'week' | 'month' | 'year'

export const PRESETS: ReadonlyArray<{ id: PresetId; label: string }> = [
  { id: 'day', label: 'За день' },
  { id: 'week', label: 'За неделю' },
  { id: 'month', label: 'За месяц' },
  { id: 'year', label: 'За год' }
]

export function rangeFor(preset: PresetId): { from: string; to: string } {
  const now = new Date()
  const to = dayKey(now)
  if (preset === 'day') return { from: to, to }
  if (preset === 'week') {
    const d = new Date(now)
    d.setDate(d.getDate() - 6)
    return { from: dayKey(d), to }
  }
  if (preset === 'month') return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to }
  return { from: `${now.getFullYear()}-01-01`, to }
}

/** «Next month» is only offered while the next month starts before the current one. */
export function isNextMonthDisabled(fromKey: string, today: Date = new Date()): boolean {
  return monthBounds(fromKey, 1).from > monthBounds(dayKey(today), 0).from
}
