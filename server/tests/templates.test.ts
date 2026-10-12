import { describe, expect, it } from 'vitest'
import { detectRoomTemplate, normalizeRoomName, ROOM_TEMPLATES } from '../src/services/templates.js'

describe('normalizeRoomName', () => {
  it('strips non-letters and collapses whitespace', () => {
    expect(normalizeRoomName(' PokerDom.com ')).toBe('pokerdom com')
    expect(normalizeRoomName('ПокерДом!')).toBe('покердом')
    expect(normalizeRoomName('ред - стар')).toBe('ред стар')
    expect(normalizeRoomName('')).toBe('')
  })
})

describe('detectRoomTemplate', () => {
  it('detects PokerDom templates', () => {
    expect(detectRoomTemplate('PokerDom')?.key).toBe('pokerdom')
    expect(detectRoomTemplate('ПокерДом')?.key).toBe('pokerdom')
    expect(detectRoomTemplate('покер дом')?.key).toBe('pokerdom')
    expect(detectRoomTemplate('pokerdom.com')?.key).toBe('pokerdom')
    expect(detectRoomTemplate('покер дам')?.key).toBe('pokerdom')
  })

  it('detects RedStar templates', () => {
    expect(detectRoomTemplate('RedStar')?.key).toBe('redstar')
    expect(detectRoomTemplate('ред стар')?.key).toBe('redstar')
    expect(detectRoomTemplate('РедСтарина')?.key).toBe('redstar')
  })

  it('detects GG templates', () => {
    expect(detectRoomTemplate('GG')?.key).toBe('gg')
    expect(detectRoomTemplate('ggpoker')?.key).toBe('gg')
    expect(detectRoomTemplate('ДжиДжи')?.key).toBe('gg')
  })

  it('returns null for unknown or too-short names', () => {
    expect(detectRoomTemplate('Мой рум')).toBeNull()
    expect(detectRoomTemplate('')).toBeNull()
    expect(detectRoomTemplate('ab')).toBeNull()
    expect(detectRoomTemplate('П')).toBeNull()
  })

  it('has three templates, PokerDom first', () => {
    expect(ROOM_TEMPLATES).toHaveLength(3)
    expect(ROOM_TEMPLATES[0]?.key).toBe('pokerdom')
    expect(ROOM_TEMPLATES[1]?.key).toBe('redstar')
    expect(ROOM_TEMPLATES[2]?.key).toBe('gg')
    expect(ROOM_TEMPLATES[2]?.rateSource).toBe('er-api')
  })
})