import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GoalCard } from '../src/goals/components/GoalCard'
import type { ChecklistItem, GoalWithProgress } from '../src/goals/goals.types'

function makeGoal(over: Partial<GoalWithProgress> = {}): GoalWithProgress {
  return {
    id: 1,
    metric: 'distance',
    targetUnits: 100,
    currency: 'USD',
    deadline: '2026-12-31',
    title: null,
    checklist: [],
    status: 'active',
    createdAt: '2026-09-17 00:00:00',
    achievedAt: null,
    failedAt: null,
    closedAt: null,
    acknowledgedAt: null,
    finalPercent: null,
    finalUnits: null,
    sortOrder: 0,
    progress: { currentUnits: 40, percent: 40, blank: false },
    entries: [
      {
        id: 11,
        goalId: 1,
        kind: 'system',
        content: 'Пройдена половина пути',
        images: [],
        milestone: 50,
        createdAt: '2026-09-17 10:00:00'
      },
      { id: 12, goalId: 1, kind: 'user', content: 'Отличная сессия!', images: [], milestone: null, createdAt: '2026-09-17 12:00:00' }
    ],
    ...over
  }
}

function makeCustomGoal(over: Partial<GoalWithProgress> = {}): GoalWithProgress {
  return makeGoal({
    id: 2,
    metric: 'custom',
    targetUnits: 1,
    deadline: null,
    title: 'Выучить испанский',
    progress: { currentUnits: null, percent: 0, blank: false },
    ...over
  })
}

interface HarnessProps {
  goal: GoalWithProgress
  defaultExpanded?: boolean
  onClose?: (id: number, outcome: 'failed' | 'achieved') => Promise<unknown>
  onAddEntry?: (id: number, content: string, images: string[]) => Promise<unknown>
  onEditEntry?: (id: number, entryId: number, content: string, images: string[]) => Promise<unknown>
  onDeleteEntry?: (id: number, entryId: number) => Promise<unknown>
  onUploadImage?: (file: File) => Promise<string>
  onSetChecklist?: (id: number, items: ChecklistItem[]) => Promise<unknown>
  readOnly?: boolean
}

function Harness({
  goal,
  defaultExpanded = false,
  onClose = async () => undefined,
  onAddEntry = async () => undefined,
  onEditEntry = async () => undefined,
  onDeleteEntry = async () => undefined,
  onUploadImage = async () => '',
  onSetChecklist = async () => undefined,
  readOnly = false
}: HarnessProps) {
  const [checklist, setChecklist] = useState(goal.checklist)
  const applyChecklist = async (id: number, items: ChecklistItem[]) => {
    await onSetChecklist(id, items)
    setChecklist(items)
  }
  return (
    <GoalCard
      goal={{ ...goal, checklist }}
      defaultExpanded={defaultExpanded}
      onClose={onClose}
      onSetChecklist={applyChecklist}
      onAddEntry={onAddEntry}
      onEditEntry={onEditEntry}
      onDeleteEntry={onDeleteEntry}
      onUploadImage={onUploadImage}
      readOnly={readOnly}
    />
  )
}

describe('GoalCard', () => {
  it('starts collapsed and reveals the diary on click', async () => {
    const user = userEvent.setup()
    render(<Harness goal={makeGoal()} />)
    expect(screen.queryByText('Дневник')).toBeNull()
    expect(screen.queryByLabelText('Заметка в дневник')).toBeNull()

    await user.click(screen.getByRole('button', { expanded: false }))

    expect(screen.getByText('Дневник')).toBeTruthy()
    expect(screen.getByLabelText('Заметка в дневник')).toBeTruthy()
  })

  it('renders the card expanded when defaultExpanded is set', () => {
    render(<Harness goal={makeGoal()} defaultExpanded />)
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy()
    expect(screen.getByText('Дневник')).toBeTruthy()
    expect(screen.getByLabelText('Заметка в дневник')).toBeTruthy()
  })

  it('collapses and re-expands a default-expanded card by click', async () => {
    const user = userEvent.setup()
    render(<Harness goal={makeGoal()} defaultExpanded />)
    expect(screen.getByText('Дневник')).toBeTruthy()

    await user.click(screen.getByRole('button', { expanded: true }))
    await waitFor(() => expect(screen.queryByText('Дневник')).toBeNull())
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy()

    await user.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('Дневник')).toBeTruthy()
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy()
  })

  it('hides the diary again when the card collapses', async () => {
    const user = userEvent.setup()
    render(<Harness goal={makeGoal()} />)
    const header = screen.getByRole('button', { expanded: false })
    await user.click(header)
    expect(screen.getByText('Дневник')).toBeTruthy()
    await user.click(screen.getByRole('button', { expanded: true }))
    await waitFor(() => expect(screen.queryByText('Дневник')).toBeNull())
  })

  it('submits a diary note and clears the input', async () => {
    const user = userEvent.setup()
    const onAddEntry = vi.fn().mockResolvedValue(undefined)
    render(<Harness goal={makeGoal()} onAddEntry={onAddEntry} />)
    await user.click(screen.getByRole('button', { expanded: false }))

    const input = screen.getByLabelText('Заметка в дневник')
    await user.type(input, 'Новая запись')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(onAddEntry).toHaveBeenCalledWith(1, expect.stringContaining('Новая запись'), [])
    await waitFor(() => expect(screen.getByLabelText('Заметка в дневник').textContent).toBe(''))
  })

  it('shows the achieved halo only for achieved goals', () => {
    const { rerender } = render(<Harness goal={makeGoal({ status: 'achieved' })} />)
    expect(screen.getByTestId('achieved-halo')).toBeTruthy()

    rerender(<Harness goal={makeGoal({ status: 'active' })} />)
    expect(screen.queryByTestId('achieved-halo')).toBeNull()
  })

  it('renders a time indicator for goals with a deadline', () => {
    render(<Harness goal={makeGoal({ deadline: '2026-12-31' })} />)
    expect(screen.getByText(/Осталось|Остался|Дедлайн/)).toBeTruthy()
  })

  it('renders an elapsed indicator for goals without a deadline', () => {
    render(<Harness goal={makeGoal({ deadline: null })} />)
    expect(screen.getByText(/В процессе:/)).toBeTruthy()
  })

  it('shows only the fail button for auto metrics and sends outcome failed after confirmation', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn().mockResolvedValue(undefined)
    render(<Harness goal={makeGoal()} onClose={onClose} />)
    await user.click(screen.getByRole('button', { expanded: false }))

    const fail = screen.getByRole('button', { name: 'Завершить' })
    expect(screen.queryByRole('button', { name: 'Выполнена' })).toBeNull()
    await user.click(fail)
    expect(onClose).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Завершить' }))
    expect(onClose).toHaveBeenCalledWith(1, 'failed')
  })

  it('shows both buttons for a custom goal and sends the right outcomes after confirmation', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn().mockResolvedValue(undefined)
    render(<Harness goal={makeCustomGoal()} onClose={onClose} />)
    await user.click(screen.getByRole('button', { expanded: false }))

    await user.click(screen.getByRole('button', { name: 'Выполнена' }))
    const achievedDialog = await screen.findByRole('dialog')
    await user.click(within(achievedDialog).getByRole('button', { name: 'Выполнена' }))
    expect(onClose).toHaveBeenCalledWith(2, 'achieved')

    await user.click(screen.getByRole('button', { name: 'Завершить' }))
    const failedDialog = await screen.findByRole('dialog')
    await user.click(within(failedDialog).getByRole('button', { name: 'Завершить' }))
    expect(onClose).toHaveBeenCalledWith(2, 'failed')
  })

  it('opens the outcome dialog from the cross and closes with the chosen outcome', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn().mockResolvedValue(undefined)
    render(<Harness goal={makeGoal()} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Закрыть цель' }))
    expect(onClose).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog', { name: 'Итог цели' })
    await user.click(within(dialog).getByRole('button', { name: 'Провалена' }))
    expect(onClose).toHaveBeenCalledWith(1, 'failed')
  })

  it('cancels the outcome dialog without closing the goal', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn().mockResolvedValue(undefined)
    render(<Harness goal={makeGoal()} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Закрыть цель' }))
    const dialog = await screen.findByRole('dialog', { name: 'Итог цели' })
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }))

    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('renders a read-only history card without close controls or composer', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        readOnly
        goal={makeGoal({ status: 'failed', failedAt: '2026-09-20 10:00:00', finalPercent: 40, finalUnits: 40 })}
      />
    )

    expect(screen.queryByRole('button', { name: 'Закрыть цель' })).toBeNull()

    await user.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('Дневник')).toBeTruthy()
    expect(screen.queryByLabelText('Заметка в дневник')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Завершить' })).toBeNull()
    expect(screen.getByText(/Не достигнута ·/)).toBeTruthy()
  })

  it('renders the custom title and the binary ring instead of a percent', () => {
    render(<Harness goal={makeCustomGoal()} />)
    expect(screen.getByText('Выучить испанский')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Бинарная цель' })).toBeTruthy()
  })

  it('shows the checklist section in the expanded card', async () => {
    const user = userEvent.setup()
    render(<Harness goal={makeGoal({ checklist: [{ id: 'a', text: 'гигиена', status: 'pending' }] })} />)
    expect(screen.queryByText('Чеклист')).toBeNull()
    await user.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('Чеклист')).toBeTruthy()
    expect(screen.getByLabelText('Новый пункт')).toBeTruthy()
  })

  it('adds a checklist item and calls the handler with the merged list', async () => {
    const user = userEvent.setup()
    const onSetChecklist = vi.fn().mockResolvedValue(undefined)
    render(<Harness goal={makeGoal()} onSetChecklist={onSetChecklist} />)
    await user.click(screen.getByRole('button', { expanded: false }))

    const input = screen.getByLabelText('Новый пункт')
    await user.type(input, 'разобрать руки')
    await user.click(screen.getByRole('button', { name: 'Добавить пункт' }))

    expect(onSetChecklist).toHaveBeenCalledTimes(1)
    const [id, items] = onSetChecklist.mock.calls[0] as [number, ChecklistItem[]]
    expect(id).toBe(1)
    expect(items).toEqual([{ id: expect.any(String), text: 'разобрать руки', status: 'pending' }])
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''))
  })

  it('sets a checklist item status through the popover menu', async () => {
    const user = userEvent.setup()
    const onSetChecklist = vi.fn().mockResolvedValue(undefined)
    const items = [
      { id: 'a', text: 'гигиена', status: 'pending' as const },
      { id: 'b', text: 'разбор', status: 'pending' as const }
    ]
    render(<Harness goal={makeGoal({ checklist: items })} onSetChecklist={onSetChecklist} />)
    await user.click(screen.getByRole('button', { expanded: false }))

    await user.click(screen.getByRole('button', { name: 'гигиена' }))
    await user.click(screen.getByRole('menuitem', { name: 'Выполнено' }))
    expect(onSetChecklist).toHaveBeenLastCalledWith(1, [
      { id: 'a', text: 'гигиена', status: 'completed' },
      { id: 'b', text: 'разбор', status: 'pending' }
    ])

    await user.click(screen.getByRole('button', { name: 'Удалить пункт «разбор»' }))
    expect(onSetChecklist).toHaveBeenLastCalledWith(1, [{ id: 'a', text: 'гигиена', status: 'completed' }])
  })

  it('offers a reset option only when the item has a status', async () => {
    const user = userEvent.setup()
    const onSetChecklist = vi.fn().mockResolvedValue(undefined)
    render(
      <Harness
        goal={makeGoal({ checklist: [{ id: 'a', text: 'гигиена', status: 'completed' }] })}
        onSetChecklist={onSetChecklist}
      />
    )
    await user.click(screen.getByRole('button', { expanded: false }))

    await user.click(screen.getByRole('button', { name: 'гигиена' }))
    expect(screen.getByRole('menuitem', { name: 'Очистить' })).toBeTruthy()
    await user.click(screen.getByRole('menuitem', { name: 'Очистить' }))
    expect(onSetChecklist).toHaveBeenLastCalledWith(1, [{ id: 'a', text: 'гигиена', status: 'pending' }])
  })

  it('drives custom goal progress from the checklist and shows a percent ring', () => {
    render(
      <Harness
        goal={makeCustomGoal({
          checklist: [
            { id: 'a', text: 'двери', status: 'completed' },
            { id: 'b', text: 'окна', status: 'completed' },
            { id: 'c', text: 'обои', status: 'pending' }
          ],
          progress: { currentUnits: 2, percent: 66, blank: false }
        })}
      />
    )
    expect(screen.getByText('2 из 3 пунктов')).toBeTruthy()
    expect(screen.getByRole('img', { name: /Прогресс/ })).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'Бинарная цель' })).toBeNull()
  })

  it('hides the manual achieved button for a custom goal with a checklist', async () => {
    const user = userEvent.setup()
    render(<Harness goal={makeCustomGoal({ checklist: [{ id: 'a', text: 'шаг', status: 'pending' }] })} />)
    await user.click(screen.getByRole('button', { expanded: false }))
    expect(screen.queryByRole('button', { name: 'Выполнена' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Завершить' })).toBeTruthy()
  })

  it('edits a user note in place and sends the new content', async () => {
    const user = userEvent.setup()
    const onEditEntry = vi.fn().mockResolvedValue(undefined)
    render(<Harness goal={makeGoal()} onEditEntry={onEditEntry} />)
    await user.click(screen.getByRole('button', { expanded: false }))

    await user.click(screen.getByRole('button', { name: 'Редактировать запись' }))
    const editor = screen.getByLabelText('Редактирование заметки')
    await user.clear(editor)
    await user.type(editor, 'Отредактировано')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(onEditEntry).toHaveBeenCalledWith(1, 12, expect.stringContaining('Отредактировано'), [])
  })

  it('renders a rich user note sanitized and keeps styling text', async () => {
    const user = userEvent.setup()
    const entry = {
      id: 12,
      goalId: 1,
      kind: 'user' as const,
      content: '<p>Жирный <strong>акцент</strong> и <mark>маркер</mark></p><script>alert(1)</script>',
      images: [],
      milestone: null,
      createdAt: '2026-09-17 12:00:00'
    }
    render(<Harness goal={makeGoal({ entries: [entry] })} />)
    await user.click(screen.getByRole('button', { expanded: false }))

    expect(screen.getByText('акцент')).toBeTruthy()
    expect(screen.getByText('маркер')).toBeTruthy()
    expect(document.querySelector('script')).toBeNull()
  })

  it('renders a legacy plain-text note as text', async () => {
    const user = userEvent.setup()
    const entry = {
      id: 12,
      goalId: 1,
      kind: 'user' as const,
      content: 'простая запись\nв две строки',
      images: [],
      milestone: null,
      createdAt: '2026-09-17 12:00:00'
    }
    render(<Harness goal={makeGoal({ entries: [entry] })} />)
    await user.click(screen.getByRole('button', { expanded: false }))

    expect(screen.getByText(/простая запись\s+в две строки/)).toBeTruthy()
  })

  it('deletes a user note only after confirmation', async () => {
    const user = userEvent.setup()
    const onDeleteEntry = vi.fn().mockResolvedValue(undefined)
    render(<Harness goal={makeGoal()} onDeleteEntry={onDeleteEntry} />)
    await user.click(screen.getByRole('button', { expanded: false }))

    await user.click(screen.getByRole('button', { name: 'Удалить запись' }))
    expect(onDeleteEntry).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }))
    expect(onDeleteEntry).toHaveBeenCalledWith(1, 12)
  })

  it('opens an attached image in the lightbox and closes it on Escape', async () => {
    const user = userEvent.setup()
    const entry = {
      id: 12,
      goalId: 1,
      kind: 'user' as const,
      content: 'со скрином',
      images: ['diary/abc.png'],
      milestone: null,
      createdAt: '2026-09-17 12:00:00'
    }
    render(<Harness goal={makeGoal({ entries: [entry] })} />)
    await user.click(screen.getByRole('button', { expanded: false }))

    await user.click(screen.getByRole('button', { name: 'Открыть изображение' }))
    const lightbox = await screen.findByRole('dialog', { name: 'Просмотр изображения' })
    expect(lightbox).toBeTruthy()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Просмотр изображения' })).toBeNull())
  })
})