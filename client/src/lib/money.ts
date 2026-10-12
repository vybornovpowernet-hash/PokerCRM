/** Client-side money helpers. Amounts travel as integer min units (1/100). */

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