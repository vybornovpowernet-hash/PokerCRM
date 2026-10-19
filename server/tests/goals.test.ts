import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { initDb, resetDbForTests, setDbForTests, getDb } from '../src/db.js'
import { createRoom } from '../src/services/rooms.js'
import { HttpError } from '../src/lib/errors.js'
import { dayKey } from '../src/lib/date.js'
import { acknowledgeGoal, addUserEntry, closeGoal, createGoal, deleteUserEntry, listGoals, reorderGoals, setChecklist, updateUserEntry } from '../src/services/goals/service.js'
import { sanitizeDiaryHtml } from '../src/services/goals/diaryHtml.js'
import type { ChecklistItem, GoalEntry, GoalWithProgress } from '../src/services/goals/types.js'
import { DIARY_DIR, saveDiaryImage } from '../src/services/uploads.js'

beforeEach(() => {
  setDbForTests(initDb(':memory:'))
})

afterEach(() => {
  resetDbForTests()
})

function insertBalance(roomId: number, date: string, amount: number, currency: string): void {
  getDb()
    .prepare("INSERT INTO balance_entries (room_id, date, amount, currency, source) VALUES (?, ?, ?, ?, 'manual')")
    .run(roomId, date, amount, currency)
}

function insertTournament(roomId: number, date: string, buyin: number, result: number, currency: string): void {
  getDb().prepare('INSERT INTO tournaments (room_id, date, buyin, result, currency) VALUES (?, ?, ?, ?, ?)').run(roomId, date, buyin, result, currency)
}

function entriesOf(g: GoalWithProgress): GoalEntry[] {
  return g.entries
}

describe('goals service', () => {
  it('validates createGoal input', () => {
    expect(() => createGoal({ metric: 'nope', targetUnits: 10 })).toThrow(HttpError)
    expect(() => createGoal({ metric: 'distance', targetUnits: 0 })).toThrow(HttpError)
    expect(() => createGoal({ metric: 'distance', targetUnits: 1.5 })).toThrow(HttpError)
    expect(() => createGoal({ metric: 'distance', targetUnits: 10, deadline: 'not-a-date' })).toThrow(HttpError)
    expect(() => createGoal({ metric: 'distance', targetUnits: 10, deadline: '2000-01-01' })).toThrow(HttpError)
    const goal = createGoal({ metric: 'distance', targetUnits: 10, deadline: dayKey() })
    expect(goal.status).toBe('active')
  })

  it('computes distance progress from the tournament count', () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'CNY' }).id
    const created = createGoal({ metric: 'distance', targetUnits: 100 })
    expect(created.progress).toMatchObject({ currentUnits: 0, percent: 0, blank: false })

    for (let i = 0; i < 30; i++) insertTournament(room, `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, 550, 0, 'USD')

    const [goal] = listGoals()
    expect(goal.progress).toMatchObject({ currentUnits: 30, percent: 30, blank: false })
    expect(entriesOf(goal)).toEqual([])
  })

  it('excludes Mystery Battle Royale rows from the distance metric', () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'CNY' }).id
    createGoal({ metric: 'distance', targetUnits: 100 })
    insertTournament(room, '2026-09-16', 550, 0, 'USD')
    getDb()
      .prepare("INSERT INTO tournaments (room_id, date, buyin, result, currency, name, is_mbr) VALUES (?, ?, ?, ?, ?, ?, 1)")
      .run(room, '2026-09-16', 100, 0, 'USD', "Mystery Battle Royale $1, Hold'em No Limit")

    const [goal] = listGoals()
    expect(goal.progress).toMatchObject({ currentUnits: 1, percent: 1, blank: false })
  })

  it('emits 50/75 milestone entries exactly once as progress climbs', () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'CNY' }).id
    const created = createGoal({ metric: 'distance', targetUnits: 100 })
    for (let i = 0; i < 80; i++) insertTournament(room, `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, 550, 0, 'USD')

    const [goal] = listGoals()
    expect(goal.progress).toMatchObject({ currentUnits: 80, percent: 80 })
    const milestones = entriesOf(goal)
      .filter((e) => e.kind === 'system' && e.milestone !== null)
      .map((e) => e.milestone)
      .sort()
    expect(milestones).toEqual([50, 75])

    const [goalAgain] = listGoals()
    expect(entriesOf(goalAgain).filter((e) => e.milestone !== null)).toHaveLength(2)
  })

  it('auto-achieves when the target is reached and records the 100 milestone', () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'CNY' }).id
    createGoal({ metric: 'distance', targetUnits: 10 })
    for (let i = 0; i < 10; i++) insertTournament(room, `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, 550, 0, 'USD')

    const [goal] = listGoals()
    expect(goal.status).toBe('achieved')
    expect(goal.achievedAt).not.toBeNull()
    const milestones = entriesOf(goal)
      .filter((e) => e.kind === 'system' && e.milestone !== null)
      .map((e) => e.milestone)
      .sort()
    expect(milestones).toEqual([100])
  })

  it('fails an active goal when its deadline passed without reaching the target', () => {
    const created = createGoal({ metric: 'distance', targetUnits: 100, deadline: dayKey() })
    getDb().prepare('UPDATE goals SET deadline = ? WHERE id = ?').run('2000-01-01', created.id)

    const [goal] = listGoals()
    expect(goal.status).toBe('failed')
    expect(goal.failedAt).not.toBeNull()
    expect(entriesOf(goal).some((e) => e.kind === 'system' && e.content.includes('Время цели истекло'))).toBe(true)
  })

  it('keeps a goal active while the deadline has not passed and the target is not reached', () => {
    createGoal({ metric: 'distance', targetUnits: 100, deadline: dayKey() })
    const [goal] = listGoals()
    expect(goal.status).toBe('active')
    expect(goal.progress.currentUnits).toBe(0)
  })

  it('sums the latest balances into bankroll USD with a 50% milestone', () => {
    const a = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    const b = createRoom({ name: 'RedStar', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    insertBalance(a, '2026-09-10', 500_00, 'USD')
    insertBalance(b, '2026-09-11', 300_00, 'USD')

    const created = createGoal({ metric: 'bankroll', targetUnits: 1000_00 })
    expect(created.progress).toMatchObject({ currentUnits: 800_00, percent: 80, blank: false })
    const milestones = entriesOf(created)
      .map((e) => e.milestone)
      .sort()
    expect(milestones).toEqual([50, 75])
  })

  it('reconciles achieved for bankroll when latest balances cross the target', () => {
    const a = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    insertBalance(a, '2026-09-10', 900_00, 'USD')
    createGoal({ metric: 'bankroll', targetUnits: 1000_00 })

    insertBalance(a, '2026-09-12', 1200_00, 'USD')
    const [goal] = listGoals()
    expect(goal.status).toBe('achieved')
    expect(goal.progress.currentUnits).toBe(1200_00)
    expect(entriesOf(goal).some((e) => e.milestone === 100)).toBe(true)
  })

  it('reports blank progress when a balance cannot be converted to USD', () => {
    const room = createRoom({ name: 'RedStar', cashCurrency: 'RUB', tournamentCurrency: 'RUB' }).id
    insertBalance(room, '2026-09-10', 10_000_00, 'RUB')

    const created = createGoal({ metric: 'bankroll', targetUnits: 1000_00 })
    expect(created.progress).toMatchObject({ currentUnits: null, percent: 0, blank: true })
    expect(created.status).toBe('active')
    expect(entriesOf(created)).toEqual([])
  })

  it('adds user entries without touching milestones', () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    insertTournament(room, '2026-09-10', 550, 700, 'USD')
    const goal = createGoal({ metric: 'distance', targetUnits: 4 })

    const entry = addUserEntry(goal.id, '  Отличный прогон  ')
    expect(entry).toMatchObject({ goalId: goal.id, kind: 'user', milestone: null, images: [] })
    expect(entry.content).toBe('Отличный прогон')

    expect(() => addUserEntry(goal.id, '   ')).toThrow(HttpError)
    expect(() => addUserEntry(goal.id, 'x'.repeat(5001))).toThrow(HttpError)
    expect(() => addUserEntry(9999, 'comment')).toThrow(HttpError)

    const [listed] = listGoals()
    const kinds = entriesOf(listed).map((e) => e.kind)
    expect(kinds).toEqual(expect.arrayContaining(['user']))
  })

  it('accepts a multi-line note up to 5000 characters', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    const long = 'строка\n'.repeat(300).trim()
    expect(long.length).toBeGreaterThan(500)
    const entry = addUserEntry(goal.id, long)
    expect(entry.content).toBe(long)
    expect(entry.content).toContain('\n')
  })

  it('closes an active goal as achieved manually', () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    insertTournament(room, '2026-09-10', 550, 700, 'USD')
    const goal = createGoal({ metric: 'distance', targetUnits: 100 })

    const closed = closeGoal(goal.id, 'achieved')
    expect(closed.status).toBe('achieved')
    expect(closed.achievedAt).not.toBeNull()
    expect(entriesOf(closed).some((e) => e.milestone === 100)).toBe(true)
    expect(() => closeGoal(goal.id, 'achieved')).toThrow(HttpError)
    expect(() => closeGoal(9999, 'achieved')).toThrow(HttpError)
  })

  it('fails an active goal manually with an entry', () => {
    const goal = createGoal({ metric: 'distance', targetUnits: 100 })

    const failed = closeGoal(goal.id, 'failed') as GoalWithProgress
    expect(failed.status).toBe('failed')
    expect(failed.failedAt).not.toBeNull()
    expect(entriesOf(failed).some((e) => e.kind === 'system' && e.content === 'Цель не достигнута' && e.milestone === null)).toBe(true)
    expect(() => closeGoal(goal.id, 'failed')).toThrow(HttpError)
  })

  it('rejects an invalid close outcome', () => {
    const goal = createGoal({ metric: 'distance', targetUnits: 10 })
    expect(() => closeGoal(goal.id, 'nope')).toThrow(HttpError)
    expect(() => closeGoal(goal.id, undefined)).toThrow(HttpError)
    expect(() => closeGoal(goal.id, 'closed')).toThrow(HttpError)
  })

  it('closes a goal manually as acknowledged and keeps its history', () => {
    const goal = createGoal({ metric: 'distance', targetUnits: 10 })
    addUserEntry(goal.id, 'заметка')

    const closed = closeGoal(goal.id, 'failed')
    expect(closed.status).toBe('failed')
    expect(closed.failedAt).not.toBeNull()
    expect(closed.acknowledgedAt).not.toBeNull()
    expect(entriesOf(closed).some((e) => e.kind === 'system' && e.content === 'Цель не достигнута')).toBe(true)
    expect(entriesOf(closed).some((e) => e.kind === 'user' && e.content === 'заметка')).toBe(true)
    expect(() => closeGoal(goal.id, 'failed')).toThrow(HttpError)

    const [listed] = listGoals()
    expect(listed.status).toBe('failed')
    const left = (getDb().prepare('SELECT COUNT(*) AS c FROM goal_entries').get() as { c: number }).c
    expect(left).toBe(2)
  })

  it('freezes the progress snapshot at the moment a goal is closed', () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    for (let i = 0; i < 3; i++) insertTournament(room, `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, 550, 0, 'USD')
    const goal = createGoal({ metric: 'distance', targetUnits: 10 })

    const closed = closeGoal(goal.id, 'failed')
    expect(closed.finalPercent).toBe(30)
    expect(closed.finalUnits).toBe(3)

    for (let i = 0; i < 5; i++) insertTournament(room, `2026-09-${String((i % 28) + 20).padStart(2, '0')}`, 550, 0, 'USD')
    const [listed] = listGoals()
    expect(listed.status).toBe('failed')
    expect(listed.progress).toMatchObject({ currentUnits: 3, percent: 30, blank: false })
    expect(listed.finalPercent).toBe(30)
  })

  it('keeps an auto-finished goal unacknowledged until acknowledged', () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    createGoal({ metric: 'distance', targetUnits: 1 })
    insertTournament(room, '2026-09-10', 550, 0, 'USD')

    const [auto] = listGoals()
    expect(auto.status).toBe('achieved')
    expect(auto.acknowledgedAt).toBeNull()

    const acked = acknowledgeGoal(auto.id)
    expect(acked.status).toBe('achieved')
    expect(acked.acknowledgedAt).not.toBeNull()

    const [again] = listGoals()
    expect(again.acknowledgedAt).not.toBeNull()
  })

  it('refuses to acknowledge an active or missing goal', () => {
    const goal = createGoal({ metric: 'distance', targetUnits: 10 })
    expect(() => acknowledgeGoal(goal.id)).toThrow(HttpError)
    expect(() => acknowledgeGoal(9999)).toThrow(HttpError)
  })
})

describe('custom goals', () => {
  it('requires a title for the custom metric', () => {
    expect(() => createGoal({ metric: 'custom', targetUnits: 10 })).toThrow(HttpError)
    expect(() => createGoal({ metric: 'custom', targetUnits: 1, title: '   ' })).toThrow(HttpError)
    expect(() => createGoal({ metric: 'custom', targetUnits: 1, title: 'x'.repeat(101) })).toThrow(HttpError)
  })

  it('creates a custom goal with a fixed target and binary progress', () => {
    const created = createGoal({ metric: 'custom', targetUnits: 999, title: '  Выучить испанский  ' })
    expect(created.metric).toBe('custom')
    expect(created.title).toBe('Выучить испанский')
    expect(created.targetUnits).toBe(1)
    expect(created.progress).toMatchObject({ currentUnits: null, percent: 0, blank: false })
    expect(created.status).toBe('active')
  })

  it('never auto-reconciles: stays active despite tournaments and a passed deadline', () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    for (let i = 0; i < 5; i++) insertTournament(room, '2026-09-10', 550, 700, 'USD')
    const created = createGoal({ metric: 'custom', targetUnits: 1, title: 'Выучить испанский', deadline: dayKey() })
    getDb().prepare('UPDATE goals SET deadline = ? WHERE id = ?').run('2000-01-01', created.id)

    const [goal] = listGoals()
    expect(goal.status).toBe('active')
    expect(goal.progress.currentUnits).toBeNull()
    expect(entriesOf(goal)).toEqual([])
    expect(goal.title).toBe('Выучить испанский')
  })

  it('is achieved manually via closeGoal achieved', () => {
    const created = createGoal({ metric: 'custom', targetUnits: 1, title: 'Выйти на марафон' })

    const closed = closeGoal(created.id, 'achieved')
    expect(closed.status).toBe('achieved')
    expect(closed.achievedAt).not.toBeNull()
    expect(entriesOf(closed).some((e) => e.kind === 'system' && e.milestone === 100)).toBe(true)
  })

  it('is failed manually via closeGoal failed', () => {
    const created = createGoal({ metric: 'custom', targetUnits: 1, title: 'Пробежать 10 км' })

    const failed = closeGoal(created.id, 'failed')
    expect(failed.status).toBe('failed')
    expect(failed.failedAt).not.toBeNull()
    expect(entriesOf(failed).some((e) => e.kind === 'system' && e.content === 'Цель не достигнута')).toBe(true)
  })
})

describe('goal checklists', () => {
  function items(...texts: string[]): ChecklistItem[] {
    return texts.map((text, i) => ({ id: `id-${i}`, text, status: 'pending' }))
  }

  it('defaults every new goal to an empty checklist', () => {
    const goal = createGoal({ metric: 'distance', targetUnits: 100 })
    expect(goal.checklist).toEqual([])
  })

  it('rejects malformed checklist payloads', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Подготовка' })
    expect(() => setChecklist(goal.id, 'nope')).toThrow(HttpError)
    expect(() => setChecklist(goal.id, {})).toThrow(HttpError)
    expect(() => setChecklist(goal.id, [{ id: 1, text: 'x', status: 'pending' }])).toThrow(HttpError)
    expect(() => setChecklist(goal.id, [{ id: 'a', text: '   ', status: 'pending' }])).toThrow(HttpError)
    expect(() => setChecklist(goal.id, [{ id: 'a', text: 'x', status: 'nope' }])).toThrow(HttpError)
    expect(() => setChecklist(goal.id, [{ id: 'a', text: 'x' }])).toThrow(HttpError)
    expect(() => setChecklist(goal.id, [{ id: 'a', text: 'x', status: 'pending' }, { id: 'a', text: 'y', status: 'pending' }])).toThrow(
      HttpError,
    )
    expect(() => setChecklist(goal.id, [{ id: 'a', text: 'x'.repeat(201), status: 'pending' }])).toThrow(HttpError)
    expect(() => setChecklist(goal.id, Array.from({ length: 51 }, (_, i) => ({ id: `i${i}`, text: `п${i}`, status: 'pending' })))).toThrow(
      HttpError,
    )
    expect(() => setChecklist(9999, items('x'))).toThrow(HttpError)
  })

  it('accepts a checklist on an existing active goal', () => {
    const goal = createGoal({ metric: 'distance', targetUnits: 100 })
    const updated = setChecklist(goal.id, [{ id: 'id-0', text: '  прогреть спину  ', status: 'completed' }])
    expect(updated.checklist).toEqual([{ id: 'id-0', text: 'прогреть спину', status: 'completed' }])
    const [listed] = listGoals()
    expect(listed.checklist).toEqual([{ id: 'id-0', text: 'прогреть спину', status: 'completed' }])
  })

  it('reads a legacy done-boolean checklist as pending or completed', () => {
    const goal = createGoal({ metric: 'distance', targetUnits: 100 })
    getDb()
      .prepare('UPDATE goals SET checklist = ? WHERE id = ?')
      .run(JSON.stringify([{ id: 'a', text: 'раз', done: true }, { id: 'b', text: 'два', done: false }]), goal.id)

    const [listed] = listGoals()
    expect(listed.checklist).toEqual([
      { id: 'a', text: 'раз', status: 'completed' },
      { id: 'b', text: 'два', status: 'pending' }
    ])
  })

  it('allows changing the checklist of a settled goal without reopening it', () => {
    const goal = createGoal({ metric: 'distance', targetUnits: 100 })
    const closed = closeGoal(goal.id, 'failed')
    expect(closed.finalPercent).toBe(0)

    const updated = setChecklist(goal.id, items('x'))
    expect(updated.status).toBe('failed')
    expect(updated.checklist).toEqual([{ id: 'id-0', text: 'x', status: 'pending' }])
    expect(updated.progress).toMatchObject({ currentUnits: 0, percent: 0, blank: false })
  })

  it('reports live checklist progress for a settled custom goal, not the frozen snapshot', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Ремонт' })
    setChecklist(goal.id, items('двери', 'окна'))
    const failed = closeGoal(goal.id, 'failed')
    expect(failed.finalPercent).toBe(0)

    const edited = setChecklist(goal.id, [
      { id: 'id-0', text: 'двери', status: 'completed' },
      { id: 'id-1', text: 'окна', status: 'completed' }
    ])
    expect(edited.status).toBe('failed')
    expect(edited.progress).toMatchObject({ currentUnits: 2, percent: 100, blank: false })
  })

  it('derives settled binary progress from the live checklist on the light read path', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Ремонт' })
    setChecklist(goal.id, items('двери', 'окна'))
    closeGoal(goal.id, 'failed')
    setChecklist(goal.id, [
      { id: 'id-0', text: 'двери', status: 'completed' },
      { id: 'id-1', text: 'окна', status: 'pending' }
    ])

    const [listed] = listGoals()
    expect(listed.status).toBe('failed')
    expect(listed.progress).toMatchObject({ currentUnits: 1, percent: 50, blank: false })
  })

  it('keeps the frozen snapshot for a settled metric goal', () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    const goal = createGoal({ metric: 'distance', targetUnits: 10 })
    for (let i = 0; i < 5; i++) insertTournament(room, `2026-09-${String(i + 1).padStart(2, '0')}`, 550, 0, 'USD')
    closeGoal(goal.id, 'failed')

    for (let i = 5; i < 10; i++) insertTournament(room, `2026-09-${String(i + 1).padStart(2, '0')}`, 550, 0, 'USD')

    const [listed] = listGoals()
    expect(listed.status).toBe('failed')
    expect(listed.progress).toMatchObject({ currentUnits: 5, percent: 50, blank: false })
  })

  it('drives custom goal progress by the checked share', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Ремонт' })
    const start = setChecklist(goal.id, items('двери', 'окна', 'обои'))
    expect(start.status).toBe('active')
    expect(start.progress).toMatchObject({ currentUnits: 0, percent: 0, blank: false })

    const half = setChecklist(goal.id, [
      { id: 'id-0', text: 'двери', status: 'completed' },
      { id: 'id-1', text: 'окна', status: 'pending' },
      { id: 'id-2', text: 'обои', status: 'completed' }
    ])
    expect(half.status).toBe('active')
    expect(half.progress).toMatchObject({ currentUnits: 2, percent: 66, blank: false })
  })

  it('weights a partial checklist item at half progress', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Ремонт' })
    setChecklist(goal.id, items('двери', 'окна'))
    const half = setChecklist(goal.id, [
      { id: 'id-0', text: 'двери', status: 'completed' },
      { id: 'id-1', text: 'окна', status: 'partial' }
    ])
    expect(half.status).toBe('active')
    expect(half.progress).toMatchObject({ currentUnits: 1, percent: 75, blank: false })
  })

  it('does not settle a custom goal when a resolved item failed (daily-only rule)', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Ремонт' })
    const resolved = setChecklist(goal.id, [
      { id: 'id-0', text: 'двери', status: 'completed' },
      { id: 'id-1', text: 'окна', status: 'failed' }
    ])
    expect(resolved.status).toBe('active')
    expect(resolved.progress).toMatchObject({ currentUnits: 1, percent: 50, blank: false })
  })

  it('auto-achieves a custom checklist goal when the last item is checked', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Ремонт' })
    setChecklist(goal.id, items('двери', 'окна', 'обои'))
    const done = setChecklist(goal.id, [
      { id: 'id-0', text: 'двери', status: 'completed' },
      { id: 'id-1', text: 'окна', status: 'completed' },
      { id: 'id-2', text: 'обои', status: 'completed' }
    ])
    expect(done.status).toBe('achieved')
    expect(done.achievedAt).not.toBeNull()
    expect(entriesOf(done).some((e) => e.kind === 'system' && e.milestone === 100 && e.content === 'Все пункты выполнены')).toBe(true)
  })

  it('fails a custom checklist goal on a passed deadline with items left', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Ремонт', deadline: dayKey() })
    getDb().prepare('UPDATE goals SET deadline = ? WHERE id = ?').run('2000-01-01', goal.id)
    setChecklist(goal.id, items('двери', 'окна'))

    const [listed] = listGoals()
    expect(listed.status).toBe('failed')
    expect(entriesOf(listed).some((e) => e.kind === 'system' && e.content.includes('Время цели истекло'))).toBe(true)
  })

  it('keeps metric progress anchored and gates achievement on the checklist (AND)', () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    const goal = createGoal({ metric: 'distance', targetUnits: 10 })
    setChecklist(goal.id, items('гигиена', 'разбор'))

    for (let i = 0; i < 10; i++) insertTournament(room, `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, 550, 0, 'USD')

    const [metricOnly] = listGoals()
    expect(metricOnly.progress).toMatchObject({ currentUnits: 10, percent: 100, blank: false })
    expect(metricOnly.status).toBe('active')
    expect(entriesOf(metricOnly).some((e) => e.milestone === 100)).toBe(false)

    const done = setChecklist(goal.id, [
      { id: 'id-0', text: 'гигиена', status: 'completed' },
      { id: 'id-1', text: 'разбор', status: 'completed' }
    ])
    expect(done.status).toBe('achieved')
    expect(entriesOf(done).some((e) => e.kind === 'system' && e.milestone === 100)).toBe(true)
  })

  it('lets a metric goal reach the deadline even with the checklist open', () => {
    const goal = createGoal({ metric: 'distance', targetUnits: 10, deadline: dayKey() })
    setChecklist(goal.id, items('гигиена'))
    getDb().prepare('UPDATE goals SET deadline = ? WHERE id = ?').run('2000-01-01', goal.id)

    const [listed] = listGoals()
    expect(listed.status).toBe('failed')
  })

  it('keeps a metric goal in blank progress state while the checklist is open', () => {
    const room = createRoom({ name: 'RedStar', cashCurrency: 'RUB', tournamentCurrency: 'RUB' }).id
    insertBalance(room, '2026-09-10', 10_000_00, 'RUB')
    const goal = createGoal({ metric: 'bankroll', targetUnits: 1000_00, deadline: dayKey() })
    setChecklist(goal.id, items('план'))
    getDb().prepare('UPDATE goals SET deadline = ? WHERE id = ?').run('2000-01-01', goal.id)

    const [listed] = listGoals()
    expect(listed.progress).toMatchObject({ currentUnits: null, percent: 0, blank: true })
    expect(listed.status).toBe('active')
  })

  it('reorders goals and persists the new order for the next read', () => {
    const first = createGoal({ metric: 'distance', targetUnits: 10 })
    const second = createGoal({ metric: 'distance', targetUnits: 20 })
    const third = createGoal({ metric: 'distance', targetUnits: 30 })
    expect(listGoals().map((g) => g.id)).toEqual([third.id, second.id, first.id])

    const reordered = reorderGoals([first.id, third.id, second.id])
    expect(reordered.map((g) => g.id)).toEqual([first.id, third.id, second.id])
    expect(listGoals().map((g) => g.id)).toEqual([first.id, third.id, second.id])
    expect(listGoals().map((g) => g.sortOrder)).toEqual([0, 1, 2])
  })

  it('reorders a prefix and keeps the goals that were not listed in their old relative order', () => {
    const first = createGoal({ metric: 'distance', targetUnits: 10 })
    const second = createGoal({ metric: 'distance', targetUnits: 20 })
    const third = createGoal({ metric: 'distance', targetUnits: 30 })

    const result = reorderGoals([third.id, first.id])
    expect(result.map((g) => g.id)).toEqual([third.id, first.id, second.id])
    expect(listGoals().map((g) => g.id)).toEqual([third.id, first.id, second.id])
  })

  it('parks a newly created goal on top of a manually ordered list', () => {
    const first = createGoal({ metric: 'distance', targetUnits: 10 })
    const second = createGoal({ metric: 'distance', targetUnits: 20 })
    reorderGoals([first.id, second.id])

    const third = createGoal({ metric: 'distance', targetUnits: 30 })
    expect(listGoals().map((g) => g.id)).toEqual([third.id, first.id, second.id])
  })

  it('rejects a malformed reorder payload without touching the stored order', () => {
    const first = createGoal({ metric: 'distance', targetUnits: 10 })
    const second = createGoal({ metric: 'distance', targetUnits: 20 })
    const before = listGoals().map((g) => g.id)

    expect(() => reorderGoals(undefined)).toThrow(HttpError)
    expect(() => reorderGoals('nope')).toThrow(HttpError)
    expect(() => reorderGoals([first.id, 0])).toThrow(HttpError)
    expect(() => reorderGoals([first.id, -3])).toThrow(HttpError)
    expect(() => reorderGoals([first.id, 1.5])).toThrow(HttpError)
    expect(() => reorderGoals([first.id, first.id])).toThrow(HttpError)
    expect(() => reorderGoals([9999])).toThrow(HttpError)

    expect(listGoals().map((g) => g.id)).toEqual(before)
    expect(second.id).toBeGreaterThan(0)
  })

  it('reorders idempotently and keeps progress and the diary intact', () => {
    const first = createGoal({ metric: 'distance', targetUnits: 10 })
    const second = createGoal({ metric: 'distance', targetUnits: 20 })
    addUserEntry(first.id, 'первая заметка')

    reorderGoals([second.id, first.id])
    reorderGoals([second.id, first.id])

    const listed = listGoals()
    expect(listed.map((g) => g.id)).toEqual([second.id, first.id])
    expect(listed.map((g) => g.sortOrder)).toEqual([0, 1])
    const restored = listed[1]
    expect(restored.progress).toMatchObject({ currentUnits: 0, percent: 0, blank: false })
    expect(entriesOf(restored).map((e) => e.content)).toEqual(['первая заметка'])
  })

  it('reorders an empty list into the previous order', () => {
    const first = createGoal({ metric: 'distance', targetUnits: 10 })
    const second = createGoal({ metric: 'distance', targetUnits: 20 })
    expect(reorderGoals([]).map((g) => g.id)).toEqual([second.id, first.id])
  })
})

const IMG_A = 'diary/2f9c1e7a-3b4d-4c5e-8f01-9a2b3c4d5e6f.png'
const IMG_B = 'diary/11111111-2222-3333-4444-555555555555.jpg'
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const writtenFiles: string[] = []

afterEach(() => {
  for (const file of writtenFiles.splice(0)) {
    if (existsSync(file)) rmSync(file)
  }
})

describe('goal diary entries', () => {
  it('stores attached image paths on a new note and returns them on read', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    const entry = addUserEntry(goal.id, 'сегодня был продуктивный день', [IMG_A, IMG_B])
    expect(entry.images).toEqual([IMG_A, IMG_B])

    const [listed] = listGoals()
    expect(listed.entries[0]?.images).toEqual([IMG_A, IMG_B])
  })

  it('rejects malformed image payloads', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    expect(() => addUserEntry(goal.id, 'x', 'nope')).toThrow(HttpError)
    expect(() => addUserEntry(goal.id, 'x', [123])).toThrow(HttpError)
    expect(() => addUserEntry(goal.id, 'x', ['../secret.png'])).toThrow(HttpError)
    expect(() => addUserEntry(goal.id, 'x', ['diary/not-a-uuid.png'])).toThrow(HttpError)
    expect(() => addUserEntry(goal.id, 'x', [IMG_A, IMG_A])).toThrow(HttpError)
    expect(() => addUserEntry(goal.id, 'x', Array.from({ length: 11 }, () => IMG_A))).toThrow(HttpError)
  })

  it('edits a note in place, replacing its images', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    const entry = addUserEntry(goal.id, 'первая версия', [IMG_A])

    const updated = updateUserEntry(goal.id, entry.id, 'исправленная версия', [IMG_B])
    expect(updated.id).toBe(entry.id)
    expect(updated.content).toBe('исправленная версия')
    expect(updated.images).toEqual([IMG_B])

    const [listed] = listGoals()
    expect(listed.entries).toHaveLength(1)
    expect(listed.entries[0]?.content).toBe('исправленная версия')
  })

  it('keeps existing photos when the update omits the images field entirely', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    const entry = addUserEntry(goal.id, 'с фото', [IMG_A])

    const kept = updateUserEntry(goal.id, entry.id, 'текст без поля images', undefined)
    expect(kept.images).toEqual([IMG_A])

    const [listed] = listGoals()
    expect(listed.entries[0]?.images).toEqual([IMG_A])
  })

  it('frees attached files only when an explicit images payload drops them', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    const path = saveDiaryImage(PNG_HEADER, 'image/png')
    const file = join(DIARY_DIR, path.slice('diary/'.length))
    writtenFiles.push(file)
    const entry = addUserEntry(goal.id, 'с фото', [path])
    expect(existsSync(file)).toBe(true)

    updateUserEntry(goal.id, entry.id, 'без поля images', undefined)
    expect(existsSync(file)).toBe(true)

    updateUserEntry(goal.id, entry.id, 'с пустым массивом', [])
    expect(existsSync(file)).toBe(false)
    expect((getDb().prepare('SELECT images FROM goal_entries WHERE id = ?').get(entry.id) as { images: string }).images).toBe('[]')
  })

  it('refuses to edit or delete a system entry or a missing note', () => {
    const goal = createGoal({ metric: 'distance', targetUnits: 1 })
    insertTournament(createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id, '2026-09-10', 550, 0, 'USD')
    const [settled] = listGoals()
    const systemEntry = entriesOf(settled).find((e) => e.kind === 'system')
    expect(systemEntry).toBeDefined()

    expect(() => updateUserEntry(goal.id, systemEntry!.id, 'x', [])).toThrow(HttpError)
    expect(() => deleteUserEntry(goal.id, systemEntry!.id)).toThrow(HttpError)
    expect(() => updateUserEntry(goal.id, 9999, 'x', [])).toThrow(HttpError)
    expect(() => deleteUserEntry(goal.id, 9999)).toThrow(HttpError)
    expect(() => deleteUserEntry(9999, 1)).toThrow(HttpError)
  })

  it('deletes a note and drops it from the diary', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    const first = addUserEntry(goal.id, 'оставить')
    const second = addUserEntry(goal.id, 'удалить', [IMG_A])

    deleteUserEntry(goal.id, second.id)

    const [listed] = listGoals()
    expect(entriesOf(listed).map((e) => e.content)).toEqual(['оставить'])
    expect((getDb().prepare('SELECT COUNT(*) AS c FROM goal_entries').get() as { c: number }).c).toBe(1)
    expect(first.id).toBeLessThan(second.id)
  })
})

describe('diary html sanitization', () => {
  it('keeps only the allowed formatting tags and drops attributes', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    const entry = addUserEntry(
      goal.id,
      '<p class="x">Жирный <strong style="color:red">и курсив</strong> <i>текст</i> <mark>выделено</mark> <u>подчёркнуто</u><br/>вторая строка</p>',
    )
    expect(entry.content).toBe('<p>Жирный <strong>и курсив</strong> <i>текст</i> <mark>выделено</mark> <u>подчёркнуто</u><br>вторая строка</p>')
  })

  it('strips script tags, event handlers and unknown elements, keeping inner text', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    const entry = addUserEntry(goal.id, '<b>привет</b><script>alert(1)</script><img src="/x" onerror="boom()"><a href="/y">ссылка</a>')
    expect(entry.content).toBe('<b>привет</b>alert(1)ссылка')
  })

  it('treats a lone plain-text entry as-is', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    expect(addUserEntry(goal.id, '  просто текст  ').content).toBe('просто текст')
    expect(() => addUserEntry(goal.id, '<p></p>')).toThrow(HttpError)
    expect(() => addUserEntry(goal.id, '<script/>')).toThrow(HttpError)
  })

  it('measures the length by visible text, not raw markup', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    expect(addUserEntry(goal.id, `<p>${'x'.repeat(5000)}</p>`).content).toBe(`<p>${'x'.repeat(5000)}</p>`)
    expect(() => addUserEntry(goal.id, `<p>${'x'.repeat(5001)}</p>`)).toThrow(HttpError)
  })

  it('sanitizes content on edit as well', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    const entry = addUserEntry(goal.id, 'первая версия')
    const updated = updateUserEntry(goal.id, entry.id, '<b>обновлено</b><svg/onload=x>', [])
    expect(updated.content).toBe('<b>обновлено</b>')
  })

  it('keeps a span font-size inside the allowed 8-20px range', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    const entry = addUserEntry(goal.id, '<p>Обычный <span style="font-size: 18px">крупный</span> текст</p>')
    expect(entry.content).toBe('<p>Обычный <span style="font-size: 18px">крупный</span> текст</p>')
  })

  it('drops out-of-range and non-px font sizes, keeping the text', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    expect(addUserEntry(goal.id, '<span style="font-size: 24px">x</span>').content).toBe('<span>x</span>')
    expect(addUserEntry(goal.id, '<span style="font-size: 7px">x</span>').content).toBe('<span>x</span>')
    expect(addUserEntry(goal.id, '<span style="font-size: 16pt">x</span>').content).toBe('<span>x</span>')
    expect(addUserEntry(goal.id, '<span style="font-size: 100%">x</span>').content).toBe('<span>x</span>')
  })

  it('strips unknown style properties while keeping a hex mark background', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    const entry = addUserEntry(goal.id, '<mark style="background-color: #fef08a; color: red; position: fixed">x</mark>')
    expect(entry.content).toBe('<mark style="background-color: #fef08a">x</mark>')
  })

  it('keeps a hex data-color on mark and rejects non-hex', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    expect(addUserEntry(goal.id, '<mark data-color="#fbcfe8" style="background-color: #fbcfe8">x</mark>').content).toBe(
      '<mark data-color="#fbcfe8" style="background-color: #fbcfe8">x</mark>'
    )
    expect(addUserEntry(goal.id, '<mark data-color="red">x</mark>').content).toBe('<mark>x</mark>')
  })

  it('blocks named colors, url() payloads and cross-tag injection', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    expect(addUserEntry(goal.id, '<mark style="background-color: red">x</mark>').content).toBe('<mark>x</mark>')
    expect(addUserEntry(goal.id, '<mark style="background-color: url(javascript:alert(1))">x</mark>').content).toBe('<mark>x</mark>')
    expect(addUserEntry(goal.id, '<span style="background-color: #fef08a; font-size: 18px">x</span>').content).toBe('<span style="font-size: 18px">x</span>')
  })

  it('normalizes a browser-serialized rgb color back to hex', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    expect(addUserEntry(goal.id, '<mark data-color="#fef08a" style="background-color: rgb(254, 240, 138); color: inherit;">x</mark>').content).toBe(
      '<mark data-color="#fef08a" style="background-color: #fef08a">x</mark>'
    )
    expect(addUserEntry(goal.id, '<mark style="background-color: rgb(255, 0, 0)">x</mark>').content).toBe('<mark style="background-color: #ff0000">x</mark>')
    expect(addUserEntry(goal.id, '<mark style="background-color: rgba(0, 0, 0, 0.5)">x</mark>').content).toBe('<mark>x</mark>')
  })

  it('drops an unterminated tag fragment instead of storing it verbatim', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    expect(addUserEntry(goal.id, '<b>привет</b><img src=x onerror=alert(1)').content).toBe('<b>привет</b>')
    expect(addUserEntry(goal.id, '<b>привет</b><').content).toBe('<b>привет</b>')
    expect(addUserEntry(goal.id, 'смотри сюда <').content).toBe('смотри сюда')
    expect(sanitizeDiaryHtml('<p>a</p><script>alert(1)')).toBe('<p>a</p>alert(1)')
    expect(() => addUserEntry(goal.id, '<img src=x onerror=alert(1)')).toThrow(HttpError)
  })
})

describe('goal checklists at creation', () => {
  it('stores the checklist on a newly created goal for any metric', () => {
    const goal = createGoal({ metric: 'custom', targetUnits: 1, title: 'Ремонт', checklist: ['  двери  ', 'окна', 'обои'] })
    expect(goal.checklist).toEqual([
      { id: expect.any(String), text: 'двери', status: 'pending' },
      { id: expect.any(String), text: 'окна', status: 'pending' },
      { id: expect.any(String), text: 'обои', status: 'pending' }
    ])
    expect(goal.status).toBe('active')

    const metric = createGoal({ metric: 'distance', targetUnits: 10, checklist: ['разбор'] })
    expect(metric.checklist).toEqual([{ id: expect.any(String), text: 'разбор', status: 'pending' }])
  })

  it('rejects malformed creation checklists', () => {
    expect(() => createGoal({ metric: 'custom', targetUnits: 1, title: 'x', checklist: 'nope' })).toThrow(HttpError)
    expect(() => createGoal({ metric: 'custom', targetUnits: 1, title: 'x', checklist: [1] })).toThrow(HttpError)
    expect(() => createGoal({ metric: 'custom', targetUnits: 1, title: 'x', checklist: ['   '] })).toThrow(HttpError)
    expect(() => createGoal({ metric: 'custom', targetUnits: 1, title: 'x', checklist: ['a', 'a'] })).toThrow(HttpError)
    expect(() => createGoal({ metric: 'custom', targetUnits: 1, title: 'x', checklist: ['x'.repeat(201)] })).toThrow(HttpError)
    expect(() => createGoal({ metric: 'custom', targetUnits: 1, title: 'x', checklist: Array.from({ length: 51 }, (_, i) => `п${i}`) })).toThrow(
      HttpError,
    )
  })
})

describe('daily goals', () => {
  it('creates a daily goal pinned to today, ignoring a passed deadline', () => {
    const created = createGoal({ metric: 'daily', targetUnits: 999, title: '  Зарядка  ', deadline: '2030-01-01' })
    expect(created.metric).toBe('daily')
    expect(created.title).toBe('Зарядка')
    expect(created.targetUnits).toBe(1)
    expect(created.deadline).toBe(dayKey())
    expect(created.status).toBe('active')
    expect(created.progress).toMatchObject({ currentUnits: null, percent: 0, blank: false })
  })

  it('requires a title for daily goals', () => {
    expect(() => createGoal({ metric: 'daily', targetUnits: 1 })).toThrow(HttpError)
    expect(() => createGoal({ metric: 'daily', targetUnits: 1, title: '   ' })).toThrow(HttpError)
  })

  it('never auto-reconciles a plain daily goal without a checklist', () => {
    const created = createGoal({ metric: 'daily', targetUnits: 1, title: 'Зарядка' })
    getDb().prepare('UPDATE goals SET deadline = ? WHERE id = ?').run('2000-01-01', created.id)

    const [goal] = listGoals()
    expect(goal.status).toBe('active')
    expect(goal.progress.currentUnits).toBeNull()
    expect(entriesOf(goal)).toEqual([])
  })

  it('marks a plain daily goal done manually with a 100 milestone', () => {
    const created = createGoal({ metric: 'daily', targetUnits: 1, title: 'Зарядка' })
    const closed = closeGoal(created.id, 'achieved')
    expect(closed.status).toBe('achieved')
    expect(closed.acknowledgedAt).not.toBeNull()
    expect(entriesOf(closed).some((e) => e.kind === 'system' && e.milestone === 100 && e.content === 'Все дела дня выполнены')).toBe(true)
  })

  it('is failed manually the same way as a custom goal', () => {
    const created = createGoal({ metric: 'daily', targetUnits: 1, title: 'Зарядка' })
    const failed = closeGoal(created.id, 'failed')
    expect(failed.status).toBe('failed')
    expect(failed.acknowledgedAt).not.toBeNull()
    expect(entriesOf(failed).some((e) => e.kind === 'system' && e.content === 'Цель не достигнута')).toBe(true)
  })

  it('drives daily progress by the checklist and auto-achieves acknowledged', () => {
    const created = createGoal({ metric: 'daily', targetUnits: 1, title: 'День', checklist: ['пункт А', 'пункт Б'] })
    expect(created.checklist).toHaveLength(2)
    expect(created.progress).toMatchObject({ currentUnits: 0, percent: 0, blank: false })

    const done = setChecklist(created.id, created.checklist.map((item) => ({ ...item, status: 'completed' as const })))
    expect(done.status).toBe('achieved')
    expect(done.acknowledgedAt).not.toBeNull()
    expect(entriesOf(done).some((e) => e.kind === 'system' && e.milestone === 100 && e.content === 'Все пункты выполнены')).toBe(true)
  })

  it('keeps a daily goal active while any item is still pending', () => {
    const created = createGoal({ metric: 'daily', targetUnits: 1, title: 'День', checklist: ['А', 'Б'] })
    const partial = setChecklist(created.id, [
      { id: created.checklist[0]!.id, text: 'А', status: 'failed' },
      { id: created.checklist[1]!.id, text: 'Б', status: 'pending' }
    ])
    expect(partial.status).toBe('active')
  })

  it('does not settle a daily goal while an item is partial', () => {
    const created = createGoal({ metric: 'daily', targetUnits: 1, title: 'День', checklist: ['А', 'Б'] })
    const mixed = setChecklist(created.id, [
      { id: created.checklist[0]!.id, text: 'А', status: 'completed' },
      { id: created.checklist[1]!.id, text: 'Б', status: 'partial' }
    ])
    expect(mixed.status).toBe('active')
  })

  it('auto-fails a daily goal once every item is resolved with a failure', () => {
    const created = createGoal({ metric: 'daily', targetUnits: 1, title: 'День', checklist: ['А', 'Б'] })
    const mixed = setChecklist(created.id, [
      { id: created.checklist[0]!.id, text: 'А', status: 'completed' },
      { id: created.checklist[1]!.id, text: 'Б', status: 'failed' }
    ])
    expect(mixed.status).toBe('failed')
    expect(mixed.acknowledgedAt).not.toBeNull()
    expect(entriesOf(mixed).some((e) => e.kind === 'system' && e.content === 'Не все пункты выполнены')).toBe(true)
  })

  it('auto-fails a checklist daily goal on a passed deadline as acknowledged', () => {
    const created = createGoal({ metric: 'daily', targetUnits: 1, title: 'День', checklist: ['дело'] })
    getDb().prepare('UPDATE goals SET deadline = ? WHERE id = ?').run('2000-01-01', created.id)

    const [goal] = listGoals()
    expect(goal.status).toBe('failed')
    expect(goal.acknowledgedAt).not.toBeNull()
    expect(entriesOf(goal).some((e) => e.kind === 'system' && e.content.includes('Время цели истекло'))).toBe(true)
  })

  it('excludes finished daily goals from the default list but keeps active ones', () => {
    const active = createGoal({ metric: 'daily', targetUnits: 1, title: 'Сегодня' })
    const finished = createGoal({ metric: 'daily', targetUnits: 1, title: 'Вчера' })
    closeGoal(finished.id, 'failed')

    const ids = listGoals().map((g) => g.id)
    expect(ids).toContain(active.id)
    expect(ids).not.toContain(finished.id)
  })
})

describe('goal list filters', () => {
  it('returns finished daily goals for a month without the facts path', () => {
    const finished = createGoal({ metric: 'daily', targetUnits: 1, title: 'Вчера' })
    closeGoal(finished.id, 'failed')
    const month = dayKey().slice(0, 7)

    const result = listGoals({ metric: 'daily', startDate: `${month}-01`, endDate: `${month}-31`, includeFinishedDaily: true, finishedOnly: true })
    expect(result.map((g) => g.id)).toContain(finished.id)
    expect(result.every((g) => g.status !== 'active')).toBe(true)
    expect(entriesOf(result[0]).length).toBeGreaterThan(0)
  })

  it('respects the month range on the deadline', () => {
    const finished = createGoal({ metric: 'daily', targetUnits: 1, title: 'Старое' })
    getDb().prepare('UPDATE goals SET deadline = ? WHERE id = ?').run('2026-09-30', finished.id)
    closeGoal(finished.id, 'failed')

    const empty = listGoals({ metric: 'daily', startDate: '2026-10-01', endDate: '2026-10-31', includeFinishedDaily: true, finishedOnly: true })
    expect(empty).toEqual([])

    const september = listGoals({ metric: 'daily', startDate: '2026-09-01', endDate: '2026-09-30', includeFinishedDaily: true, finishedOnly: true })
    expect(september.map((g) => g.id)).toEqual([finished.id])
  })

  it('keeps finished daily goals out of a plain metric filter', () => {
    const finished = createGoal({ metric: 'daily', targetUnits: 1, title: 'Вчера' })
    closeGoal(finished.id, 'failed')
    expect(listGoals({ metric: 'daily' })).toEqual([])
    expect(listGoals({ metric: 'daily', includeFinishedDaily: true }).map((g) => g.id)).toEqual([finished.id])
  })

  it('rejects invalid filter values', () => {
    expect(() => listGoals({ metric: 'nope' })).toThrow(HttpError)
    expect(() => listGoals({ startDate: 'not-a-date' })).toThrow(HttpError)
    expect(() => listGoals({ endDate: '2026-02-30' })).toThrow(HttpError)
    expect(() => listGoals({ startDate: '2026-10-31', endDate: '2026-10-01' })).toThrow(HttpError)
  })
})