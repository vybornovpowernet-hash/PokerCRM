import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { dayKey } from '../src/lib/date.js'
import { countActive, listActive } from '../src/services/notifications.js'
import { getScaledRate } from '../src/services/rates/storage.js'
import {
  KIND_CNY_USD_FAILED,
  KIND_EUR_USD_FAILED,
  KIND_USD_RUB_FAILED,
  RETRY_BASE_MS,
  autoRefresh,
  refreshAllRates,
  resetRateRefreshState
} from '../src/services/rates/refresh.js'

vi.mock('../src/services/rates/eras.js', () => ({
  fetchEurUsdRate: vi.fn(),
  fetchCnyUsdRate: vi.fn()
}))
vi.mock('../src/services/rates/pokerdon.js', () => ({
  scrapeUsdRub: vi.fn(),
  getBrowser: vi.fn(),
  closeBrowser: vi.fn()
}))

import { fetchCnyUsdRate, fetchEurUsdRate } from '../src/services/rates/eras.js'
import { scrapeUsdRub } from '../src/services/rates/pokerdon.js'

const mockEras = vi.mocked(fetchEurUsdRate)
const mockCny = vi.mocked(fetchCnyUsdRate)
const mockPokerdom = vi.mocked(scrapeUsdRub)

describe('refreshAllRates', () => {
  beforeEach(() => {
    setDbForTests(initDb(':memory:'))
    vi.clearAllMocks()
    resetRateRefreshState()
  })
  afterEach(() => resetDbForTests())

  it('stores all three scaled rates and resolves failure notifications on success', async () => {
    mockEras.mockResolvedValue(1.08)
    mockCny.mockResolvedValue(6.726834)
    mockPokerdom.mockResolvedValue(89.3936)

    const result = await refreshAllRates()

    expect(result).toEqual({ usdRub: true, eurUsd: true, cnyUsd: true })
    expect(getScaledRate('USD', 'RUB', dayKey())).toBe(Math.round(89.3936 * 10_000))
    expect(getScaledRate('EUR', 'USD', dayKey())).toBe(Math.round(1.08 * 10_000))
    expect(getScaledRate('USD', 'CNY', dayKey())).toBe(Math.round(6.726834 * 10_000))
    expect(countActive()).toBe(0)
  })

  it('stays silent for transient misses and notifies after repeated failures, keeping the other sources', async () => {
    mockEras.mockResolvedValue(1.08)
    mockCny.mockResolvedValue(6.73)
    mockPokerdom.mockRejectedValue(new Error('page timeout'))

    await refreshAllRates()
    await refreshAllRates()
    expect(countActive()).toBe(0)

    await refreshAllRates()

    expect(countActive()).toBe(1)
    const active = listActive()
    expect(active.some((n) => n.kind === KIND_USD_RUB_FAILED && n.message.includes('PokerDom'))).toBe(true)
    expect(active.some((n) => n.kind === KIND_EUR_USD_FAILED)).toBe(false)
    expect(active.some((n) => n.kind === KIND_CNY_USD_FAILED)).toBe(false)
    expect(getScaledRate('EUR', 'USD', dayKey())).not.toBeNull()
    expect(getScaledRate('USD', 'CNY', dayKey())).not.toBeNull()
  })

  it('reports failing sources independently', async () => {
    mockEras.mockRejectedValue(new Error('network down'))
    mockCny.mockRejectedValue(new Error('timeout'))
    mockPokerdom.mockRejectedValue(new Error('5xx'))

    await refreshAllRates()
    expect(countActive()).toBe(0)

    await refreshAllRates()
    await refreshAllRates()

    expect(countActive()).toBe(3)
  })

  it('clears a previous failure notification once the source recovers', async () => {
    mockPokerdom.mockRejectedValueOnce(new Error('boom'))
    mockEras.mockResolvedValue(1.08)
    mockCny.mockResolvedValue(6.73)
    await refreshAllRates()
    await refreshAllRates()
    await refreshAllRates()
    expect(countActive()).toBe(1)

    mockPokerdom.mockResolvedValue(90.0)
    await refreshAllRates()

    expect(countActive()).toBe(0)
  })

  it('flags CNY/USD parity through its own notification kind', async () => {
    mockEras.mockResolvedValue(1.08)
    mockCny.mockRejectedValue(new Error('bad payload'))
    mockPokerdom.mockResolvedValue(89.0)

    await refreshAllRates()
    await refreshAllRates()
    await refreshAllRates()

    const active = listActive()
    expect(active.some((n) => n.kind === KIND_CNY_USD_FAILED && n.message.includes('CNY/USD'))).toBe(true)
  })
})

describe('autoRefresh retry scheduling', () => {
  beforeEach(() => {
    setDbForTests(initDb(':memory:'))
    vi.clearAllMocks()
    resetRateRefreshState()
    vi.useFakeTimers()
  })
  afterEach(() => {
    resetRateRefreshState()
    vi.useRealTimers()
    resetDbForTests()
  })

  it('reschedules a failing source with growing backoff, notifies after the threshold, and stops on success', async () => {
    mockEras.mockResolvedValue(1.08)
    mockCny.mockResolvedValue(6.73)
    mockPokerdom.mockRejectedValue(new Error('down'))

    await autoRefresh()
    expect(mockPokerdom).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS)
    expect(mockPokerdom).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS * 2)
    expect(mockPokerdom).toHaveBeenCalledTimes(3)
    expect(listActive().some((n) => n.kind === KIND_USD_RUB_FAILED)).toBe(true)

    mockPokerdom.mockResolvedValue(90.0)
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS * 4)
    expect(mockPokerdom).toHaveBeenCalledTimes(4)
    expect(listActive()).toEqual([])

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(mockPokerdom).toHaveBeenCalledTimes(4)
  })

  it('a full success cancels a pending retry before it fires', async () => {
    mockEras.mockResolvedValue(1.08)
    mockCny.mockResolvedValue(6.73)
    mockPokerdom.mockRejectedValueOnce(new Error('boom'))
    await autoRefresh()

    mockPokerdom.mockResolvedValue(90.0)
    await autoRefresh()

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(mockPokerdom).toHaveBeenCalledTimes(2)
  })
})