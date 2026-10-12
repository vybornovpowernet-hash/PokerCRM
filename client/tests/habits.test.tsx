import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HabitsPage } from '../src/habits/HabitsPage'
import { addMonths, currentMonthKey, monthDays, monthLabel } from '../src/habits/metrics'
import type { HabitHistoryItem, HabitStatus, HabitWithLogs } from '../src/habits/habits.types'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('../src/lib/api', () => ({
  request: mocks.request
}))

let nextId = 1

function habit(over: Partial<HabitWithLogs> = {}): HabitWithLogs {
  return {
    id: nextId++,
    name: 'Медитация',
    color: '#f1f5f9',
    createdAt: new Date().toISOString(),
    archivedAt: null,
    sortOrder: 0,
    logs: {},
    ...over
  }
}

function historyItem(over: Partial<HabitHistoryItem> = {}): HabitHistoryItem {
  return {
    ...habit({ archivedAt: '2026-02-01' }),
    stats: {
      done: 0,
      partial: 0,
      missed: 0,
      tracked: 0,
      completionRate: null,
      firstDate: null,
      lastDate: null,
      longestDoneStreak: 0
    },
    ...over
  }
}

beforeEach(() => {
  nextId = 1
  mocks.request.mockReset()
})

function stubApi(active: () => HabitWithLogs[], archived: () => HabitHistoryItem[] = () => []): void {
  mocks.request.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && path === '/habits/history') {
      return { habits: archived() }
    }
    if (method === 'POST' && path === '/habits') {
      const { name, color } = JSON.parse(init?.body ?? '{}') as { name: string; color: string }
      return { habit: habit({ name, color }) }
    }
    if (method === 'PUT' && path === '/habits/order') {
      return { habits: active() }
    }
    if (method === 'PUT' && /^\/habits\/\d+\/log$/.test(path)) {
      const payload = JSON.parse(init?.body ?? '{}') as { date: string; status: HabitStatus | null }
      return { log: payload.status === null ? null : { date: payload.date, status: payload.status } }
    }
    if (method === 'PUT' && /^\/habits\/\d+$/.test(path)) {
      const input = JSON.parse(init?.body ?? '{}') as Partial<HabitWithLogs>
      return { habit: habit({ id: Number(path.split('/')[2]), ...input }) }
    }
    if (method === 'POST' && /^\/habits\/\d+\/restore$/.test(path)) {
      return { habit: habit({ id: Number(path.split('/')[2]), archivedAt: null }) }
    }
    if (method === 'DELETE' && /^\/habits\/\d+$/.test(path)) {
      return { ok: true }
    }
    return { habits: active() }
  })
}

function cellName(habitName: string, date: string): string {
  const day = monthDays(date.slice(0, 7)).find((d) => d.date === date)
  return `${habitName}, ${day?.day} ${day?.weekday}`
}

describe('HabitsPage', () => {
  it('shows the empty state and creates a habit', async () => {
    stubApi(() => [])
    const user = userEvent.setup()
    render(<HabitsPage />)

    expect(await screen.findByText('Привычек пока нет. Добавьте первую, чтобы вести трекинг.')).not.toBeNull()

    await user.type(screen.getByLabelText('Название новой привычки'), '  Медитация  ')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByText('Медитация')).not.toBeNull()
    expect(screen.getByLabelText('Название новой привычки')).toHaveProperty('value', '')
    expect(screen.queryByText('Привычек пока нет. Добавьте первую, чтобы вести трекинг.')).toBeNull()
  })

  it('creates a habit with the picked color', async () => {
    stubApi(() => [])
    const user = userEvent.setup()
    render(<HabitsPage />)

    await screen.findByText('Привычек пока нет. Добавьте первую, чтобы вести трекинг.')
    expect(screen.queryByRole('listbox')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Цвет новой привычки' }))
    expect(screen.getByRole('listbox', { name: 'Цвет новой привычки' })).not.toBeNull()

    await user.click(screen.getByRole('option', { name: 'Цвет #a5b4fc' }))
    expect(screen.queryByRole('listbox')).toBeNull()

    await user.type(screen.getByLabelText('Название новой привычки'), 'Бег')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('/habits', {
        method: 'POST',
        body: JSON.stringify({ name: 'Бег', color: '#a5b4fc' })
      })
    )
    expect(await screen.findByText('Бег')).not.toBeNull()
  })

  it('lets an emoji-heavy name through the code-point limit', async () => {
    stubApi(() => [])
    const user = userEvent.setup()
    render(<HabitsPage />)

    await screen.findByText('Привычек пока нет. Добавьте первую, чтобы вести трекинг.')
    const input = screen.getByLabelText('Название новой привычки')
    const add = screen.getByRole('button', { name: 'Добавить' })
    const name = `🧘${'x'.repeat(99)}`

    fireEvent.change(input, { target: { value: name } })
    expect(add).toHaveProperty('disabled', false)

    fireEvent.change(input, { target: { value: `${'x'.repeat(101)}` } })
    expect(add).toHaveProperty('disabled', true)

    fireEvent.change(input, { target: { value: name } })
    await user.click(add)
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('/habits', {
        method: 'POST',
        body: JSON.stringify({ name, color: '#f1f5f9' })
      })
    )
  })

  it('renames a habit through the editor', async () => {
    stubApi(() => [habit({ logs: {} })])
    const user = userEvent.setup()
    render(<HabitsPage />)

    await screen.findByText('Медитация')
    await user.click(screen.getByRole('button', { name: 'Изменить Медитация' }))

    const dialog = screen.getByRole('dialog', { name: /Изменить привычку/ })
    const input = within(dialog).getByLabelText('Название привычки')
    await user.clear(input)
    await user.type(input, '🧘 Медитация')
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }))

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('/habits/1', {
        method: 'PUT',
        body: JSON.stringify({ name: '🧘 Медитация', color: '#f1f5f9' })
      })
    )
    expect(await screen.findByText('🧘 Медитация')).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('marks a day done through the status popover', async () => {
    const month = currentMonthKey()
    const date = `${month}-15`
    stubApi(() => [habit({ logs: {} })])
    const user = userEvent.setup()
    render(<HabitsPage />)

    await screen.findByText('Медитация')

    await user.click(screen.getByRole('button', { name: cellName('Медитация', date) }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /Сделано/ }))

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('/habits/1/log', {
        method: 'PUT',
        body: JSON.stringify({ date, status: 'done' })
      })
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: cellName('Медитация', date) }).textContent).toBe('✓')
  })

  it('switches a day to missed and back to empty', async () => {
    const month = currentMonthKey()
    const date = `${month}-15`
    stubApi(() => [habit({ logs: {} })])
    const user = userEvent.setup()
    render(<HabitsPage />)

    await screen.findByText('Медитация')
    const cell = screen.getByRole('button', { name: cellName('Медитация', date) })

    await user.click(cell)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Пропущено/ }))
    expect(screen.getByRole('button', { name: cellName('Медитация', date) }).textContent).toBe('✕')

    await user.click(screen.getByRole('button', { name: cellName('Медитация', date) }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Пусто/ }))

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('/habits/1/log', {
        method: 'PUT',
        body: JSON.stringify({ date, status: null })
      })
    )
    expect(screen.getByRole('button', { name: cellName('Медитация', date) }).textContent).toBe('·')
  })

  it('changes a status that was already set and keeps flipping it', async () => {
    const month = currentMonthKey()
    const date = `${month}-15`
    stubApi(() => [habit({ logs: { [date]: 'done' } })])
    const user = userEvent.setup()
    render(<HabitsPage />)

    await screen.findByText('Медитация')
    const cell = () => screen.getByRole('button', { name: cellName('Медитация', date) })
    expect(cell().textContent).toBe('✓')

    await user.click(cell())
    expect(screen.getByRole('dialog').parentElement).toBe(document.body)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Пропущено/ }))
    await waitFor(() =>
      expect(mocks.request).toHaveBeenLastCalledWith('/habits/1/log', {
        method: 'PUT',
        body: JSON.stringify({ date, status: 'missed' })
      })
    )
    expect(cell().textContent).toBe('✕')

    await user.click(cell())
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Сделано/ }))
    await waitFor(() =>
      expect(mocks.request).toHaveBeenLastCalledWith('/habits/1/log', {
        method: 'PUT',
        body: JSON.stringify({ date, status: 'done' })
      })
    )
    expect(cell().textContent).toBe('✓')
  })

  it('marks a partial day and shows the monthly progress', async () => {
    const month = currentMonthKey()
    const done = `${month}-10`
    const partialDate = `${month}-11`
    const missed = `${month}-12`
    stubApi(() => [habit({ logs: { [done]: 'done', [partialDate]: 'partial', [missed]: 'missed' } })])
    const user = userEvent.setup()
    render(<HabitsPage />)

    await screen.findByText('Медитация')
    expect(screen.getByRole('button', { name: cellName('Медитация', partialDate) }).textContent).toBe('%')
    // done + partial count as success: 2 of 3 tracked → 67%, per habit and in the footer
    expect(screen.getAllByText('67%')).toHaveLength(2)
    expect(screen.getByText(/2 из 3/)).not.toBeNull()

    await user.click(screen.getByRole('button', { name: cellName('Медитация', missed) }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Частично/ }))
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('/habits/1/log', {
        method: 'PUT',
        body: JSON.stringify({ date: missed, status: 'partial' })
      })
    )
    expect(screen.getByRole('button', { name: cellName('Медитация', missed) }).textContent).toBe('%')
  })

  it('archives a habit after a two-step confirm', async () => {
    stubApi(() => [habit({ logs: {} })])
    const user = userEvent.setup()
    render(<HabitsPage />)

    await screen.findByText('Медитация')
    const del = screen.getByRole('button', { name: 'Удалить Медитация' })
    await user.click(del)
    await user.click(screen.getByRole('button', { name: 'Подтвердить удаление: Медитация' }))

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('/habits/1', { method: 'DELETE' }))
    expect(screen.queryByText('Медитация')).toBeNull()
  })

  it('lists archived habits with stats and restores one', async () => {
    const archived = historyItem({
      id: 7,
      name: 'Бег',
      color: '#fdba74',
      logs: { '2026-01-01': 'done', '2026-01-02': 'partial', '2026-01-03': 'missed' },
      stats: {
        done: 1,
        partial: 1,
        missed: 1,
        tracked: 3,
        completionRate: 67,
        firstDate: '2026-01-01',
        lastDate: '2026-01-03',
        longestDoneStreak: 1
      }
    })
    stubApi(
      () => [],
      () => [archived]
    )
    const user = userEvent.setup()
    render(<HabitsPage />)

    await screen.findByText('Привычек пока нет. Добавьте первую, чтобы вести трекинг.')
    await user.click(screen.getByRole('tab', { name: 'История' }))

    expect(await screen.findByText('Бег')).not.toBeNull()
    expect(screen.getByText('67%')).not.toBeNull()
    expect(screen.getByText('Частично')).not.toBeNull()
    expect(screen.getByText('1 день')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Вернуть привычку: Бег' }))

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('/habits/7/restore', { method: 'POST' }))
    expect(await screen.findByText(/Архив пуст/)).not.toBeNull()
  })

  it('reorders habits by keyboard and writes the new order once', async () => {
    const first = habit({ id: 1, name: 'Первая', sortOrder: 0 })
    const second = habit({ id: 2, name: 'Вторая', sortOrder: 1 })
    stubApi(() => [first, second])
    render(<HabitsPage />)

    await screen.findByText('Первая')
    const rows = () => screen.getAllByRole('row').slice(1).map((row) => row.textContent ?? '')
    expect(rows()[0]).toContain('Первая')

    fireEvent.keyDown(screen.getByRole('button', { name: /Переместить «Вторая»/ }), { key: 'ArrowUp', altKey: true })

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('/habits/order', { method: 'PUT', body: JSON.stringify({ ids: [2, 1] }) })
    )
    expect(rows()[0]).toContain('Вторая')

    mocks.request.mockClear()
    fireEvent.keyDown(screen.getByRole('button', { name: /Переместить «Вторая»/ }), { key: 'ArrowUp' })
    expect(mocks.request).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('button', { name: /Переместить «Вторая»/ }), { key: 'ArrowUp', altKey: true })
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('navigates months and blocks the future', async () => {
    stubApi(() => [])
    const user = userEvent.setup()
    render(<HabitsPage />)

    await screen.findByText('Привычек пока нет. Добавьте первую, чтобы вести трекинг.')
    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toHaveProperty('disabled', true)

    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
    const prev = addMonths(currentMonthKey(), -1)
    expect(await screen.findByText(monthLabel(prev))).not.toBeNull()
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(`/habits?month=${prev}`))
    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toHaveProperty('disabled', false)

    await user.click(screen.getByRole('button', { name: 'Следующий месяц' }))
    expect(await screen.findByText(monthLabel(currentMonthKey()))).not.toBeNull()
  })
})
