import { describe, expect, it } from 'vitest'
import { parseRate, parseUsdRateFromPage } from '../src/services/rates/parse.js'

const PAGE_TEXT = `KZT
0,1944 ₽
AZN
52,5840 ₽
USD
89,3936 ₽
UZS
0,0076 ₽
EUR
103,9569 ₽`

describe('parseUsdRateFromPage', () => {
  it('takes the USD row value, not the first number on the page', () => {
    expect(parseUsdRateFromPage(PAGE_TEXT)).toBeCloseTo(89.3936, 4)
  })

  it('parses a compact same-line layout', () => {
    const compact = 'USD 89.4 ₽  |  EUR 103.96 ₽  |  KZT 0.19 ₽'
    expect(parseUsdRateFromPage(compact)).toBeCloseTo(89.4, 1)
  })

  it('skips implausible neighbors and finds a later genuine rate', () => {
    const text = `KZT\n${'0.19 ₽\nUSD\n'}89.4031 ₽`
    expect(parseUsdRateFromPage(text)).toBeCloseTo(89.4031, 4)
  })

  it('takes USD from the currency block with the ₽ sign (live layout)', () => {
    const block = `KZT
0,1947 ₽
EUR
102,0440 ₽
USD
88,4117 ₽
UZS
0,0075 ₽
AZN
52,0068 ₽`
    expect(parseUsdRateFromPage(block)).toBeCloseTo(88.4117, 4)
  })

  it('ignores stray USD mentions without the ₽ sign', () => {
    const text = `Bank rates USD 2025 page
KZT
0,1947 ₽
USD
88,4117 ₽`
    expect(parseUsdRateFromPage(text)).toBeCloseTo(88.4117, 4)
  })

  it('throws when USD is absent', () => {
    expect(() => parseUsdRateFromPage('KZT 0.19 ₽\nEUR 103.9 ₽')).toThrow(/not found/)
  })
})

describe('parseRate', () => {
  it('normalizes comma decimals and spaces', () => {
    expect(parseRate('1 234,56')).toBe(1234.56)
    expect(parseRate('0,1944')).toBe(0.1944)
  })

  it('returns null for garbage', () => {
    expect(parseRate('abc')).toBeNull()
  })
})