import { describe, expect, it } from 'vitest'
import { DEFAULT_COLOR, validateColor } from '../src/lib/color.js'
import { HttpError } from '../src/lib/errors.js'

function rejection(value: unknown): HttpError {
  let caught: unknown
  try {
    validateColor(value, 'color')
  } catch (e) {
    caught = e
  }
  expect(caught, `validateColor(${JSON.stringify(value)}) должен бросать HttpError`).toBeInstanceOf(HttpError)
  return caught as HttpError
}

describe('validateColor', () => {
  it('accepts a well-formed six-digit hex color', () => {
    expect(validateColor('#f1f5f9')).toBe('#f1f5f9')
  })

  it('normalizes an uppercase hex color to lowercase', () => {
    expect(validateColor('#F1F5F9')).toBe('#f1f5f9')
    expect(validateColor('#A5B4FC')).toBe('#a5b4fc')
  })

  it('trims surrounding whitespace before accepting and storing', () => {
    expect(validateColor('  #f1f5f9  ')).toBe('#f1f5f9')
    expect(validateColor('\t#6ee7b7\n')).toBe('#6ee7b7')
  })

  it('rejects a three-digit shorthand', () => {
    expect(rejection('#FFF').status).toBe(400)
    expect(rejection('#fff').status).toBe(400)
  })

  it('rejects eight-digit hex with alpha', () => {
    expect(rejection('#ffffff80').status).toBe(400)
  })

  it('rejects a seven-digit hex run', () => {
    expect(rejection('#f1f5f99').status).toBe(400)
  })

  it('rejects non-hex colors and missing hash', () => {
    for (const raw of ['red', 'rebeccapurple', '#gggggg', '#f1f5g9', 'f1f5f9']) {
      expect(rejection(raw).status, String(raw)).toBe(400)
    }
  })

  it('rejects non-string values', () => {
    for (const raw of [5, true, [], {}, 0]) {
      expect(rejection(raw).status, JSON.stringify(raw)).toBe(400)
    }
  })

  it('substitutes the default for empty, null and undefined', () => {
    expect(validateColor('')).toBe(DEFAULT_COLOR)
    expect(validateColor(null)).toBe(DEFAULT_COLOR)
    expect(validateColor(undefined)).toBe(DEFAULT_COLOR)
  })

  it('keeps the default itself a valid six-digit color', () => {
    expect(DEFAULT_COLOR).toBe('#f1f5f9')
    expect(validateColor(DEFAULT_COLOR)).toBe(DEFAULT_COLOR)
  })

  it('names the field in the error message', () => {
    expect(rejection('#FFF').message).toBe('color: must be a hex color like #f1f5f9')
    expect(rejection('#FFF')).toBeInstanceOf(HttpError)
    const named = (() => {
      try {
        validateColor('#FFF', 'habitColor')
      } catch (e) {
        return (e as HttpError).message
      }
      return null
    })()
    expect(named).toBe('habitColor: must be a hex color like #f1f5f9')
  })
})
