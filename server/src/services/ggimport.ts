/**
 * Parser for plain-text GG Poker tournament reports.
 * One file is one tournament. Amounts become min units (integer), the date
 * comes from the file itself ("Tournament started YYYY/MM/DD"), not from any
 * UI input, and the tournament # becomes the natural dedup key.
 *
 * A zero result ("You received a total of $0.") is a VALID number, not a
 * missing value: the parser only fails when an anchor line is genuinely absent
 * or its amount cannot be recognised at all.
 */

import AdmZip from 'adm-zip'
import { addDays, isValidDayKey } from '../lib/date.js'
import { TournamentParseError } from './parsers/types.js'
import type { ITournamentParser, TournamentParserContext, TournamentParserInput, TournamentParseResult, ParsedTournament } from './parsers/types.js'

export interface ParsedGgTournament {
  tournamentId: number
  name: string | null
  date: string
  buyin: number
  result: number
  rank: number | null
  entrants: number | null
  currency: string
}

export interface GgImportFailure {
  fileName: string
  error: string
}

export class GgParseError extends TournamentParseError {}

const SYMBOL_CURRENCIES: Record<string, string> = { $: 'USD', '¥': 'CNY', '€': 'EUR', '₽': 'RUB' }
const CURRENCY_CODES = new Set(['USD', 'CNY', 'EUR', 'RUB'])

/** Number: optional symbol/code prefix/suffix, comma thousands, 0..2 decimals, optional trailing dot. */
const MONEY_RE = /^\s*(?:([$¥€₽])\s*)?([\d,]+(?:\.\d{1,2})?)\s*(?:([A-Za-z]{3}))?[.]?\s*$/
const HEADER_RE = /^Tournament\s+#(\d+)\s*,\s*(.*)$/
const DATE_RE = /^Tournament started\s+(\d{4})\/(\d{2})\/(\d{2})(?:\s+(\d{2}):\d{2}(?::\d{2})?)?/
const BUYIN_RE = /^Buy-?in\s*:\s*(.+)$/i
const RESULT_RE = /^You (?:made (\d+) re-entr(?:y|ies) and )?received a total of\s*(.+)$/
const RANK_RE = /^You finished the tournament in\s+([\d,]+)(?:st|nd|rd|th)\s+place\.?$/
const ENTRANTS_RE = /^([\d,]+)\s+Players?\s*$/i

interface ParsedMoney {
  units: number
  currency: string | null
}

function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''))
}

function parseMoney(text: string): ParsedMoney | null {
  const m = MONEY_RE.exec(text)
  if (!m) return null
  const num = m[2]
  if (num === undefined || !Number.isFinite(toNumber(num))) return null
  let currency: string | null = null
  if (m[1]) {
    currency = SYMBOL_CURRENCIES[m[1]] ?? null
  } else if (m[3]) {
    const code = m[3].toUpperCase()
    currency = CURRENCY_CODES.has(code) ? code : null
  }
  return { units: Math.round(toNumber(num) * 100), currency }
}

function requireAmount(line: string, anchor: string): ParsedMoney {
  const parsed = parseMoney(line)
  if (!parsed) throw new GgParseError(`нераспознанная сумма в строке: "${line.trim()}" (${anchor})`)
  return parsed
}

function parseIntOrNull(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const n = toNumber(raw.trim())
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

export function parseGgFile(text: string, fallbackCurrency: string, dayStartHour = 0): ParsedGgTournament {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new GgParseError('пустой файл отчёта')
  }
  const fallback = fallbackCurrency.trim().toUpperCase()
  if (!CURRENCY_CODES.has(fallback)) {
    throw new GgParseError(`валюта по умолчанию ${fallbackCurrency} не поддерживается`)
  }

  const lines = text.split(/\r?\n/)

  const headerLine = lines.find((l) => HEADER_RE.test(l))
  if (!headerLine) throw new GgParseError('не найдена строка "Tournament #…": файл не похож на отчёт GG')
  const header = HEADER_RE.exec(headerLine)!
  const tournamentId = toNumber(header[1]!)
  const name = (header[2] ?? '').trim() || null

  const startLine = lines.find((l) => DATE_RE.test(l))
  if (!startLine) throw new GgParseError('не найдена дата старта турнира')
  const dateMatch = DATE_RE.exec(startLine)!
  let date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
  if (!isValidDayKey(date)) throw new GgParseError(`нераспознанная дата старта: ${startLine.trim()}`)

  // Logical Day Boundary: a start before `dayStartHour` counts as the previous
  // calendar day, keeping a night session that runs past midnight in one session.
  const startHour = dateMatch[4] !== undefined ? Number(dateMatch[4]) : null
  if (startHour !== null && startHour < dayStartHour) date = addDays(date, -1)

  const buyinLine = lines.find((l) => BUYIN_RE.test(l))
  if (!buyinLine) throw new GgParseError('не найдена строка "Buy-in:"')
  const buyinRest = (BUYIN_RE.exec(buyinLine) as RegExpExecArray)[1]!

  let buyinUnits = 0
  const explicit: string[] = []
  const parts = buyinRest.split('+')
  for (const part of parts) {
    const p = part.trim()
    if (p.length === 0) throw new GgParseError(`нераспознанный бай-ин: "${buyinRest.trim()}"`)
    const parsed = requireAmount(p, 'Buy-in')
    buyinUnits += parsed.units
    if (parsed.currency) explicit.push(parsed.currency)
  }
  if (buyinUnits <= 0) throw new GgParseError(`нулевой бай-ин: "${buyinRest.trim()}"`)

  const resultLine = lines.find((l) => RESULT_RE.test(l))
  if (!resultLine) throw new GgParseError('не найдена строка "You received a total of …": выигрыш неизвестен')
  const resultMatch = RESULT_RE.exec(resultLine) as RegExpExecArray
  const reEntries = resultMatch[1] !== undefined ? toNumber(resultMatch[1]) : 0
  const resultMoney = requireAmount(resultMatch[2]!, 'выигрыш')
  const result = resultMoney.units
  const finalBuyin = buyinUnits * (1 + reEntries)

  const rankLine = lines.find((l) => RANK_RE.test(l))
  const rank = parseIntOrNull(rankLine ? (RANK_RE.exec(rankLine) as RegExpExecArray)[1] : undefined)

  const entrantsLine = lines.find((l) => ENTRANTS_RE.test(l))
  const entrants = entrantsLine ? parseIntOrNull((ENTRANTS_RE.exec(entrantsLine) as RegExpExecArray)[1]) : null

  const resultExplicit = resultMoney.currency
  const distinct = [...new Set([...explicit, ...(resultExplicit ? [resultExplicit] : [])])]
  if (distinct.length > 1) throw new GgParseError('бай-ин и выигрыш указаны в разных валютах')
  const currency = distinct[0] ?? fallback

  return { tournamentId, name, date, buyin: finalBuyin, result, rank, entrants, currency }
}

/**
 * Unpack a GG reports .zip in memory: every *.txt entry is one tournament.
 * Multi-day exports are frequently a zip of per-day zips, so nested *.zip
 * entries are opened recursively (bounded by MAX_ZIP_DEPTH). Pure parsing —
 * nothing is written to the database, failures are collected beside the parsed
 * rows so the caller can show a X-on-Y counter.
 *
 * A dropped .zip is untrusted input, so the archive is also bounded by
 * MAX_ARCHIVE_FILES and MAX_UNCOMPRESSED_BYTES before anything is inflated: a
 * few-KB zip bomb declares hundreds of MB in its header and would otherwise
 * blow up memory on a single paste. Limits abort the whole import (400), unlike
 * a single unreadable report which is only recorded as a failure.
 */
const MAX_ZIP_DEPTH = 4
const MAX_ARCHIVE_FILES = 1000
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024

interface GgArchiveContext {
  fallbackCurrency: string
  dayStartHour: number
  tournaments: ParsedGgTournament[]
  failed: GgImportFailure[]
  entries: number
  declaredBytes: number
  actualBytes: number
}

function tooLargeError(): GgParseError {
  return new GgParseError(`архив слишком большой после распаковки (лимит ${MAX_UNCOMPRESSED_BYTES / (1024 * 1024)} МБ)`)
}

function chargeEntry(entry: AdmZip.IZipEntry, ctx: GgArchiveContext): void {
  ctx.entries += 1
  if (ctx.entries > MAX_ARCHIVE_FILES) {
    throw new GgParseError(`архив содержит слишком много файлов (лимит ${MAX_ARCHIVE_FILES})`)
  }
  ctx.declaredBytes += Math.max(0, entry.header.size)
  if (ctx.declaredBytes > MAX_UNCOMPRESSED_BYTES) throw tooLargeError()
}

/** Declared header sizes can lie; re-check what was actually inflated. */
function readEntry(entry: AdmZip.IZipEntry, ctx: GgArchiveContext): Buffer {
  const data = entry.getData()
  ctx.actualBytes += data.length
  if (ctx.actualBytes > MAX_UNCOMPRESSED_BYTES) throw tooLargeError()
  return data
}

function collectGgEntries(zip: AdmZip, prefix: string, depth: number, ctx: GgArchiveContext): number {
  let totalTxtFiles = 0
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const name = prefix === '' ? entry.entryName : `${prefix}/${entry.entryName}`
    chargeEntry(entry, ctx)
    if (/\.zip$/i.test(entry.entryName)) {
      if (depth + 1 >= MAX_ZIP_DEPTH) {
        ctx.failed.push({ fileName: name, error: `слишком глубокая вложенность архивов (лимит ${MAX_ZIP_DEPTH})` })
        continue
      }
      let nested: AdmZip
      try {
        nested = new AdmZip(readEntry(entry, ctx))
      } catch (e) {
        // an exceeded limit must abort the import, a corrupt nested zip is just a failure
        if (e instanceof GgParseError) throw e
        ctx.failed.push({ fileName: name, error: 'не удалось открыть вложенный архив' })
        continue
      }
      totalTxtFiles += collectGgEntries(nested, name, depth + 1, ctx)
      continue
    }
    if (!/\.txt$/i.test(entry.entryName)) continue
    totalTxtFiles += 1
    let text: string
    try {
      text = readEntry(entry, ctx).toString('utf8')
    } catch (e) {
      if (e instanceof GgParseError) throw e
      ctx.failed.push({ fileName: name, error: e instanceof Error ? e.message : String(e) })
      continue
    }
    try {
      ctx.tournaments.push(parseGgFile(text, ctx.fallbackCurrency, ctx.dayStartHour))
    } catch (e) {
      ctx.failed.push({ fileName: name, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return totalTxtFiles
}

export function parseGgZipArchive(
  buffer: Buffer,
  fallbackCurrency: string,
  dayStartHour = 0
): { tournaments: ParsedGgTournament[]; failed: GgImportFailure[]; totalTxtFiles: number } {
  let zip: AdmZip
  try {
    zip = new AdmZip(buffer)
    zip.getEntries()
  } catch {
    throw new GgParseError('архив не является zip-файлом')
  }

  const ctx: GgArchiveContext = { fallbackCurrency, dayStartHour, tournaments: [], failed: [], entries: 0, declaredBytes: 0, actualBytes: 0 }
  const totalTxtFiles = collectGgEntries(zip, '', 0, ctx)
  return { tournaments: ctx.tournaments, failed: ctx.failed, totalTxtFiles }
}

/** Adapter that fulfils the shared ITournamentParser contract for GG reports. */
export const ggParser: ITournamentParser = {
  accepts: 'zip',
  parse(
    input: TournamentParserInput,
    ctx: TournamentParserContext
  ): TournamentParseResult {
    if (input.kind !== 'zip') throw new TournamentParseError('gg: ожидается zip-архив отчётов')
    const { tournaments, failed, totalTxtFiles } = parseGgZipArchive(input.data as Buffer, ctx.fallbackCurrency, ctx.dayStartHour ?? 0)
    const parsed: ParsedTournament[] = tournaments.map((t) => ({ ...t }))
    return {
      tournaments: parsed,
      successfullyParsed: parsed.length,
      failures: failed.map((f) => ({ source: f.fileName, error: f.error })),
      totalSources: totalTxtFiles
    }
  }
}