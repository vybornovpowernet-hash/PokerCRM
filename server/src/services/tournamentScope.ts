/**
 * Tournament scope predicates shared by every module that queries the
 * `tournaments` table. Keeping the MBR rule in one place means a change to how
 * Mystery Battle Royale is isolated (or its removal) is a single edit instead
 * of copy-pasted `is_mbr = 0` fragments across the codebase.
 *
 * A `column` is passed in because callers alias the table differently
 * (`is_mbr`, `t.is_mbr`).
 */

/**
 * Which tournaments a query looks at:
 *  - `mtt` — classic MTT analytics (statistics, calendar, goals); excludes MBR
 *  - `mbr` — the isolated Mystery Battle Royale block
 *  - `all` — every tournament; the money-bearing flows (reconciliation,
 *    profit chart) never pass a filter and therefore see MBR too.
 */
export type MbrScope = 'all' | 'mtt' | 'mbr'

/** SQL fragment limiting a query to classic MTT rows (excludes MBR). */
export function mttOnly(column: string): string {
  return ` AND ${column} = 0`
}

/** SQL fragment limiting a query to MBR rows only. */
export function mbrOnly(column: string): string {
  return ` AND ${column} = 1`
}

/** SQL fragment for an explicit scope; `all` adds no predicate. */
export function scopeClause(scope: MbrScope, column: string): string {
  if (scope === 'mtt') return mttOnly(column)
  if (scope === 'mbr') return mbrOnly(column)
  return ''
}
