import { describe, expect, it } from 'vitest'
import { resolveTournamentParser } from '../src/services/parsers/registry.js'
import type { Room } from '../src/services/rooms.js'

function room(name: string): Room {
  return {
    id: 1,
    name,
    cashCurrency: 'USD',
    tournamentCurrency: 'USD',
    rateSource: null,
    color: '#f1f5f9',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('resolveTournamentParser', () => {
  it('resolves the GG parser for a GG room', () => {
    const parser = resolveTournamentParser(room('GG'))
    expect(parser).not.toBeNull()
    expect(parser!.accepts).toBe('zip')
  })

  it('resolves the PokerDom parser for a PokerDom room', () => {
    const parser = resolveTournamentParser(room('PokerDom'))
    expect(parser).not.toBeNull()
    expect(parser!.accepts).toBe('text')
  })

  it('returns null for a room without a registered parser', () => {
    expect(resolveTournamentParser(room('Bybit'))).toBeNull()
    expect(resolveTournamentParser(room('RedStar'))).toBeNull()
  })

  it('returns null for an arbitrary unknown room', () => {
    expect(resolveTournamentParser(room('Weird custom room name'))).toBeNull()
  })
})