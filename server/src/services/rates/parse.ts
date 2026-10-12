/**
 * Extracts the USD → RUB exchange rate from the PokerDom page text.
 * The page shows a list of currency codes followed by their value in rubles, e.g.
 *
 *   KZT
 *   0,1944 ₽
 *   AZN
 *   52,5840 ₽
 *   USD
 *   89,3936 ₽
 *
 * We must take the value of the USD row specifically — never "the first
 * number on the page". The value must be immediately followed by the ruble
 * sign (₽), anchoring the match to the currency block; stray "USD 2025"
 * mentions or other numbers with no ₽ are skipped. Plausibility guards
 * (1–10000) reject stray captures such as the KZT row (0.19).
 */

const PLAUSIBLE_MIN = 1
const PLAUSIBLE_MAX = 10_000

export function parseRate(raw: string): number | null {
  const normalized = raw.replace(/[\s\u00a0]/g, '').replace(',', '.')
  const value = Number(normalized)
  if (!Number.isFinite(value)) return null
  return value
}

export function parseUsdRateFromPage(text: string): number {
  const tokens = text.split(/\s+/)
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== 'USD') continue
    const window = tokens.slice(i + 1, i + 5).join(' ')
    const match = window.match(/(\d{1,3}(?:[.,]\d{1,6})?)\s*₽/)
    if (!match || !match[1]) continue
    const value = parseRate(match[1])
    if (value !== null && value >= PLAUSIBLE_MIN && value <= PLAUSIBLE_MAX) {
      return value
    }
  }
  throw new Error('USD rate not found on page')
}