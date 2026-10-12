import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initDb, resetDbForTests, setDbForTests, getDb } from '../src/db.js'
import { HttpError } from '../src/lib/errors.js'
import { dayKey } from '../src/lib/date.js'
import { archiveHabit, createHabit, listHabitHistory, listHabits, reorderHabits, restoreHabit, setHabitLog, updateHabit } from '../src/services/habits/service.js'

beforeEach(() => {
  setDbForTests(initDb(':memory:'))
})

afterEach(() => {
  resetDbForTests()
})

const now = () => new Date()

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

describe('habits service', () => {
  it('validates the habit name', () => {
    for (const bad of [undefined, 5, '', '   ', 'x'.repeat(101)]) {
      let caught: unknown
      try {
        createHabit(bad)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(HttpError)
      expect((caught as HttpError).status).toBe(400)
    }
  })

  it('creates a habit, trims the name and lists it in its month', () => {
    const habit = createHabit('  Медитация  ')
    expect(habit).toMatchObject({ name: 'Медитация', archivedAt: null })
    expect(typeof habit.id).toBe('number')

    const [listed] = listHabits(undefined)
    expect(listed).toMatchObject({ id: habit.id, name: 'Медитация', archivedAt: null })
    expect(typeof listed.id).toBe('number')
    expect(listed.logs).toEqual({})
  })

  it('validates the month parameter', () => {
    createHabit('Медитация')
    for (const bad of ['2026-13', '2026-1', 'nope', '2026/09', 7]) {
      let caught: unknown
      try {
        listHabits(bad)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(HttpError)
      expect((caught as HttpError).status).toBe(400)
    }
    expect(listHabits('')).toHaveLength(1)
  })

  it('sets done and missed statuses on a day and clears them with null', () => {
    const habit = createHabit('Медитация')
    const today = dayKey()

    expect(setHabitLog(habit.id, today, 'done')).toEqual({ date: today, status: 'done' })
    expect(setHabitLog(habit.id, today, 'missed')).toEqual({ date: today, status: 'missed' })
    expect(setHabitLog(habit.id, today, null)).toBeNull()

    const [listed] = listHabits(undefined)
    expect(listed.logs).toEqual({})

    expect(setHabitLog(habit.id, today, 'done'))
    const again = listHabits(undefined)
    expect(again[0].logs).toEqual({ [today]: 'done' })
  })

  it('validates log dates, statuses and habit existence', () => {
    const habit = createHabit('Спорт')
    expect(() => setHabitLog(habit.id, 'not-a-date', 'done')).toThrow(HttpError)
    expect(() => setHabitLog(habit.id, '2026-13-40', 'done')).toThrow(HttpError)
    expect(() => setHabitLog(habit.id, dayKey(), 'maybe')).toThrow(HttpError)
    expect(() => setHabitLog(habit.id, dayKey(), 1)).toThrow(HttpError)
    expect(() => setHabitLog(9999, dayKey(), 'done')).toThrow(HttpError)
  })

  it('returns logs only for the requested month', () => {
    const habit = createHabit('Чтение')
    const prev = addMonths(monthKey(now()), -1)
    const prevDay = `${prev}-15`
    getDb().prepare('UPDATE habits SET created_at = ? WHERE id = ?').run(`${prev}-01 10:00:00`, habit.id)
    setHabitLog(habit.id, prevDay, 'done')

    const inPrev = listHabits(prev)
    expect(inPrev).toHaveLength(1)
    expect(inPrev[0].logs).toEqual({ [prevDay]: 'done' })

    const cur = listHabits(monthKey(now()))
    expect(cur).toHaveLength(1)
    expect(cur[0].logs).toEqual({})
  })

  it('archives a habit as a soft delete: hidden from every month, logs preserved', () => {
    const habit = createHabit('Медитация')
    const today = dayKey(now())
    setHabitLog(habit.id, today, 'done')

    const archived = archiveHabit(habit.id)
    expect(archived.archivedAt).toBe(today)
    expect(archiveHabit(habit.id).archivedAt).toBe(today)
    expect(() => archiveHabit(9999)).toThrow(HttpError)

    const currentMonth = monthKey(now())
    expect(listHabits(currentMonth)).toHaveLength(0)

    const prevMonth = addMonths(currentMonth, -1)
    expect(listHabits(prevMonth)).toHaveLength(0)
  })

  it('hides an archived habit from every month while keeping its logs in history', () => {
    const habit = createHabit('Медитация')
    setHabitLog(habit.id, '2000-01-15', 'done')
    archiveHabit(habit.id)
    getDb().prepare('UPDATE habits SET archived_at = ? WHERE id = ?').run('2000-02-05', habit.id)

    expect(listHabits('2000-01')).toEqual([])
    expect(listHabits('2000-02')).toEqual([])
    expect(listHabits(monthKey(now()))).toEqual([])

    const [item] = listHabitHistory()
    expect(item.logs).toEqual({ '2000-01-15': 'done' })
  })

  it('does not duplicate a re-created habit on past months', () => {
    const first = createHabit('Медитация')
    setHabitLog(first.id, '2000-01-15', 'done')
    archiveHabit(first.id)

    const second = createHabit('Медитация')
    setHabitLog(second.id, '2000-01-16', 'done')

    const january = listHabits('2000-01')
    expect(january.map((h) => h.id)).toEqual([second.id])
    expect(january[0].logs).toEqual({ '2000-01-16': 'done' })
  })

  it('defaults and validates the habit color', () => {
    expect(createHabit('Спорт').color).toBe('#f1f5f9')
    expect(createHabit('Спорт', '#A5B4FC').color).toBe('#a5b4fc')
    expect(createHabit('Спорт', '').color).toBe('#f1f5f9')

    for (const bad of ['red', '#fff', '#gggggg', 42, {}]) {
      let caught: unknown
      try {
        createHabit('Спорт', bad)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(HttpError)
      expect((caught as HttpError).status).toBe(400)
    }
  })

  it('counts the name in code points so emoji do not eat the budget', () => {
    const name = '🧘 ' + 'x'.repeat(98)
    const habit = createHabit(name)
    expect(habit.name).toBe(name)

    expect(() => createHabit('👍'.repeat(101))).toThrow(HttpError)
    expect(createHabit('👍'.repeat(100)).name).toBe('👍'.repeat(100))
  })

  it('renames and recolors a habit', () => {
    const habit = createHabit('Медитация', '#bbf7d0')
    const updated = updateHabit(habit.id, { name: '  🧘 Медитация  ', color: '#c4b5fd' })
    expect(updated).toMatchObject({ id: habit.id, name: '🧘 Медитация', color: '#c4b5fd' })

    const partial = updateHabit(habit.id, { color: '#fda4af' })
    expect(partial).toMatchObject({ name: '🧘 Медитация', color: '#fda4af' })

    expect(() => updateHabit(habit.id, { name: '' })).toThrow(HttpError)
    expect(() => updateHabit(habit.id, { color: 'nope' })).toThrow(HttpError)
    expect(() => updateHabit(9999, { name: 'X' })).toThrow(HttpError)
  })

  it('keeps a manual order: a new habit lands on top, reorder puts the listed ids first', () => {
    const first = createHabit('Первая')
    const second = createHabit('Вторая')
    const third = createHabit('Третья')
    const order = () => listHabits(undefined).map((h) => h.id)
    expect(order()).toEqual([third.id, second.id, first.id])

    expect(reorderHabits([first.id, third.id]).map((h) => h.id)).toEqual([first.id, third.id, second.id])
    expect(order()).toEqual([first.id, third.id, second.id])

    expect(reorderHabits([second.id]).map((h) => h.id)).toEqual([second.id, first.id, third.id])
    expect(order()).toEqual([second.id, first.id, third.id])
  })

  it('rejects a reorder payload that is not a list of known habit ids', () => {
    const habit = createHabit('Первая')
    for (const bad of [undefined, null, 'nope', 5, {}]) {
      expect(() => reorderHabits(bad)).toThrow(HttpError)
    }
    for (const bad of [[0], [-1], [1.5], ['x'], [habit.id, habit.id], [9999]]) {
      expect(() => reorderHabits(bad)).toThrow(HttpError)
    }
    expect(reorderHabits([habit.id])).toHaveLength(1)
  })

  it('restores an archived habit to the position it used to hold', () => {
    const a = createHabit('A')
    const b = createHabit('B')
    const c = createHabit('C')
    reorderHabits([a.id, b.id, c.id])
    archiveHabit(b.id)

    expect(listHabits(undefined).map((h) => h.id)).toEqual([a.id, c.id])
    expect(() => reorderHabits([b.id])).toThrow(HttpError)

    restoreHabit(b.id)
    expect(listHabits(undefined).map((h) => h.id)).toEqual([a.id, b.id, c.id])
  })

  it('lists archived habits with stats and restores one', () => {
    const kept = createHabit('Чтение')
    const gone = createHabit('Бег', '#fdba74')
    setHabitLog(gone.id, '2020-01-01', 'done')
    setHabitLog(gone.id, '2020-01-02', 'done')
    setHabitLog(gone.id, '2020-01-03', 'missed')
    setHabitLog(gone.id, '2020-01-04', 'done')
    archiveHabit(gone.id)
    getDb().prepare('UPDATE habits SET archived_at = ? WHERE id = ?').run('2020-02-01', gone.id)

    const history = listHabitHistory()
    expect(history.map((h) => h.id)).toEqual([gone.id])
    expect(history[0]).toMatchObject({ name: 'Бег', color: '#fdba74', archivedAt: '2020-02-01' })
    expect(history[0].logs).toEqual({ '2020-01-01': 'done', '2020-01-02': 'done', '2020-01-03': 'missed', '2020-01-04': 'done' })
    expect(history[0].stats).toEqual({
      done: 3,
      partial: 0,
      missed: 1,
      tracked: 4,
      completionRate: 75,
      firstDate: '2020-01-01',
      lastDate: '2020-01-04',
      longestDoneStreak: 2
    })

    expect(restoreHabit(gone.id).archivedAt).toBeNull()
    expect(restoreHabit(gone.id).archivedAt).toBeNull()
    expect(listHabitHistory()).toEqual([])
    expect(listHabits(monthKey(now())).map((h) => h.id).sort()).toEqual([kept.id, gone.id].sort())
  })

  it('accepts the partial status and counts it as success in the completion rate', () => {
    const habit = createHabit('Спорт')
    expect(setHabitLog(habit.id, '2020-01-01', 'partial')).toEqual({ date: '2020-01-01', status: 'partial' })
    setHabitLog(habit.id, '2020-01-02', 'done')
    setHabitLog(habit.id, '2020-01-03', 'missed')
    setHabitLog(habit.id, '2020-01-04', 'partial')
    archiveHabit(habit.id)
    getDb().prepare('UPDATE habits SET archived_at = ? WHERE id = ?').run('2020-02-01', habit.id)

    const [item] = listHabitHistory()
    expect(item.logs).toEqual({ '2020-01-01': 'partial', '2020-01-02': 'done', '2020-01-03': 'missed', '2020-01-04': 'partial' })
    // done + partial are successes: 3 of 4 → 75%; only the strict `done` keeps the streak
    expect(item.stats).toMatchObject({ done: 1, partial: 2, missed: 1, tracked: 4, completionRate: 75, longestDoneStreak: 1 })
  })
})