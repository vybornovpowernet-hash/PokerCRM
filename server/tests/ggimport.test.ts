import { describe, expect, it } from 'vitest'
import { GgParseError, parseGgFile } from '../src/services/ggimport.js'

interface ReportOverrides {
  header?: string
  buyin?: string
  entrants?: string
  start?: string
  rank?: string
  result?: string
  reEntries?: number
}

function report(o: ReportOverrides = {}): string {
  const {
    header = "Tournament #311146578, Daily Turbo $1, Hold'em No Limit",
    buyin = '$0.92+$0.08',
    entrants = '723 Players',
    start = '2026/09/12 13:15:00 ',
    rank = '317th',
    result = '$0.',
    reEntries
  } = o
  const resultLine =
    reEntries !== undefined
      ? `You made ${reEntries} re-entries and received a total of ${result}`
      : `You received a total of ${result}`
  return [
    header,
    `Buy-in: ${buyin}`,
    entrants,
    'Total Prize Pool: $665.16',
    `Tournament started ${start}`,
    `${rank} : Hero, $0`,
    `You finished the tournament in ${rank} place.`,
    resultLine,
    ''
  ].join('\n')
}

describe('parseGgFile on the real archive samples', () => {
  // [header, buyin, entrants, start, rank, result, expected]
  const cases: [string, string, string, string, string, string, { tournamentId: number; date: string; buyin: number; result: number; rank: number; entrants: number; currency: string }][] = [
    ["Tournament #311146578, Daily Turbo $1, Hold'em No Limit", '$0.92+$0.08', '723 Players', '2026/09/12 13:15:00', '317th', '$0.', { tournamentId: 311146578, date: '2026-09-12', buyin: 100, result: 0, rank: 317, entrants: 723, currency: 'USD' }],
    ['Tournament #311148763, Zodiac Bounty ¥11, Hold\'em No Limit', '¥5.12+¥0.88+¥5', '1262 Players', '2026/09/12 13:30:00', '892th', '¥0.', { tournamentId: 311148763, date: '2026-09-12', buyin: 1100, result: 0, rank: 892, entrants: 1262, currency: 'CNY' }],
    ['Tournament #311150859, Bounty Hunters Hyper Special $3.20, Hold’em No Limit', '$1.44+$0.26+$1.5', '2589 Players', '2026/09/12 13:45:00', '1913th', '$0.', { tournamentId: 311150859, date: '2026-09-12', buyin: 320, result: 0, rank: 1913, entrants: 2589, currency: 'USD' }],
    ['Tournament #311155449, Bounty Hunters Deepstack Turbo $3.20, Hold’em No Limit', '$1.44+$0.26+$1.5', '3269 Players', '2026/09/12 14:15:00', '2107th', '$0.', { tournamentId: 311155449, date: '2026-09-12', buyin: 320, result: 0, rank: 2107, entrants: 3269, currency: 'USD' }],
    ['Tournament #311157882, Bounty Hunters $3.20, Hold’em No Limit', '$1.44+$0.26+$1.5', '541 Players', '2026/09/12 14:30:00', '81th', '$2.25.', { tournamentId: 311157882, date: '2026-09-12', buyin: 320, result: 225, rank: 81, entrants: 541, currency: 'USD' }],
    ['Tournament #311167558, Bounty Hunters Special $2.50, Hold’em No Limit', '$1.3+$0.2+$1', '3888 Players', '2026/09/12 15:30:00', '431th', '$9.97.', { tournamentId: 311167558, date: '2026-09-12', buyin: 250, result: 997, rank: 431, entrants: 3888, currency: 'USD' }],
    ['Tournament #311175297, Bounty Hunters Deepstack Turbo $5.40, Hold’em No Limit', '$2.47+$0.43+$2.5', '5200 Players', '2026/09/12 16:15:00', '44th', '$105.87.', { tournamentId: 311175297, date: '2026-09-12', buyin: 540, result: 10587, rank: 44, entrants: 5200, currency: 'USD' }],
    ['Tournament #313666547, Mystery Battle Royale $1, Hold’em No Limit', '$0.5+$0.08+$0.42', '18 Players', '2026/09/16 20:19:53', '1st', '$6.25.', { tournamentId: 313666547, date: '2026-09-16', buyin: 100, result: 625, rank: 1, entrants: 18, currency: 'USD' }],
    ['Tournament #313669092, Mystery Battle Royale $3, Hold’em No Limit', '$1.5+$0.24+$1.26', '18 Players', '2026/09/16 20:31:09', '2nd', '$9.', { tournamentId: 313669092, date: '2026-09-16', buyin: 300, result: 900, rank: 2, entrants: 18, currency: 'USD' }],
    ['Tournament #313685521, Mystery Battle Royale $1, Hold’em No Limit', '$0.5+$0.08+$0.42', '18 Players', '2026/09/16 21:45:15', '8th', '$0.', { tournamentId: 313685521, date: '2026-09-16', buyin: 100, result: 0, rank: 8, entrants: 18, currency: 'USD' }],
    ['Tournament #313686053, Mystery Battle Royale $1, Hold’em No Limit', '$0.5+$0.08+$0.42', '18 Players', '2026/09/16 21:45:39', '10th', '$0.', { tournamentId: 313686053, date: '2026-09-16', buyin: 100, result: 0, rank: 10, entrants: 18, currency: 'USD' }]
  ]

  for (const [header, buyin, entrants, start, rank, result, expected] of cases) {
    it(`parses ${header.split(',')[1].trim()} as the file itself states`, () => {
      const parsed = parseGgFile(report({ header, buyin, entrants, start, rank, result }), 'USD')
      expect(parsed).toMatchObject(expected)
    })
  }

  it('guarantees result 0 is a real number, never undefined/null', () => {
    const zeroLines: [string, string][] = [
      ['$0.', '$0.92+$0.08'],
      ['¥0.', '¥5.12+¥0.88+¥5']
    ]
    for (const [resultAmount, buyin] of zeroLines) {
      const parsed = parseGgFile(report({ result: resultAmount, buyin }), 'USD')
      expect(parsed.result).toBe(0)
      expect(parsed.result === null || parsed.result === undefined).toBe(false)
      expect(typeof parsed.result).toBe('number')
    }
  })
})

describe('parseGgFile robustness', () => {
  it('falls back to the provided room currency when no symbol is present', () => {
    const parsed = parseGgFile(report({ buyin: '5.12+0.88+5', result: '0.' }), 'CNY')
    expect(parsed.currency).toBe('CNY')
    expect(parsed.buyin).toBe(1100)
    expect(parsed.result).toBe(0)
  })

  it('rejects different currencies in buy-in vs result', () => {
    expect(() => parseGgFile(report({ result: '¥0.' }), 'USD')).toThrow(GgParseError)
  })

  it('rejects an unknown fallback currency', () => {
    expect(() => parseGgFile(report(), 'BTC')).toThrow(GgParseError)
  })

  it('throws when the result anchor line is missing entirely', () => {
    const text = report().split('\n').filter((l) => !/^You received a total of/.test(l)).join('\n')
    expect(() => parseGgFile(text, 'USD')).toThrow(GgParseError)
  })

  it('throws when the result amount is unrecognisable', () => {
    expect(() => parseGgFile(report({ result: 'a mountain of chips' }), 'USD')).toThrow(GgParseError)
  })

  it('throws on an empty file and on a non-GG file', () => {
    expect(() => parseGgFile('', 'USD')).toThrow(GgParseError)
    expect(() => parseGgFile('This is a poker session log without anchors.', 'USD')).toThrow(GgParseError)
  })

  it('throws when the tournament header is missing', () => {
    const text = report().split('\n').filter((l) => !/^Tournament #/.test(l)).join('\n')
    expect(() => parseGgFile(text, 'USD')).toThrow(GgParseError)
  })

  it('parses tactical order suffixes like 81th / 431th and 1st / 2nd', () => {
    const eight = parseGgFile(report({ rank: '81th', result: '$0.' }), 'USD')
    expect(eight.rank).toBe(81)
    const winner = parseGgFile(report({ rank: '1st', result: '$6.25.' }), 'USD')
    expect(winner.rank).toBe(1)
  })
})

describe('parseGgFile re-entry buy-in math', () => {
  it('keeps the base buy-in when there are no re-entries', () => {
    const parsed = parseGgFile(report({ buyin: '$1.3+$0.2+$1', result: '$0.' }), 'USD')
    expect(parsed.buyin).toBe(250)
  })

  it('multiplies the buy-in by two with a single re-entry', () => {
    const parsed = parseGgFile(report({ buyin: '$1.3+$0.2+$1', result: '$0.', reEntries: 1 }), 'USD')
    expect(parsed.buyin).toBe(500)
  })

  it('multiplies the buy-in by three with two re-entries', () => {
    const parsed = parseGgFile(report({ buyin: '$1.3+$0.2+$1', result: '$0.', reEntries: 2 }), 'USD')
    expect(parsed.buyin).toBe(750)
  })

  it('still returns the payout of a re-entry tournament as a real number', () => {
    const parsed = parseGgFile(report({ buyin: '$1.3+$0.2+$1', result: '$8.50.', reEntries: 1 }), 'USD')
    expect(parsed.buyin).toBe(500)
    expect(parsed.result).toBe(850)
  })

  it('parses the real re-entry report #312073697 with the corrected buy-in', () => {
    const text = [
      "Tournament #312073697, Bounty Hunters Deepstack Turbo $2.50, Hold'em No Limit",
      'Buy-in: $1.3+$0.2+$1',
      '4276 Players',
      'Total Prize Pool: $10,000',
      'Tournament started 2026/09/16 18:15:00 ',
      '2679th : Hero, $0',
      'You finished the tournament in 2679th place.',
      'You made 1 re-entries and received a total of $0.',
      ''
    ].join('\n')
    const parsed = parseGgFile(text, 'USD')
    expect(parsed).toMatchObject({
      tournamentId: 312073697,
      date: '2026-09-16',
      buyin: 500,
      result: 0,
      rank: 2679,
      entrants: 4276,
      currency: 'USD'
    })
  })

  it('does not change a standard report without the re-entry clause', () => {
    const parsed = parseGgFile(report({ buyin: '$1.3+$0.2+$1', result: '$9.97.' }), 'USD')
    expect(parsed.buyin).toBe(250)
    expect(parsed.result).toBe(997)
  })
})