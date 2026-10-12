import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import AdmZip from 'adm-zip'
import { createApp } from '../src/app.js'
import type { FastifyInstance } from 'fastify'
import { initDb, resetDbForTests, setDbForTests, getDb } from '../src/db.js'
import { createRoom } from '../src/services/rooms.js'
import { setDayStartHour } from '../src/services/settings.js'

let app: FastifyInstance
let ggroom: number

function reportText(id: number, over: Partial<{ buyin: string; result: string; date: string; time: string; name: string }> = {}): string {
  return [
    `Tournament #${id}, ${over.name ?? 'Daily Turbo 5.50'}`,
    `Tournament started ${over.date ?? '2026/09/12'} ${over.time ?? '11:15:45'}`,
    `Buy-in: ${over.buyin ?? '$5.50'}`,
    `You received a total of ${over.result ?? '$8.40'}`,
    'You finished the tournament in 112th place.',
    '431 Players'
  ].join('\n')
}

function multipart(
  boundary: string,
  fields: Record<string, string>,
  files: { name: string; filename: string; contentType: string; data: Buffer }[]
): Buffer {
  const parts: Buffer[] = []
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  }
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.contentType}\r\n\r\n`
      )
    )
    parts.push(f.data)
    parts.push(Buffer.from('\r\n'))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return Buffer.concat(parts)
}

function makeZip(files: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip()
  for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(content))
  return zip.toBuffer()
}

beforeEach(async () => {
  setDbForTests(initDb(':memory:'))
  ggroom = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'CNY' }).id
  app = await createApp({ logger: false })
})

afterEach(async () => {
  await app.close()
  resetDbForTests()
})

async function postZip(roomId: number, zip: Buffer, boundary = 'test-boundary-1'): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/tournaments/import/${roomId}`,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: multipart(
      boundary,
      {},
      [{ name: 'file', filename: 'reports.zip', contentType: 'application/zip', data: zip }]
    )
  })
  return { statusCode: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> }
}

describe('POST /api/tournaments/import/:roomId (GG)', () => {
  it('parses a zip in memory and returns rows without writing to the DB', async () => {
    const zip = makeZip({ 'report1.txt': reportText(313_666_547), 'report2.txt': reportText(313_666_548, { result: '$0.' }) })
    const { statusCode, body } = await postZip(ggroom, zip)

    expect(statusCode).toBe(200)
    expect(body.totalSources).toBe(2)
    expect(body.successfullyParsed).toBe(2)
    expect(body.failures).toEqual([])
    const tournaments = body.tournaments as { tournamentId: number; date: string; buyin: number; result: number; currency: string }[]
    expect(tournaments).toHaveLength(2)
    expect(tournaments[0]).toMatchObject({ tournamentId: 313_666_547, date: '2026-09-12', buyin: 5_50, result: 8_40, currency: 'USD' })
    expect(tournaments[1]).toMatchObject({ result: 0, currency: 'USD' })
    // stateless: nothing persisted
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM tournaments').get() as { c: number }).toMatchObject({ c: 0 })
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM balance_entries').get() as { c: number }).toMatchObject({ c: 0 })
  })

  it('shifts a pre-dawn GG start to the previous logical day when day_start_hour is set', async () => {
    setDayStartHour(6)
    const zip = makeZip({ 'night.txt': reportText(700, { date: '2026/09/18', time: '04:00:00' }) })
    const { statusCode, body } = await postZip(ggroom, zip)

    expect(statusCode).toBe(200)
    const tournaments = body.tournaments as { tournamentId: number; date: string }[]
    expect(tournaments[0]).toMatchObject({ tournamentId: 700, date: '2026-09-17' })
  })

  it('keeps evening starts and the boundary hour itself on the same calendar day', async () => {
    setDayStartHour(6)
    const zip = makeZip({
      'evening.txt': reportText(701, { date: '2026/09/18', time: '23:30:00' }),
      'boundary.txt': reportText(702, { date: '2026/09/18', time: '06:00:00' })
    })
    const { body } = await postZip(ggroom, zip)
    const tournaments = body.tournaments as { tournamentId: number; date: string }[]
    expect(tournaments.map((t) => t.date)).toEqual(['2026-09-18', '2026-09-18'])
  })

  it('leaves pre-dawn dates untouched by default (day_start_hour = 0)', async () => {
    const zip = makeZip({ 'night.txt': reportText(703, { date: '2026/09/18', time: '04:00:00' }) })
    const { body } = await postZip(ggroom, zip)
    expect((body.tournaments as { date: string }[])[0]!.date).toBe('2026-09-18')
  })

  it('reports partial failures with an X-of-Y counter and file names', async () => {
    const zip = makeZip({ 'good.txt': reportText(111), 'bad.txt': 'not a report', 'other.txt': 'garbage' })
    const { statusCode, body } = await postZip(ggroom, zip)

    expect(statusCode).toBe(200)
    expect(body.totalSources).toBe(3)
    expect(body.successfullyParsed).toBe(1)
    expect(body.failures).toHaveLength(2)
    const files = (body.failures as { source: string; error: string }[]).map((f) => f.source).sort()
    expect(files).toEqual(['bad.txt', 'other.txt'])
    expect(body.tournaments).toHaveLength(1)
  })

  it('opens a zip of per-day zips (nested archives) and reads every .txt', async () => {
    const outer = makeZip({
      '2026-09-10.zip': makeZip({ 'a.txt': reportText(6001, { date: '2026/09/10' }) }),
      '2026-09-11.zip': makeZip({ 'b.txt': reportText(6002, { date: '2026/09/11', result: '$0.' }) }),
      'README.md': 'not a report'
    })
    const { statusCode, body } = await postZip(ggroom, outer)

    expect(statusCode).toBe(200)
    expect(body.totalSources).toBe(2)
    expect(body.successfullyParsed).toBe(2)
    expect(body.failures).toEqual([])
    const tournaments = body.tournaments as { tournamentId: number; date: string }[]
    expect(tournaments.map((t) => t.date)).toEqual(['2026-09-10', '2026-09-11'])
  })

  it('saves nested-archive tournaments across their own dates through /bulk', async () => {
    const outer = makeZip({
      'day10.zip': makeZip({ 'a.txt': reportText(6101, { date: '2026/09/10' }) }),
      'day11.zip': makeZip({ 'b.txt': reportText(6102, { date: '2026/09/11' }) })
    })
    const { body } = await postZip(ggroom, outer)

    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments/bulk',
      payload: { roomId: ggroom, date: '2026-09-11', lines: [], imports: body.tournaments }
    })
    expect(res.statusCode).toBe(200)
    const days = (JSON.parse(res.body) as { days: { date: string }[] }).days.map((d) => d.date).sort()
    expect(days).toEqual(['2026-09-10', '2026-09-11'])
    const rows = getDb().prepare('SELECT date FROM tournaments WHERE room_id = ? ORDER BY date').all(ggroom) as { date: string }[]
    expect(rows.map((r) => r.date)).toEqual(['2026-09-10', '2026-09-11'])
  })

  it('reports an unreadable nested archive without dropping the readable ones', async () => {
    const outer = makeZip({ 'good.zip': makeZip({ 'a.txt': reportText(6201) }), 'broken.zip': Buffer.from('not a zip at all') })
    const { statusCode, body } = await postZip(ggroom, outer)

    expect(statusCode).toBe(200)
    expect(body.totalSources).toBe(1)
    expect(body.successfullyParsed).toBe(1)
    const failures = body.failures as { source: string; error: string }[]
    expect(failures).toHaveLength(1)
    expect(failures[0]!.source).toBe('broken.zip')
  })

  it('stops at the nesting bound instead of recursing without end', async () => {
    let nested = makeZip({ 'deep.txt': reportText(6301) })
    for (let i = 0; i < 6; i += 1) nested = makeZip({ [`level${i}.zip`]: nested })
    const { statusCode, body } = await postZip(ggroom, nested)

    expect(statusCode).toBe(200)
    expect(body.successfullyParsed).toBe(0)
    expect((body.failures as unknown[]).length).toBeGreaterThan(0)
  })

  it('accepts a large multi-day /bulk body past the old 1 MiB Fastify default', async () => {
    const imports = Array.from({ length: 9000 }, (_, i) => ({
      tournamentId: 90000 + i,
      name: `Daily Turbo Turbo Turbo Turbo Turbo Turbo ${i}`,
      date: '2026-09-12',
      buyin: 5_50,
      result: 8_40,
      rank: 112,
      entrants: 431,
      currency: 'USD'
    }))
    const payload = { roomId: ggroom, date: '2026-09-12', lines: [], imports }
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(1024 * 1024)

    const res = await app.inject({ method: 'POST', url: '/api/tournaments/bulk', payload })
    expect(res.statusCode).toBe(200)
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM tournaments WHERE room_id = ?').get(ggroom) as { c: number }).toMatchObject({ c: 9000 })
  })

  it('falls back to the room tournament currency when the report has no symbol', async () => {
    const zip = makeZip({ 'report.txt': reportText(222, { buyin: '5.50', result: '8.40' }) })
    const { statusCode, body } = await postZip(ggroom, zip)
    expect(statusCode).toBe(200)
    const tournaments = body.tournaments as { currency: string; buyin: number }[]
    expect(tournaments[0]).toMatchObject({ currency: 'CNY', buyin: 5_50 })
  })

  it('rejects a non-zip payload with 400', async () => {
    const { statusCode, body } = await postZip(ggroom, Buffer.from('definitely not a zip archive'))
    expect(statusCode).toBe(400)
    expect((body.error as string).toLowerCase()).toContain('zip')
  })

  it('rejects an unknown room', async () => {
    const { statusCode } = await postZip(999, makeZip({ 'a.txt': reportText(1) }))
    expect(statusCode).toBe(404)
  })

  it('rejects a room without a registered parser with 501', async () => {
    const bybit = createRoom({ name: 'Bybit', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    const { statusCode } = await postZip(bybit, makeZip({ 'a.txt': reportText(1) }))
    expect(statusCode).toBe(501)
  })

  it('rejects a missing file field', async () => {
    const boundary = 'test-boundary-nofile'
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/import/${ggroom}`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart(boundary, {}, [])
    })
    expect(res.statusCode).toBe(400)
  })

  it('marks Mystery Battle Royale rows as is_mbr when saved through /bulk', async () => {
    const zip = makeZip({
      'mbr.txt': reportText(5001, { name: "Mystery Battle Royale $1, Hold'em No Limit", result: '$0' }),
      'mtt.txt': reportText(5002, { name: 'Daily Turbo 5.50' })
    })
    const { body } = await postZip(ggroom, zip)
    const tournaments = body.tournaments as Record<string, unknown>[]

    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments/bulk',
      payload: { roomId: ggroom, date: '2026-09-12', lines: [], imports: tournaments }
    })
    expect(res.statusCode).toBe(200)

    const rows = getDb()
      .prepare('SELECT name, is_mbr FROM tournaments WHERE room_id = ? ORDER BY tournament_id')
      .all(ggroom) as { name: string; is_mbr: number }[]
    expect(rows).toEqual([
      { name: "Mystery Battle Royale $1, Hold'em No Limit", is_mbr: 1 },
      { name: 'Daily Turbo 5.50', is_mbr: 0 }
    ])
  })
})

describe('POST /api/tournaments/delete-import', () => {
  it('deletes an imported row by tournamentId then recomputes balances', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/tournaments/bulk',
      payload: { roomId: ggroom, date: '2026-09-12', lines: [], imports: [{ tournamentId: 313_666_547, date: '2026-09-12', buyin: 5_50, result: 8_40, currency: 'USD', name: 'Daily Turbo 5.50', rank: 112, entrants: 431 }] }
    })
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM tournaments WHERE room_id = ?').get(ggroom) as { c: number }).toMatchObject({ c: 1 })

    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments/delete-import',
      payload: { roomId: ggroom, tournamentId: 313_666_547 }
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM tournaments WHERE room_id = ?').get(ggroom) as { c: number }).toMatchObject({ c: 0 })
  })

  it('400s on a non-integer tournamentId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments/delete-import',
      payload: { roomId: ggroom, tournamentId: 'abc' }
    })
    expect(res.statusCode).toBe(400)
  })

  it('404s when the imported row is unknown', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments/delete-import',
      payload: { roomId: ggroom, tournamentId: 999 }
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/tournaments/import/:roomId (PokerDom)', () => {
  const POKERDOM_REPORT = [
    '16 сент., 14:00',
    'Супер Прогрессивный Нокаут 30 000 р.',
    'БЛ Холдем',
    '500 р.',
    'Вхождение #1',
    '500 р.\t13\t1 288,05 р.',
    '',
    '16 сент., 15:00',
    'Прогрессивный Нокаут 20 000 р.',
    'БЛ Холдем',
    '250 р.',
    'Вхождение #1',
    '250 р.\t75\t50 р.',
    '',
    '16 сент., 18:30',
    'Мультибаунти 20 000 р.',
    'БЛ Холдем',
    '250 р.',
    '250 р.\t63\t0 р.'
  ].join('\n')

  let pdom: number
  beforeEach(() => {
    pdom = createRoom({ name: 'PokerDom', cashCurrency: 'RUB', tournamentCurrency: 'RUB' }).id
  })

  async function postPokerdom(text: string, roomId: number = pdom) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/import/${roomId}`,
      payload: { text }
    })
    return { statusCode: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> }
  }

  it('parses pasted text statelessly and returns RUB rows', async () => {
    const { statusCode, body } = await postPokerdom(POKERDOM_REPORT)
    expect(statusCode).toBe(200)
    expect(body.successfullyParsed).toBe(3)
    expect(body.failures).toEqual([])
    const tournaments = body.tournaments as { tournamentId: number; name: string; date: string; buyin: number; result: number; rank: number | null; currency: string }[]
    expect(tournaments).toHaveLength(3)
    expect(tournaments[0]).toMatchObject({ date: '2026-09-16', name: 'Супер Прогрессивный Нокаут 30 000 р.', buyin: 500_00, result: 128_805, rank: 13, currency: 'RUB' })
    expect(tournaments[2]).toMatchObject({ result: 0, rank: 63, buyin: 250_00 })
    expect(typeof tournaments[0]!.tournamentId).toBe('number')
    // stateless
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM tournaments').get() as { c: number }).toMatchObject({ c: 0 })
  })

  it('produces stable IDs for re-pasted text (dedup by hash)', async () => {
    const a = await postPokerdom(POKERDOM_REPORT)
    const b = await postPokerdom(POKERDOM_REPORT)
    const idsA = (a.body.tournaments as { tournamentId: number }[]).map((t) => t.tournamentId)
    const idsB = (b.body.tournaments as { tournamentId: number }[]).map((t) => t.tournamentId)
    expect(idsA).toEqual(idsB)
  })

  it('saves through /bulk and dedups on re-save', async () => {
    await postPokerdom(POKERDOM_REPORT)
    const parse = await postPokerdom(POKERDOM_REPORT)
    await app.inject({
      method: 'POST',
      url: '/api/tournaments/bulk',
      payload: { roomId: pdom, date: '2026-09-16', lines: [], imports: parse.body.tournaments }
    })
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM tournaments WHERE room_id = ?').get(pdom) as { c: number }).toMatchObject({ c: 3 })
    // re-saving the same parsed rows is an upsert — count stays 3
    await app.inject({
      method: 'POST',
      url: '/api/tournaments/bulk',
      payload: { roomId: pdom, date: '2026-09-16', lines: [], imports: parse.body.tournaments }
    })
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM tournaments WHERE room_id = ?').get(pdom) as { c: number }).toMatchObject({ c: 3 })
  })

  it('400s on empty text', async () => {
    const { statusCode, body } = await postPokerdom('   ')
    expect(statusCode).toBe(400)
    expect((body.error as string).toLowerCase()).toContain('обязател')
  })

  it('404s on unknown room', async () => {
    const { statusCode } = await postPokerdom(POKERDOM_REPORT, 999)
    expect(statusCode).toBe(404)
  })

  it('converts text-imported rows to manual lines via /bulk removedImportIds', async () => {
    const parse = await postPokerdom(POKERDOM_REPORT)
    const ids = (parse.body.tournaments as { tournamentId: number }[]).map((t) => t.tournamentId)
    await app.inject({
      method: 'POST',
      url: '/api/tournaments/bulk',
      payload: { roomId: pdom, date: '2026-09-16', lines: [], imports: parse.body.tournaments }
    })
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM tournaments WHERE room_id = ?').get(pdom) as { c: number }).toMatchObject({ c: 3 })

    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments/bulk',
      payload: {
        roomId: pdom,
        date: '2026-09-16',
        lines: [
          { buyin: 500_00, result: 128_805, currency: 'RUB' },
          { buyin: 250_00, result: 50_00, currency: 'RUB' },
          { buyin: 250_00, result: 0, currency: 'RUB' }
        ],
        imports: [],
        removedImportIds: ids
      }
    })
    expect(res.statusCode).toBe(200)
    const rows = getDb()
      .prepare('SELECT buyin, result, tournament_id FROM tournaments WHERE room_id = ? ORDER BY id')
      .all(pdom) as { buyin: number; result: number; tournament_id: number | null }[]
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.tournament_id === null)).toBe(true)
    expect(rows[1]).toMatchObject({ buyin: 250_00, result: 50_00 })
  })

  it('400s when removedImportIds is not an array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments/bulk',
      payload: { roomId: pdom, date: '2026-09-16', lines: [], imports: [], removedImportIds: 'abc' }
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/tournaments/summary', () => {
  it('returns KPI and aggregated groups for a range', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/tournaments/bulk',
      payload: { roomId: ggroom, date: '2026-09-12', lines: [{ buyin: 5_50, result: 8_40, currency: 'USD' }], imports: [] }
    })

    const res = await app.inject({ method: 'GET', url: '/api/tournaments/summary?dateFrom=2026-09-12&dateTo=2026-09-12' })
    const body = JSON.parse(res.body) as { summary: { count: number; groups: { label: string }[] } }
    expect(res.statusCode).toBe(200)
    expect(body.summary.count).toBe(1)
    expect(body.summary.groups[0].label).toBe('Турниры за 5.50 USD')
  })

  it('400s when the range is missing or inverted', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/tournaments/summary' })
    expect(missing.statusCode).toBe(400)

    const inverted = await app.inject({ method: 'GET', url: '/api/tournaments/summary?dateFrom=2026-09-12&dateTo=2026-09-10' })
    expect(inverted.statusCode).toBe(400)
  })

  it('honours the roomIds filter', async () => {
    const other = createRoom({ name: 'Bybit', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    await app.inject({
      method: 'POST',
      url: '/api/tournaments/bulk',
      payload: { roomId: ggroom, date: '2026-09-12', lines: [{ buyin: 1_00, result: 2_00, currency: 'USD' }], imports: [] }
    })
    await app.inject({
      method: 'POST',
      url: '/api/tournaments/bulk',
      payload: { roomId: other, date: '2026-09-12', lines: [{ buyin: 1_00, result: 0, currency: 'USD' }], imports: [] }
    })

    const all = await app.inject({ method: 'GET', url: '/api/tournaments/summary?dateFrom=2026-09-12&dateTo=2026-09-12' })
    expect((JSON.parse(all.body) as { summary: { count: number } }).summary.count).toBe(2)

    const filtered = await app.inject({
      method: 'GET',
      url: `/api/tournaments/summary?dateFrom=2026-09-12&dateTo=2026-09-12&roomIds=${other}`
    })
    expect((JSON.parse(filtered.body) as { summary: { count: number } }).summary.count).toBe(1)
  })

  it('returns an isolated MBR KPI block alongside the MTT summary', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/tournaments/bulk',
      payload: {
        roomId: ggroom,
        date: '2026-09-16',
        lines: [],
        imports: [
          { tournamentId: 9001, name: "Mystery Battle Royale $1, Hold'em No Limit", date: '2026-09-16', buyin: 1_00, result: 5_50, rank: null, entrants: null, currency: 'USD' },
          { tournamentId: 9002, name: 'Daily Turbo 5.50', date: '2026-09-16', buyin: 5_50, result: 11_00, rank: null, entrants: null, currency: 'USD' }
        ]
      }
    })

    const res = await app.inject({ method: 'GET', url: '/api/tournaments/summary?dateFrom=2026-09-16&dateTo=2026-09-16' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as {
      summary: { count: number; groups: { label: string }[] }
      mbr: {
        count: number
        totalBuyinUsd: number
        totalProfitUsd: number
        roiPercent: number | null
        avgPosition: number | null
        blank: string | null
        breakdown: { buyin: number; count: number; profit: number; roi: number | null; avgPosition: number | null }[]
      }
    }
    // MBR is out of the MTT table ...
    expect(body.summary.count).toBe(1)
    expect(body.summary.groups.map((g) => g.label)).toEqual(['Daily Turbo 5.50'])
    // ... and lives in its own block with money-math intact
    expect(body.mbr).toEqual({
      count: 1,
      totalBuyinUsd: 1_00,
      totalProfitUsd: 4_50,
      roiPercent: 450,
      avgPosition: null,
      blank: null,
      breakdown: [{ buyin: 1_00, count: 1, profit: 4_50, roi: 450, avgPosition: null }]
    })
  })
})