import { describe, expect, it } from 'vitest'
import { detectRoomTemplate } from '../src/lib/templates'

describe('detectRoomTemplate', () => {
  it('recognises the PokerDom template by English and Cyrillic names', () => {
    expect(detectRoomTemplate('PokerDom')).toBe('pokerdom')
    expect(detectRoomTemplate('Покердом')).toBe('pokerdom')
    expect(detectRoomTemplate('PokerDom 2026')).toBe('pokerdom')
  })

  it('recognises the GG template', () => {
    expect(detectRoomTemplate('GG')).toBe('gg')
    expect(detectRoomTemplate('GGPoker')).toBe('gg')
    expect(detectRoomTemplate('GG poker')).toBe('gg')
    expect(detectRoomTemplate('Джиджи')).toBe('gg')
  })

  it('recognises RedStar as its own template (no room-specific import)', () => {
    expect(detectRoomTemplate('RedStar')).toBe('redstar')
    expect(detectRoomTemplate('РЕД СТАР')).toBe('redstar')
  })

  it('returns null for custom rooms and empty names', () => {
    expect(detectRoomTemplate('Bybit')).toBeNull()
    expect(detectRoomTemplate('')).toBeNull()
    expect(detectRoomTemplate('   ')).toBeNull()
  })
})