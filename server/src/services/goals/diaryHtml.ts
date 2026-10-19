const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'mark', 'p', 'br', 'span'])

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/
const RGB_COLOR_RE = /^rgba?\(\s*(\d{1,3})\s*(?:,|\s)\s*(\d{1,3})\s*(?:,|\s)\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/

const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 20

function normalizeColor(raw: string): string | null {
  const value = raw.trim().toLowerCase()
  if (HEX_COLOR_RE.test(value)) return value
  const match = RGB_COLOR_RE.exec(value)
  if (!match) return null
  const channels = [Number(match[1] ?? 0), Number(match[2] ?? 0), Number(match[3] ?? 0)]
  if (channels.some((n) => n > 255)) return null
  if (match[4] !== undefined && Number.parseFloat(match[4]) !== 1) return null
  return `#${channels.map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  nbsp: ' '
}

function sanitizeStyle(name: string, raw: string): string | null {
  const kept: string[] = []
  for (const declaration of raw.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon === -1) continue
    const prop = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).trim()
    if (name === 'span' && prop === 'font-size') {
      const sizeMatch = /^(\d+)px$/.exec(value)
      if (!sizeMatch) continue
      const size = Number(sizeMatch[1] ?? 0)
      if (size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE) kept.push(`font-size: ${size}px`)
    } else if (name === 'mark' && prop === 'background-color') {
      const color = normalizeColor(value)
      if (color) kept.push(`background-color: ${color}`)
    }
  }
  return kept.length > 0 ? kept.join('; ') : null
}

function sanitizeAttrs(name: string, raw: string): string {
  const kept: string[] = []
  const attrRe = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let match: RegExpExecArray | null
  while ((match = attrRe.exec(raw)) !== null) {
    const attr = (match[1] ?? '').toLowerCase()
    const value = (match[2] ?? match[3] ?? '').trim()
    if (attr === 'style') {
      const style = sanitizeStyle(name, value)
      if (style) kept.push(`style="${style}"`)
    } else if (attr === 'data-color' && name === 'mark') {
      const color = normalizeColor(value)
      if (color) kept.push(`data-color="${color}"`)
    }
  }
  return kept.length > 0 ? ` ${kept.join(' ')}` : ''
}

export function sanitizeDiaryHtml(html: string): string {
  // A `<` with no closing `>` anywhere after it is an unterminated tag: the
  // regex below would never see it, so it would reach the DOM verbatim.
  const closed = html.replace(/<[^>]*$/g, '')
  return closed.replace(/<[^>]*>/g, (tag) => {
    const match = /^<\s*(\/?)\s*([a-z][a-z0-9]*)/i.exec(tag)
    if (!match) return ''
    const name = (match[2] ?? '').toLowerCase()
    if (!ALLOWED_TAGS.has(name)) return ''
    if (match[1]) return `</${name}>`
    return `<${name}${sanitizeAttrs(name, tag.slice(match[0].length))}>`
  })
}

export function diaryTextLength(html: string): number {
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|nbsp);/gi, (entity, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? entity)
  return [...text].length
}