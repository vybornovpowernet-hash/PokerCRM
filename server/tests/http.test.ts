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

/** Последний безопасный id: его правка обязана оставить принятым. */
const LAST_SAFE_ID = Number.MAX_SAFE_INTEGER - 1

describe('parseId: типы и безопасные целые (ожидаемое поведение)', () => {
  it('rejects a boolean instead of coercing it to 1', () => {
    expect(rejection(true as unknown as string).status).toBe(400)
    expect(rejection(false as unknown as string).status).toBe(400)
  })

  it('rejects a single-element array instead of coercing it to 1', () => {
    expect(rejection(['1'] as unknown as string).status).toBe(400)
  })

  it('rejects an id string above Number.MAX_SAFE_INTEGER', () => {
    expect(rejection('9007199254740993').status).toBe(400)
  })

  it('rejects numbers at and above Number.MAX_SAFE_INTEGER', () => {
    expect(rejection(9007199254740993).status).toBe(400)
    expect(rejection(9007199254740992).status).toBe(400)
  })

  it('still accepts a plain positive number from a JSON body', () => {
    expect(parseId(5)).toBe(5)
    expect(parseId(2147483648)).toBe(2147483648)
  })

  it('still accepts the digit strings the API actually carries', () => {
    expect(parseId('1')).toBe(1)
    expect(parseId('01')).toBe(1)
    expect(parseId('2147483648')).toBe(2147483648)
  })

  it('never returns a value that is not a safe positive integer', () => {
    const accepted: unknown[] = ['1', '01', '42', '2147483648', 5, 2147483648, LAST_SAFE_ID]
    for (const raw of accepted) {
      const id = parseId(raw as string)
      expect(Number.isSafeInteger(id), String(raw)).toBe(true)
      expect(id > 0, String(raw)).toBe(true)
    }
  })
})
