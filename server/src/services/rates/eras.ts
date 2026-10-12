const ER_URL = 'https://open.er-api.com/v6/latest/EUR'
const ER_URL_USD_BASE = 'https://open.er-api.com/v6/latest/USD'
const RETRIES = 3
const TIMEOUT_MS = 15_000

interface ErApiBody {
  result?: string
  rates?: Record<string, number>
}

async function fetchWithRetries(url: string): Promise<ErApiBody> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) throw new Error(`er-api responded ${res.status}`)
      const body = (await res.json()) as ErApiBody
      if (body.result !== 'success') throw new Error('er-api: unexpected payload')
      return body
    } catch (err) {
      lastErr = err
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 2_000 * attempt))
    }
  }
  throw new Error(`er-api fetch failed: ${String(lastErr)}`)
}

/** Returns how many USD one EUR is worth, fetched from open.er-api.com. */
export async function fetchEurUsdRate(): Promise<number> {
  const body = await fetchWithRetries(ER_URL)
  const usd = body.rates?.USD
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0 || usd > 10) {
    throw new Error('er-api: implausible EUR/USD rate')
  }
  return usd
}

/** Returns how many CNY one USD is worth — a direct USD→CNY cross, no ruble involved. */
export async function fetchCnyUsdRate(): Promise<number> {
  const body = await fetchWithRetries(ER_URL_USD_BASE)
  const cny = body.rates?.CNY
  if (typeof cny !== 'number' || !Number.isFinite(cny) || cny <= 0 || cny > 15) {
    throw new Error('er-api: implausible USD/CNY rate')
  }
  return cny
}