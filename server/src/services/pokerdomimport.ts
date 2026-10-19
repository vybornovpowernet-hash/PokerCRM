/**
 * Parser for plain-text PokerDom tournament reports.
 * The user pastes clipboard text; each tournament is a 5–6 line block:
 *   line 1: "16 сент., 14:00"               — date/time
 *   line 2: "Супер Прогрессивный Нокаут …"   — tournament name
 *   line 3: "БЛ Холдем"                       — format (ignored)
 *   line 4: "500 р."                          — base buy-in
 *   line 5: "Вхождение #N"                    — optional re-entry
 *   line 6: "500 р.\t13\t1 288,05 р."        — buyin \t place \t result
 *
 * Reports carry no year ("16 сент., 14:00"), so it comes from the current
 * server day (`today`): the current year, rolled back one when the resulting
 * date would still be in the future — a 31 December archive imported on
 * 1 January belongs to the previous year, not to the new one.
 *
 * tournamentId is a 53-bit hash of (name + report date + base buyin) for dedup.
 * Currency is always RUB (PokerDom is a Russian room).
 */

import { createHash } from 'node:crypto'
import { TournamentParseError } from './parsers/types.js'
import type { ITournamentParser, TournamentParserContext, TournamentParserInput, TournamentParseResult, ParsedTournament } from './parsers/types.js'
import { addDays, dayKey, isValidDayKey } from '../lib/date.js'
import { convertToUsd } from './rates/convert.js'

export interface ParsedPokerDomTournament {
  tournamentId: number
  name: string | null
  date: string
  buyin: number
  result: number
  rank: number | null
  entrants: number | null
  currency: string
}

export interface PokerDomImportFailure {
  block: string
  error: string
}

export class PokerDomParseError extends TournamentParseError {}

const MONTHS: Record<string, number> = {
  янв: 1, фев: 2, мар: 3, апр: 4, мая: 5, май: 5, июн: 6,
  июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12
}

const DATE_RE = /^(\d{1,2})\s+(янв|фев|мар|апр|май|мая|июн|июл|авг|сен|окт|ноя|дек)[а-яё]*[.,\s]+(\d{1,2}):(\d{2})/i
const BUYIN_RE = /^([\d\s]+(?:[,.]\d{1,2})?)\s*р\.\s*$/i
const ENTRY_RE = /^Вхождение\s+#(\d+)/i
const RESULT_RE = /^([\d\s]+(?:[,.]\d{1,2})?)\s*р\.\t(\d+)\t([\d\s]+(?:[,.]\d{1,2})?)\s*р\.\s*$/i

interface RussianDate {
  month: number
  day: number
  hour: number
  /** Raw "H:MM" as printed by the report — part of the dedup identity. */
  time: string
}

function parseRussianDate(line: string): RussianDate | null {
  const m = DATE_RE.exec(line)
  if (!m) return null
  const day = Number(m[1])
  const monthKey = m[2]!.toLowerCase().slice(0, 3)
  const month = MONTHS[monthKey]
  if (!month || day < 1 || day > 31) return null
  return { month, day, hour: Number(m[3]), time: `${m[3]}:${m[4]}` }
}

/**
 * A year-less report date: take the current year and roll it back one when the
 * candidate day is still ahead of us (importing "31 дек." on 1 января). Reports
 * older than a year are indistinguishable and stay in the current year.
 */
function reportDayKey(month: number, day: number, today: string): string {
  const year = Number(today.slice(0, 4))
  const key = (y: number) => `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const candidate = key(year)
  return candidate > today ? key(year - 1) : candidate
}

function parseRubAmount(text: string): number | null {
  const cleaned = text.replace(/\s/g, '').replace(',', '.')
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

/**
 * 53-bit tournament id (a safe integer, so the DB column, the client types and
 * the JSON contract stay untouched). The legacy 32-bit hash collided at roughly
 * 2 % per 10k keys, and because the import upserts on UNIQUE(room_id,
 * tournament_id) a collision silently overwrote an unrelated tournament.
 * SHA-256 trimmed to 53 bits pushes the birthday bound out to ~10^8 keys.
 */
export function numericHash(str: string): number {
  const digest = createHash('sha256').update(str, 'utf8').digest()
  let n = 0
  for (let i = 0; i < 6; i++) n = n * 256 + (digest[i] ?? 0)
  n = n * 32 + ((digest[6] ?? 0) & 0x1f)
  return n === 0 ? 1 : n
}

function parseOneBlock(lines: string[], dayStartHour: number, today: string): ParsedPokerDomTournament {
  if (lines.length < 5) throw new PokerDomParseError('слишком мало строк')

  const parsedDate = parseRussianDate(lines[0]!)
  if (!parsedDate) throw new PokerDomParseError(`не распознана дата: "${lines[0]}"`)
  const { time, hour } = parsedDate

  // 31 апреля parses as a number but is not a real day: fail this block instead
  // of persisting a date that no rollup can bucket.
  const reportDate = reportDayKey(parsedDate.month, parsedDate.day, today)
  if (!isValidDayKey(reportDate)) throw new PokerDomParseError(`некорректная дата: "${lines[0]}"`)

  const name = lines[1]?.trim()
  if (!name) throw new PokerDomParseError('пустое название турнира')

  const buyinMatch = BUYIN_RE.exec(lines[3] ?? '')
  if (!buyinMatch) throw new PokerDomParseError(`не распознан бай-ин: "${lines[3]}"`)
  const baseBuyin = parseRubAmount(buyinMatch[1]!)
  if (baseBuyin === null || baseBuyin <= 0) throw new PokerDomParseError(`нулевой бай-ин: "${lines[3]}"`)

  let reEntries = 0
  let resultLineIdx = lines.length - 1

  if (lines.length >= 6) {
    const entryMatch = ENTRY_RE.exec(lines[4]!)
    if (entryMatch) {
      reEntries = Number(entryMatch[1]) - 1
      resultLineIdx = 5
    }
  }

  const resultMatch = RESULT_RE.exec(lines[resultLineIdx] ?? '')
  if (!resultMatch) throw new PokerDomParseError(`не распознана строка результата: "${lines[resultLineIdx]}"`)
  const result = parseRubAmount(resultMatch[3]!)
  if (result === null) throw new PokerDomParseError(`не распознан результат: "${resultMatch[3]}"`)
  const place = Number(resultMatch[2])

  const finalBuyin = baseBuyin * (1 + reEntries)
  // The hash keys on the report's own datetime — not the shifted date — so
  // changing «Начало игровых суток» later re-imports the same tournament into
  // its new day via upsert instead of creating a duplicate.
  const tid = numericHash(`${name}|${reportDate} ${time}|${baseBuyin}`)

  // Logical Day Boundary (same rule as the GG parser): a start before
  // `dayStartHour` belongs to the previous calendar day, keeping a night
  // session that runs past midnight in one session.
  let date = reportDate
  if (hour < dayStartHour) date = addDays(date, -1)

  return {
    tournamentId: tid,
    name,
    date,
    buyin: finalBuyin,
    result,
    rank: place > 0 ? place : null,
    entrants: null,
    currency: 'RUB'
  }
}

/**
 * Parse a pasted PokerDom report text. Returns parsed tournaments and failures.
 * `today` is the current server day (YYYY-MM-DD) and only feeds the year-less
 * report date resolution. Stateless — nothing is written to the database.
 */
export function parsePokerDomText(
  text: string,
  fallbackCurrency: string,
  dayStartHour = 0,
  today: string = dayKey()
): { tournaments: ParsedPokerDomTournament[]; failed: PokerDomImportFailure[] } {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new PokerDomParseError('пустой текст отчёта')
  }
  const fallback = fallbackCurrency.trim().toUpperCase()
  if (fallback !== 'RUB' && fallback !== 'USD' && fallback !== 'EUR') {
    throw new PokerDomParseError(`валюта по умолчанию ${fallbackCurrency} не поддерживается`)
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)

  const blocks: string[][] = []
  let current: string[] = []
  for (const line of lines) {
    if (DATE_RE.test(line) && current.length > 0) {
      blocks.push(current)
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) blocks.push(current)

  if (blocks.length === 0) throw new PokerDomParseError('не найдено ни одного турнира')

  const tournaments: ParsedPokerDomTournament[] = []
  const failed: PokerDomImportFailure[] = []
  for (const block of blocks) {
    try {
      tournaments.push(parseOneBlock(block, dayStartHour, today))
    } catch (e) {
      failed.push({ block: block.join(' | '), error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { tournaments, failed }
}

/** Adapter that fulfils the shared ITournamentParser contract for PokerDom text. */
export const pokerdomParser: ITournamentParser = {
  accepts: 'text',
  parse(
    input: TournamentParserInput,
    ctx: TournamentParserContext
  ): TournamentParseResult {
    if (input.kind !== 'text') throw new TournamentParseError('pokerdom: ожидается текст отчёта')
    const { tournaments, failed } = parsePokerDomText(input.data, ctx.fallbackCurrency, ctx.dayStartHour ?? 0, ctx.today)
    const parsed: ParsedTournament[] = tournaments.map((t) => ({
      ...t,
      buyinUsd: convertToUsd(t.buyin, t.currency, t.date, ctx.roomId),
      resultUsd: convertToUsd(t.result, t.currency, t.date, ctx.roomId)
    }))
    return {
      tournaments: parsed,
      successfullyParsed: parsed.length,
      failures: failed.map((f) => ({ source: f.block, error: f.error })),
      totalSources: parsed.length + failed.length
    }
  }
}
