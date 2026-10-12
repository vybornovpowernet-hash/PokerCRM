/**
 * Client-side mirror of server/src/services/templates.ts#detectRoomTemplate.
 * Rooms are bound to a template at creation via RoomNameCombobox (the template's
 * insertName is stored as the room name), so the name is the canonical binding.
 */

export type RoomTemplateKey = 'pokerdom' | 'redstar' | 'gg'

const ROOM_TEMPLATE_ALIASES: Record<RoomTemplateKey, string[]> = {
  pokerdom: ['pokerdom', 'покердом', 'покер дом', 'покер'],
  redstar: ['redstar', 'red star', 'редстар', 'ред стар'],
  gg: ['gg', 'ggpoker', 'джиджи', 'джи джи', 'джиджи покер']
}

function normalizeRoomName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-zа-яё]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function detectRoomTemplate(name: string): RoomTemplateKey | null {
  const n = normalizeRoomName(name)
  if (n.length === 0) return null
  const entries = Object.entries(ROOM_TEMPLATE_ALIASES) as [RoomTemplateKey, string[]][]
  const normalized = entries.map(([key, aliases]) => ({ key, aliases: aliases.map(normalizeRoomName) }))
  for (const { key, aliases } of normalized) {
    if (aliases.includes(n)) return key
  }
  if (n.length < 3) return null
  for (const { key, aliases } of normalized) {
    for (const alias of aliases) {
      if (n.includes(alias) || alias.includes(n)) return key
    }
  }
  return null
}