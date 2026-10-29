/** Client-side money helpers. Amounts travel as integer min units (1/100). */

const SPACES = /\s/g
const NON_MONEY = /[^\d.]/g
const EXTRA_DOTS = /\./g
const LEADING_DOT = /^\./

/**
 * Brings a balance field to the canonical money shape while the user types:
 * `,` becomes `.`, spaces and non-numeric characters are dropped, only the first
 * dot survives, the fraction is capped at two digits and a leading dot gets its
 * zero. Comma replacement keeps the string length, so the caret stays put.
 */
export function normalizeAmountInput(raw: string): string {
  const dotted = raw.replace(/,/g, '.').replace(SPACES, '').replace(NON_MONEY, '')
  const firstDot = dotted.indexOf('.')
  const single = firstDot === -1 ? dotted : dotted.slice(0, firstDot + 1) + dotted.slice(firstDot + 1).replace(EXTRA_DOTS, '')
  const [whole = '', frac] = single.split('.')
  const capped = frac === undefined ? whole : `${whole}.${frac.slice(0, 2)}`
  return LEADING_DOT.test(capped) ? `0${capped}` : capped
}

export function parseUnits(input: string, options: { signed?: boolean } = {}): number | null {
  const cleaned = input.trim().replace(/,/g, '.')
  const pattern = options.signed ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/
  if (!pattern.test(cleaned)) return null
  const negative = cleaned.startsWith('-')
  const body = negative ? cleaned.slice(1) : cleaned
  const [whole, frac = ''] = body.split('.')
  const units = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  return negative ? -units : units
}

export function formatUnits(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${whole}.${frac}`
}

export function formatAmount(amount: number, currency: string): string {
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'RUB' ? '₽' : currency === 'CNY' ? '¥' : `${currency} `
  return `${symbol}${formatUnits(amount)}`
}

/** Sign goes before the symbol (`-$0.79`, not `$-0.79`), the way balances read in the UI. */
export function formatSignedAmount(amount: number, currency: string): string {
  return amount < 0 ? `-${formatAmount(-amount, currency)}` : formatAmount(amount, currency)
}