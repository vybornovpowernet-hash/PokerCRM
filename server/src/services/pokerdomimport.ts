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
 * tournamentId is a numeric hash of (name + date + base buyin) for dedup.
 * Currency is always RUB (PokerDom is a Russian room).
 */

import { TournamentParseError } from './parsers/types.js'
import type { ITournamentParser, TournamentParserContext, TournamentParserInput, TournamentParseResult, ParsedTournament } from './parsers/types.js'
import { addDays } from '../lib/date.js'
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

function parseRussianDate(line: string): { date: string; time: string } | null {
  const m = DATE_RE.exec(line)
  if (!m) return null
  const day = Number(m[1])
  const monthKey = m[2]!.toLowerCase().slice(0, 3)
  const month = MONTHS[monthKey]
  if (!month || day < 1 || day > 31) return null
  return {
    date: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    time: `${m[3]}:${m[4]}`
  }
}

function parseRubAmount(text: string): number | null {
  const cleaned = text.replace(/\s/g, '').replace(',', '.')
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

function numericHash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function parseOneBlock(lines: string[], dayStartHour: number): ParsedPokerDomTournament {
  if (lines.length < 5) throw new PokerDomParseError('слишком мало строк')

  const parsedDate = parseRussianDate(lines[0]!)
  if (!parsedDate) throw new PokerDomParseError(`не распознана дата: "${lines[0]}"`)
  const { time } = parsedDate

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
  const tid = numericHash(`${name}|${parsedDate.date} ${time}|${baseBuyin}`)

  // Logical Day Boundary (same rule as the GG parser): a start before
  // `dayStartHour` belongs to the previous calendar day, keeping a night
  // session that runs past midnight in one session.
  let date = parsedDate.date
  const startHour = Number(time.slice(0, 2))
  if (Number.isFinite(startHour) && startHour < dayStartHour) date = addDays(date, -1)

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
 * Stateless — nothing is written to the database.
 */
export function parsePokerDomText(
  text: string,
  fallbackCurrency: string,
  dayStartHour = 0
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
      tournaments.push(parseOneBlock(block, dayStartHour))
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
    const { tournaments, failed } = parsePokerDomText(input.data, ctx.fallbackCurrency, ctx.dayStartHour ?? 0)
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
