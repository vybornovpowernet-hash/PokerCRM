export type RateSource = 'pokerdom' | 'er-api'

export interface RoomTemplate {
  key: 'pokerdom' | 'redstar' | 'gg'
  label: string
  insertName: string
  rateSource: RateSource | null
  aliases: string[]
}

export const ROOM_TEMPLATES: RoomTemplate[] = [
  { key: 'pokerdom', label: 'PokerDom', insertName: 'PokerDom', rateSource: 'pokerdom', aliases: ['pokerdom', 'покердом', 'покер дом', 'покер'] },
  { key: 'redstar', label: 'RedStar', insertName: 'RedStar', rateSource: 'er-api', aliases: ['redstar', 'red star', 'редстар', 'ред стар'] },
  { key: 'gg', label: 'GG', insertName: 'GG', rateSource: 'er-api', aliases: ['gg', 'ggpoker', 'джиджи', 'джи джи', 'джиджи покер'] }
]

export const RATE_SOURCE_LABEL: Record<RateSource, string> = {
  pokerdom: 'Курс PokerDom (USD→RUB)',
  'er-api': 'Курс EUR/USD и CNY/USD (er-api)'
}

export function normalizeRoomName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-zа-яё]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function detectRoomTemplate(name: string): RoomTemplate | null {
  const n = normalizeRoomName(name)
  if (n.length === 0) return null
  const full = ROOM_TEMPLATES.map((t) => ({ template: t, aliases: t.aliases.map(normalizeRoomName) }))
  for (const { template, aliases } of full) {
    if (aliases.includes(n)) return template
  }
  if (n.length < 3) return null
  for (const { template, aliases } of full) {
    for (const alias of aliases) {
      if (n.includes(alias) || alias.includes(n)) return template
    }
  }
  return null
}