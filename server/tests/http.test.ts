import { describe, expect, it } from 'vitest'
import { parseId } from '../src/lib/http.js'
import { HttpError } from '../src/lib/errors.js'

function rejection(raw: unknown): HttpError {
  let caught: unknown
  try {
    parseId(raw as string)
  } catch (e) {
    caught = e
  }
  expect(caught, `parseId(${JSON.stringify(raw)}) должен бросать HttpError`).toBeInstanceOf(HttpError)
  return caught as HttpError
}

describe('parseId', () => {
  it('accepts positive decimal ids as strings or numbers', () => {
    expect(parseId('1')).toBe(1)
    expect(parseId('42')).toBe(42)
    expect(parseId('007')).toBe(7)
    expect(parseId(12)).toBe(12)
  })

  it('rejects anything that is not a plain positive integer', () => {
    const bad: (string | number)[] = ['', ' ', 'abc', '1e3', '0x10', '1.0', '1.5', '-1', '0', '+1', '1 ', ' 1', 0, -3, 1.5, NaN, Infinity]
    for (const raw of bad) {
      const caught = rejection(raw)
      expect(caught.status).toBe(400)
    }
  })

  it('accepts a leading-zero id and reads it as the number it denotes', () => {
    expect(parseId('01')).toBe(1)
  })

  it('accepts an id above the 32-bit signed range', () => {
    expect(parseId('2147483648')).toBe(2147483648)
  })

  it('rejects decimal, alphanumeric, exponent, hex, sign and separator forms', () => {
    for (const raw of ['', ' ', '0', '000', '-1', '+5', '5.0', '5abc', '1e3', '0x10', '1_0']) {
      expect(rejection(raw).status, JSON.stringify(raw)).toBe(400)
    }
  })

  it('rejects non-string values that are not positive integers', () => {
    for (const raw of [null, undefined, NaN, Infinity, 1.5, {}]) {
      expect(rejection(raw).status, String(raw)).toBe(400)
    }
  })

  it('answers with the same client-facing message for every rejection', () => {
    expect(rejection('5abc').message).toBe('Invalid id')
    expect(rejection(0).message).toBe('Invalid id')
  })
})
