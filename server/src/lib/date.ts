export function dayKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidDayKey(s: string): boolean {
  if (!DAY_KEY_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00`)
  return !Number.isNaN(d.getTime()) && dayKey(d) === s
}

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export function isValidMonthKey(s: string): boolean {
  return MONTH_KEY_RE.test(s)
}

export function currentMonthKey(d: Date = new Date()): string {
  return dayKey(d).slice(0, 7)
}

export function monthStart(month: string): string {
  return `${month}-01`
}

export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${month}-${String(last).padStart(2, '0')}`
}

/** Shifts a YYYY-MM-DD key by whole days using UTC math (no timezone drift). */
export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y as number, (m as number) - 1, d as number))
  dt.setUTCDate(dt.getUTCDate() + delta)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}