// Mirrors how `Reorder.Group` itself permutes a list: the given ids keep the
// slots the listed items occupied before, only their relative order changes.
// That keeps unlisted items untouched (archived habits, settled goals), and any
// mismatch — duplicate or unknown id — falls back to the untouched list instead
// of dropping an item from the screen.
export function applyItemOrder<T extends { id: number }>(items: T[], ids: number[]): T[] {
  const wanted = new Set(ids)
  const slots: number[] = []
  items.forEach((item, index) => {
    if (wanted.has(item.id)) slots.push(index)
  })

  const byId = new Map(items.map((item) => [item.id, item]))
  const ordered = ids.map((id) => byId.get(id))
  if (ordered.length !== slots.length || ordered.some((item) => item === undefined)) return items

  const next = [...items]
  slots.forEach((slot, index) => {
    const item = ordered[index]
    if (item) next[slot] = item
  })
  return next
}

export function moveItemId(ids: number[], id: number, direction: -1 | 1): number[] {
  const from = ids.indexOf(id)
  const to = from + direction
  const moved = ids[from]
  const swapped = ids[to]
  if (moved === undefined || swapped === undefined) return ids
  const next = [...ids]
  next[from] = swapped
  next[to] = moved
  return next
}
