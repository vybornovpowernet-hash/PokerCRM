/** Client-side money helpers. Amounts travel as integer min units (1/100). */

const SPACES = /\s/g
const NON_MONEY = /[^\d.]/g
const EXTRA_DOTS = /\./g
const LEADING_DOT = /^\./
const SIGNIFICANT = /[0-9.]/

/** Thousands separator: a non-breaking space keeps numbers on one line in narrow columns. */
export const GROUP_SEPARATOR = '\u00A0'

function groupDigits(digits: string): string {
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += GROUP_SEPARATOR
    out += digits[i]
  }
  return out
}

/**
 * Groups the whole part of a money string or integer with non-breaking spaces:
 * `1234` → `1 234`, `1234.5` → `1 234.5`, `1234.` → `1 234.` (a trailing dot
 * survives so the user can keep typing the fraction), `''` → `''`.
 */
export function formatThousands(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : value
  if (text === '') return ''
  const negative = text.startsWith('-')
  const body = negative ? text.slice(1) : text
  const dot = body.indexOf('.')
  const whole = dot === -1 ? body : body.slice(0, dot)
  const rest = dot === -1 ? '' : body.slice(dot)
  return `${negative ? '-' : ''}${groupDigits(whole)}${rest}`
}

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
  const cleaned = input.replace(SPACES, '').replace(/,/g, '.')
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
  const whole = groupDigits(String(Math.floor(abs / 100)))
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

/** Digits and dots before the caret: the anchor that survives re-formatting. */
export function countSignificant(text: string): number {
  let count = 0
  for (const char of text) if (SIGNIFICANT.test(char)) count += 1
  return count
}

/** Caret index right after the `target`-th digit or dot of a formatted value. */
export function caretAfterSignificant(text: string, target: number): number {
  if (target <= 0) return 0
  let seen = 0
  for (let i = 0; i < text.length; i += 1) {
    if (SIGNIFICANT.test(text.charAt(i))) {
      seen += 1
      if (seen === target) return i + 1
    }
  }
  return text.length
}
