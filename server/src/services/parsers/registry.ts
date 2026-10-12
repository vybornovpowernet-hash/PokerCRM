/**
 * Registry of tournament parsers, keyed by the room template alias.
 * Routes resolve the parser for a room by its name template (`detectRoomTemplate`);
 * unknown templates (e.g. RedStar or Bybit) simply have no parser → the route
 * answers 501. Adding a new room format = registering one more entry here.
 */

import type { Room } from '../rooms.js'
import { detectRoomTemplate } from '../templates.js'
import type { ITournamentParser } from './types.js'
import { ggParser } from '../ggimport.js'
import { pokerdomParser } from '../pokerdomimport.js'

const parserRegistry: Record<string, ITournamentParser> = {
  gg: ggParser,
  pokerdom: pokerdomParser
}

/** Returns the parser registered for the room's template, or null if none. */
export function resolveTournamentParser(room: Room): ITournamentParser | null {
  const template = detectRoomTemplate(room.name)
  if (!template) return null
  return parserRegistry[template.key] ?? null
}