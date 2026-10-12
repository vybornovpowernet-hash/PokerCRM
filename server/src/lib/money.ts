/**
 * All monetary amounts are stored as integers in the smallest unit of the
 * native currency (cents, kopecks, …). Exchange rates are stored as integer
 * scaled by RATE_SCALE (1e4) and mean: `rate` units of `to` per 1 unit of
 * `from` — e.g. USD→RUB 89.3936 is stored as 893936.
 */

export const RATE_SCALE = 10_000

/** Convert `amount` (in source min units) into target min units via a forward rate. */
export function applyRate(amount: number, rateScaled: number): number {
  return Math.round((amount * rateScaled) / RATE_SCALE)
}

/** Convert `amount` (in target min units) back into source min units via a forward rate. */
export function inverseRate(amount: number, rateScaled: number): number {
  if (rateScaled === 0) throw new Error('rate must be non-zero')
  return Math.round((amount * RATE_SCALE) / rateScaled)
}

/** Pretty print min units with the currency symbol. */
export function formatMinUnits(amount: number, currency: string): string {
  const symbol =
    currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'RUB' ? '₽' : currency === 'CNY' ? '¥' : `${currency} `
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${symbol}${whole}.${frac}`
}