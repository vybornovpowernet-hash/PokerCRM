import type { FastifyInstance } from 'fastify'
import { createRoom, deleteRoom, listRooms, updateRoom } from '../services/rooms.js'
import { RATE_SOURCE_LABEL, ROOM_TEMPLATES } from '../services/templates.js'
import { HttpError } from '../lib/errors.js'

export async function roomsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/rooms', async () => ({ rooms: listRooms() }))

  app.get('/api/rooms/templates', async () => ({
    templates: ROOM_TEMPLATES.map((t) => ({
      key: t.key,
      label: t.label,
      insertName: t.insertName,
      rateSource: t.rateSource,
      rateSourceLabel: t.rateSource ? RATE_SOURCE_LABEL[t.rateSource] : null
    }))
  }))

  app.post<{
    Body: { name: string; cashCurrency: string; tournamentCurrency: string; rateSource?: string | null; color?: string; isWallet?: boolean }
  }>(
    '/api/rooms',
    async (req) => {
      const room = createRoom(req.body)
      return { room }
    }
  )

  app.put<{
    Params: { id: string }
    Body: { name?: string; cashCurrency?: string; tournamentCurrency?: string; rateSource?: string | null; color?: string; isWallet?: boolean }
  }>(
    '/api/rooms/:id',
    async (req) => {
      const id = parseId(req.params.id)
      return { room: updateRoom(id, req.body) }
    }
  )

  app.delete<{ Params: { id: string } }>('/api/rooms/:id', async (req) => {
    const id = parseId(req.params.id)
    deleteRoom(id)
    return { ok: true }
  })
}

function parseId(raw: string): number {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id')
  return id
}