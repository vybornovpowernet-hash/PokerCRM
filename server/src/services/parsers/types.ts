/**
 * Parser contract for tournament report imports. Every parser adapts its own
 * input format (a GG .zip archive or pasted PokerDom text) to one standardized
 * array of tournaments, so the routes can dispatch to the right regex
 * implementation purely by the room's template without knowing GG/PokerDom
 * specifics (Open/Closed principle).
 */

export interface ParsedTournament {
  tournamentId: number
  name: string | null
  date: string
  buyin: number
  result: number
  rank: number | null
  entrants: number | null
  currency: string
  buyinUsd?: number | null
  resultUsd?: number | null
}

export interface TournamentParseFailure {
  source: string
  error: string
}

export interface TournamentParseResult {
  tournaments: ParsedTournament[]
  successfullyParsed: number
  failures: TournamentParseFailure[]
  totalSources: number
}

export type TournamentParserInput = { kind: 'zip'; data: Buffer } | { kind: 'text'; data: string }

export interface TournamentParserContext {
  roomId: number
  fallbackCurrency: string
  /** Logical Day Boundary hour (0..12); parsers may shift a pre-dawn start to the previous day. */
  dayStartHour?: number
}

export interface ITournamentParser {
  accepts: 'zip' | 'text'
  parse(input: TournamentParserInput, ctx: TournamentParserContext): TournamentParseResult
}

export class TournamentParseError extends Error {}