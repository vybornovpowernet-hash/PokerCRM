import type { FastifyInstance } from 'fastify'
import { HttpError } from '../lib/errors.js'
import { isValidDayKey, dayKey } from '../lib/date.js'
import { parseId } from '../lib/http.js'
import {
  adjustBalanceToTournaments,
  deleteImportedTournament,
  listDayTournaments,
  previewDayReconcile,
  reconcileDay,
  reconcileSummary,
  saveDayBatch,
  writeoffCasinoRemainder
} from '../services/tournaments.js'
import type { TournamentImportInput, TournamentLineInput } from '../services/tournaments.js'
import { TournamentParseError } from '../services/parsers/types.js'
import type { TournamentParserInput } from '../services/parsers/types.js'
import { resolveTournamentParser } from '../services/parsers/registry.js'
import { getRoom } from '../services/rooms.js'
import { getDayStartHour } from '../services/settings.js'
import { tournamentMbrKpi, tournamentSummary } from '../services/statistics.js'

export async function tournamentsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { dateFrom?: string; dateTo?: string; roomIds?: string } }>('/api/tournaments/summary', async (req) => {
    const { dateFrom, dateTo, roomIds } = req.query
    if (!dateFrom || !dateTo || !isValidDayKey(dateFrom) || !isValidDayKey(dateTo)) {
      throw new HttpError(400, 'dateFrom and dateTo (YYYY-MM-DD) are required')
    }
    const parsedRoomIds = roomIds
      ?.split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
    // summary = classic MTT analytics (MBR excluded); mbr = the isolated
    // Mystery Battle Royale block rendered under the main tournaments table.
    return {
      summary: tournamentSummary(dateFrom, dateTo, parsedRoomIds?.length ? parsedRoomIds : undefined, 'mtt'),
      mbr: tournamentMbrKpi(dateFrom, dateTo, parsedRoomIds?.length ? parsedRoomIds : undefined)
    }
  })

  app.get<{ Querystring: { dateFrom?: string; dateTo?: string } }>('/api/tournaments/reconcile-summary', async (req) => {
    const { dateFrom, dateTo } = req.query
    if (!dateFrom || !dateTo || !isValidDayKey(dateFrom) || !isValidDayKey(dateTo)) {
      throw new HttpError(400, 'dateFrom and dateTo (YYYY-MM-DD) are required')
    }
    return { flags: reconcileSummary(dateFrom, dateTo) }
  })

  app.get<{ Querystring: { roomId?: string; date?: string } }>('/api/tournaments', async (req) => {
    const { roomId, date } = req.query
    if (roomId === undefined || date === undefined || !isValidDayKey(date)) {
      throw new HttpError(400, 'roomId and date (YYYY-MM-DD) are required')
    }
    return { rows: listDayTournaments(parseId(roomId), date) }
  })

  /**
   * Stateless import: resolves the parser registered for the room's template
   * and runs it against the request payload (a GG reports .zip or pasted
   * PokerDom text). Returns the standardized rows plus an X-on-Y failure
   * counter. Nothing is written to the database here — persistence happens
   * only through the bulk endpoint on "Сохранить".
   */
  app.post<{ Params: { roomId: string } }>('/api/tournaments/import/:roomId', async (req) => {
    const room = getRoom(parseId(req.params.roomId))
    const parser = resolveTournamentParser(room)
    if (!parser) throw new HttpError(501, `Импорт турниров для рума «${room.name}» не настроен`)

    let input: TournamentParserInput
    if (parser.accepts === 'zip') {
      let fileBuf: Buffer | null = null
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (part.file.truncated) throw new HttpError(400, 'file: архив слишком большой (лимит 20 МБ)')
          const chunks: Buffer[] = []
          for await (const chunk of part.file) chunks.push(chunk as Buffer)
          fileBuf = Buffer.concat(chunks)
        }
      }
      if (fileBuf === null) throw new HttpError(400, 'file: ожидается .zip архив отчётов')
      input = { kind: 'zip', data: fileBuf }
    } else {
      const body = req.body as { text?: unknown }
      if (typeof body?.text !== 'string' || body.text.trim().length === 0) {
        throw new HttpError(400, 'text: текст отчёта обязателен')
      }
      input = { kind: 'text', data: body.text }
    }

    try {
      const dayStartHour = getDayStartHour()
      const result = parser.parse(input, { roomId: room.id, fallbackCurrency: room.tournamentCurrency, dayStartHour, today: dayKey() })
      return {
        tournaments: result.tournaments,
        successfullyParsed: result.successfullyParsed,
        failures: result.failures,
        totalSources: result.totalSources
      }
    } catch (e) {
      if (e instanceof TournamentParseError) throw new HttpError(400, e.message)
      throw e
    }
  })

  /**
   * One request = the whole popup save. `writeoffCasino` closes the modal day
   * with «Списать на казино» in the same transaction as the import itself, so
   * the day can never end up saved-but-open (the frontend used to follow the
   * save with a second `/writeoff-casino` call, and a failure in between left
   * the tournaments persisted and the day hanging in Транзакции). The returned
   * `reconcile` is the post-write-off day.
   */
  app.post<{
    Body: {
      roomId: number
      date: string
      lines: TournamentLineInput[]
      imports?: TournamentImportInput[]
      removedImportIds?: number[]
      writeoffCasino?: boolean
    }
  }>('/api/tournaments/bulk', async (req) => {
    const { roomId, date, lines, imports, removedImportIds, writeoffCasino } = req.body
    if (!Array.isArray(lines)) throw new HttpError(400, 'lines must be an array')
    if (imports !== undefined && !Array.isArray(imports)) throw new HttpError(400, 'imports must be an array')
    if (removedImportIds !== undefined && !Array.isArray(removedImportIds)) throw new HttpError(400, 'removedImportIds must be an array')
    if (writeoffCasino !== undefined && typeof writeoffCasino !== 'boolean') {
      throw new HttpError(400, 'writeoffCasino must be a boolean')
    }
    const dayId = parseId(roomId)
    const batch = saveDayBatch(dayId, date, lines, imports ?? [], removedImportIds ?? [], { writeoffCasino: writeoffCasino === true })
    const modalReconcile = batch.reconciles.find((r) => r.date === date) ?? reconcileDay(dayId, date)
    return { rows: batch.rows, reconcile: modalReconcile, days: batch.reconciles, reanchored: batch.reanchored }
  })

  app.post<{ Body: { roomId: number; date: string; lines: TournamentLineInput[]; imports?: TournamentImportInput[] } }>(
    '/api/tournaments/preview',
    async (req) => {
      const { roomId, date, lines, imports } = req.body
      if (!Array.isArray(lines)) throw new HttpError(400, 'lines must be an array')
      if (imports !== undefined && !Array.isArray(imports)) throw new HttpError(400, 'imports must be an array')
      return previewDayReconcile(parseId(roomId), date, lines, imports ?? [])
    }
  )

  app.get<{ Querystring: { roomId?: string; date?: string } }>('/api/tournaments/reconcile', async (req) => {
    const { roomId, date } = req.query
    if (roomId === undefined || date === undefined || !isValidDayKey(date)) {
      throw new HttpError(400, 'roomId and date (YYYY-MM-DD) are required')
    }
    return { reconcile: reconcileDay(parseId(roomId), date) }
  })

  app.post<{ Body: { roomId: number; tournamentId: number } }>('/api/tournaments/delete-import', async (req) => {
    const { roomId, tournamentId } = req.body
    const dayId = parseId(roomId)
    if (tournamentId === undefined) throw new HttpError(400, 'tournamentId is required')
    deleteImportedTournament(dayId, tournamentId)
    return { ok: true }
  })

  app.post<{ Body: { roomId: number; date: string } }>('/api/tournaments/adjust-balance', async (req) => {
    const { roomId, date } = req.body
    return { reconcile: adjustBalanceToTournaments(parseId(roomId), date) }
  })

  app.post<{ Body: { roomId: number; date: string } }>('/api/tournaments/writeoff-casino', async (req) => {
    const { roomId, date } = req.body
    return { reconcile: writeoffCasinoRemainder(parseId(roomId), date) }
  })
}