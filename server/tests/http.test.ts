import { describe, expect, it } from 'vitest'
import { parseId } from '../src/lib/http.js'
import { HttpError } from '../src/lib/errors.js'

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
      let caught: unknown
      try {
        parseId(raw)
      } catch (e) {
        caught = e
      }
      expect(caught, `parseId(${JSON.stringify(raw)}) should throw`).toBeInstanceOf(HttpError)
      expect((caught as HttpError).status).toBe(400)
    }
  })
})
