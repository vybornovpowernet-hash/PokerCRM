import { StrictMode, useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GoalCard } from '../src/goals/components/GoalCard'
import type { ChecklistItem, GoalWithProgress } from '../src/goals/goals.types'
import { blobUrls } from './setup'

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
    startDay: '2026-09-17',
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
  it('starts collapsed, reveals the diary on click and keeps the composer hidden until edit', async () => {
    const user = userEvent.setup()
    render(<Harness goal={makeGoal()} />)
    expect(screen.queryByText('Дневник')).toBeNull()
    expect(screen.queryByLabelText('Заметка в дневник')).toBeNull()

    await user.click(screen.getByRole('button', { expanded: false }))

    expect(screen.getByText('Дневник')).toBeTruthy()
    expect(screen.queryByLabelText('Заметка в дневник')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Редактировать цель' }))
    expect(screen.getByLabelText('Заметка в дневник')).toBeTruthy()
  })

  it('renders the card expanded when defaultExpanded is set', () => {
    render(<Harness goal={makeGoal()} defaultExpanded />)
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy()
    expect(screen.getByText('Дневник')).toBeTruthy()
    expect(screen.queryByLabelText('Заметка в дневник')).toBeNull()
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

  it('reveals the card from the pencil and collapses it with the chevron', async () => {
    const user = userEvent.setup()
    render(<Harness goal={makeGoal()} />)
    expect(screen.queryByText('Дневник')).toBeNull()

    await user.click(screen.getByLabelText('Редактировать цель'))
    expect(screen.getByText('Дневник')).toBeTruthy()
    expect(screen.getByLabelText('Заметка в дневник')).toBeTruthy()

    await user.click(screen.getByLabelText('Свернуть'))
    await waitFor(() => expect(screen.queryByText('Дневник')).toBeNull())
    expect(screen.queryByLabelText('Заметка в дневник')).toBeNull()
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy()
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

  it('locks the note editor while the upload is in flight and unlocks it after', async () => {
    const user = userEvent.setup()
    let release: () => void = () => undefined
    const onUploadImage = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('diary/lock.png')
        })
    )
    const onAddEntry = vi.fn().mockResolvedValue(undefined)
    render(<Harness goal={makeGoal()} onUploadImage={onUploadImage} onAddEntry={onAddEntry} />)
    const editor = await openComposer(user)

    pasteImage(editor, png('lock.png'))
    await user.type(editor, 'Текст до блокировки')
    expect(editor.getAttribute('contenteditable')).toBe('true')

    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    // Пока идёт сохранение, ввод заблокирован, панель форматирования недоступна:
    // иначе набранное поверх сохранения стирается и теряется вместе с ним.
    await waitFor(() => expect(editor.getAttribute('contenteditable')).toBe('false'))
    expect(screen.getByRole('toolbar', { name: 'Форматирование' }).hasAttribute('inert')).toBe(true)
    expect(onAddEntry).not.toHaveBeenCalled()

    release()
    await waitFor(() => expect(onAddEntry).toHaveBeenCalledTimes(1))
    expect(onAddEntry).toHaveBeenCalledWith(1, expect.any(String), ['diary/lock.png'])
  })

  it('re-opens the editor, empty, after a successful save', async () => {
    const user = userEvent.setup()
    const onUploadImage = vi.fn().mockResolvedValue('diary/ok.png')
    const onAddEntry = vi.fn().mockResolvedValue(undefined)
    render(<Harness goal={makeGoal()} onUploadImage={onUploadImage} onAddEntry={onAddEntry} />)
    const editor = await openComposer(user)

    pasteImage(editor, png('ok.png'))
    await user.type(editor, 'Готовая заметка')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    await waitFor(() => expect(screen.getByLabelText('Заметка в дневник').textContent).toBe(''))
    const fresh = screen.getByLabelText('Заметка в дневник')
    expect(fresh.getAttribute('contenteditable')).toBe('true')
    expect(screen.getByRole('button', { name: 'Добавить' }).hasAttribute('disabled')).toBe(true)
    expect(previews()).toHaveLength(0)
    expect(screen.getByRole('toolbar', { name: 'Форматирование' }).hasAttribute('inert')).toBe(false)
  })

  it('keeps the draft text editable and intact after a failed upload', async () => {
    const user = userEvent.setup()
    const onUploadImage = vi.fn().mockRejectedValue(new Error('offline'))
    const onAddEntry = vi.fn()
    render(<Harness goal={makeGoal()} onUploadImage={onUploadImage} onAddEntry={onAddEntry} />)
    const editor = await openComposer(user)

    pasteImage(editor, png('bad.png'))
    await user.type(editor, 'Не отправилось')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Не удалось загрузить изображение')
    await waitFor(() => expect(editor.getAttribute('contenteditable')).toBe('true'))
    expect(editor.textContent).toBe('Не отправилось')
    expect(previews()).toHaveLength(1)
    expect(onAddEntry).not.toHaveBeenCalled()
  })

  it('does not resurrect a saved note through undo', async () => {
    const user = userEvent.setup()
    const onUploadImage = vi.fn().mockResolvedValue('diary/undo.png')
    const onAddEntry = vi.fn().mockResolvedValue(undefined)
    render(<Harness goal={makeGoal()} onUploadImage={onUploadImage} onAddEntry={onAddEntry} />)
    await openComposer(user)

    const typed = screen.getByLabelText('Заметка в дневник')
    await user.type(typed, 'Уже сохранено')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    // После сохранения редактор — новый экземпляр с пустой историей, поэтому
    // держимся только за актуальный узел, а не за тот, в котором печатали.
    const editor = await waitFor(() => {
      const fresh = screen.getByLabelText('Заметка в дневник')
      expect(fresh.textContent).toBe('')
      return fresh
    })
    expect(onAddEntry).toHaveBeenCalledTimes(1)

    await user.click(editor)
    await user.keyboard('{Control>}{z}{/Control}')

    // Отмена не должна вернуть в черновик уже сохранённый текст: иначе кнопка
    // снова станет активной и тот же текст уйдёт второй записью.
    expect(editor.textContent).toBe('')
    expect(screen.getByRole('button', { name: 'Добавить' }).hasAttribute('disabled')).toBe(true)
    expect(onAddEntry).toHaveBeenCalledTimes(1)

    // Негативный контроль: ввод и отмена в этом же узле работают.
    await user.type(editor, 'абв')
    expect(editor.textContent).toBe('абв')
    await user.keyboard('{Control>}{z}{/Control}')
    expect(editor.textContent).toBe('')
  })

  it('submits a diary note and clears the input', async () => {
    const user = userEvent.setup()
    const onAddEntry = vi.fn().mockResolvedValue(undefined)
    render(<Harness goal={makeGoal()} onAddEntry={onAddEntry} />)
    await user.click(screen.getByRole('button', { expanded: false }))
    await user.click(screen.getByRole('button', { name: 'Редактировать цель' }))

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

    await user.click(screen.getByRole('button', { name: 'Редактировать цель' }))
    expect(screen.getByLabelText('Заметка в дневник')).toBeTruthy()
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
    expect(screen.getByLabelText('гигиена')).toBeTruthy()
    expect(screen.queryByLabelText('Новый пункт')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Редактировать цель' }))
    expect(screen.getByLabelText('Новый пункт')).toBeTruthy()
  })

  it('adds a checklist item and calls the handler with the merged list', async () => {
    const user = userEvent.setup()
    const onSetChecklist = vi.fn().mockResolvedValue(undefined)
    render(<Harness goal={makeGoal()} onSetChecklist={onSetChecklist} />)
    await user.click(screen.getByRole('button', { expanded: false }))
    await user.click(screen.getByRole('button', { name: 'Редактировать цель' }))

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

  it('steps through the attached images inside the lightbox', async () => {
    const user = userEvent.setup()
    const entry = {
      id: 12,
      goalId: 1,
      kind: 'user' as const,
      content: 'три скрина',
      images: ['diary/a.png', 'diary/b.png', 'diary/c.png'],
      milestone: null,
      createdAt: '2026-09-17 12:00:00'
    }
    render(<Harness goal={makeGoal({ entries: [entry] })} />)
    await user.click(screen.getByRole('button', { expanded: false }))
    await user.click(screen.getAllByRole('button', { name: 'Открыть изображение' })[0]!)

    const image = () => screen.getByAltText('Изображение') as HTMLImageElement
    const prev = () => screen.getByRole('button', { name: 'Предыдущее изображение' }) as HTMLButtonElement
    const next = () => screen.getByRole('button', { name: 'Следующее изображение' }) as HTMLButtonElement

    expect(image().getAttribute('src')).toBe('/uploads/diary/a.png')
    expect(prev().disabled).toBe(true)
    expect(screen.getByText('1 / 3')).toBeTruthy()

    await user.click(next())
    expect(image().getAttribute('src')).toBe('/uploads/diary/b.png')
    expect(screen.getByText('2 / 3')).toBeTruthy()

    await user.click(next())
    expect(image().getAttribute('src')).toBe('/uploads/diary/c.png')
    expect(next().disabled).toBe(true)

    await user.click(prev())
    expect(image().getAttribute('src')).toBe('/uploads/diary/b.png')
  })

  it('locks the page scroll while the lightbox is open', async () => {
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
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.body.style.overflow).toBe(''))
  })

  const png = (name: string) => new File(['png'], name, { type: 'image/png' })

  async function openComposer(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    await user.click(screen.getByRole('button', { expanded: false }))
    await user.click(screen.getByRole('button', { name: 'Редактировать цель' }))
    return screen.getByLabelText('Заметка в дневник')
  }

  function pasteImage(editor: HTMLElement, file: File): void {
    fireEvent.paste(editor, {
      clipboardData: { files: [file], items: [{ kind: 'file', type: file.type, getAsFile: () => file }], getData: () => '' }
    })
  }

  function pickFiles(files: File[]): void {
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files } })
  }

  const previews = () => screen.queryAllByAltText('Вложение')
  const savedUrls = (url: string) => blobUrls.revoked.filter((u) => u === url).length
  // Столько же, сколько разрешает композер и сервер (server/src/services/goals/service.ts).
  const MAX_IMAGES = 10

  it('keeps a pasted image in the browser and uploads it only when the note is saved', async () => {
    const user = userEvent.setup()
    const onUploadImage = vi.fn().mockResolvedValue('diary/pasted.png')
    const onAddEntry = vi.fn().mockResolvedValue(undefined)
    render(<Harness goal={makeGoal()} onUploadImage={onUploadImage} onAddEntry={onAddEntry} />)
    const editor = await openComposer(user)

    const file = png('shot.png')
    pasteImage(editor, file)

    expect(previews()).toHaveLength(1)
    expect(previews()[0]?.getAttribute('src')).toMatch(/^blob:/)
    expect(onUploadImage).not.toHaveBeenCalled()

    await user.type(editor, 'Заметка')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1))
    expect(onUploadImage).toHaveBeenCalledWith(file)
    expect(onAddEntry).toHaveBeenCalledWith(1, expect.any(String), ['diary/pasted.png'])
  })

  it('adds exactly one attachment per pasted image', async () => {
    const user = userEvent.setup()
    const onUploadImage = vi.fn()
    render(<Harness goal={makeGoal()} onUploadImage={onUploadImage} />)
    const editor = await openComposer(user)

    pasteImage(editor, png('one.png'))

    expect(previews()).toHaveLength(1)
    expect(onUploadImage).not.toHaveBeenCalled()
  })

  it('uploads every local image once and hands the note the paths in the visible order', async () => {
    const user = userEvent.setup()
    const order: string[] = []
    const onUploadImage = vi.fn(async (file: File) => {
      order.push(`upload:${file.name}`)
      return `diary/${file.name}`
    })
    const onAddEntry = vi.fn(async () => {
      order.push('entry')
    })
    render(<Harness goal={makeGoal()} onUploadImage={onUploadImage} onAddEntry={onAddEntry} />)
    const editor = await openComposer(user)

    pasteImage(editor, png('a.png'))
    pickFiles([png('b.png')])
    await user.type(editor, 'Две картинки')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    await waitFor(() => expect(onAddEntry).toHaveBeenCalled())
    expect(order).toEqual(['upload:a.png', 'upload:b.png', 'entry'])
    expect(onAddEntry).toHaveBeenCalledWith(1, expect.any(String), ['diary/a.png', 'diary/b.png'])
  })

  it('removes an attachment without a server call and frees exactly its blob url', async () => {
    const user = userEvent.setup()
    const onUploadImage = vi.fn()
    render(<Harness goal={makeGoal()} onUploadImage={onUploadImage} />)
    const editor = await openComposer(user)

    pasteImage(editor, png('gone.png'))
    const url = previews()[0]?.getAttribute('src') ?? ''
    expect(url).toMatch(/^blob:/)

    await user.click(screen.getByRole('button', { name: 'Убрать изображение' }))

    expect(previews()).toHaveLength(0)
    expect(onUploadImage).not.toHaveBeenCalled()
    expect(savedUrls(url)).toBe(1)
  })

  it('keeps the draft when an upload fails and the retry uploads only the missing file', async () => {
    const user = userEvent.setup()
    const onUploadImage = vi.fn().mockResolvedValueOnce('diary/first.png').mockRejectedValueOnce(new Error('network'))
    const onAddEntry = vi.fn()
    render(<Harness goal={makeGoal()} onUploadImage={onUploadImage} onAddEntry={onAddEntry} />)
    const editor = await openComposer(user)

    const first = png('first.png')
    const second = png('second.png')
    pasteImage(editor, first)
    pasteImage(editor, second)
    const firstUrl = previews()[0]?.getAttribute('src') ?? ''
    await user.type(editor, 'Половина загрузилась')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(onAddEntry).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Заметка в дневник').textContent).toBe('Половина загрузилась')
    expect(previews()).toHaveLength(2)

    onUploadImage.mockResolvedValue('diary/second.png')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    await waitFor(() => expect(onAddEntry).toHaveBeenCalled())
    expect(onUploadImage).toHaveBeenCalledTimes(3)
    expect((onUploadImage.mock.calls[2]![0] as File).name).toBe('second.png')
    expect(onAddEntry).toHaveBeenCalledWith(1, expect.any(String), ['diary/first.png', 'diary/second.png'])
    expect(savedUrls(firstUrl)).toBe(1)
  })

  it('lets an already uploaded attachment be dropped, leaving the remaining paths', async () => {
    const user = userEvent.setup()
    const onUploadImage = vi.fn(async (file: File) => `diary/${file.name}`)
    const onAddEntry = vi.fn().mockRejectedValue(new Error('offline'))
    render(<Harness goal={makeGoal()} onUploadImage={onUploadImage} onAddEntry={onAddEntry} />)
    const editor = await openComposer(user)

    pasteImage(editor, png('left.png'))
    pasteImage(editor, png('dropped.png'))
    await user.type(editor, 'Оба загружены, заметка не сохранилась')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await screen.findByRole('alert')

    await user.click(screen.getAllByRole('button', { name: 'Убрать изображение' })[1]!)

    onAddEntry.mockResolvedValue(undefined)
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(onAddEntry).toHaveBeenCalledTimes(2))
    expect(onAddEntry).toHaveBeenLastCalledWith(1, expect.any(String), ['diary/left.png'])
    // оба файла уже были загружены в первой попытке — второй прогон загрузок не делает
    expect(onUploadImage).toHaveBeenCalledTimes(2)
  })

  it('resets the form and re-enables the button after saving inside StrictMode', async () => {
    const user = userEvent.setup()
    const onUploadImage = vi.fn().mockResolvedValue('diary/twice.png')
    const onAddEntry = vi.fn().mockResolvedValue(undefined)
    render(
      <StrictMode>
        <Harness goal={makeGoal()} onUploadImage={onUploadImage} onAddEntry={onAddEntry} />
      </StrictMode>
    )
    const editor = await openComposer(user)

    pasteImage(editor, png('twice.png'))
    await user.type(editor, 'Проверка в StrictMode')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    // Форма обязана сброситься и разблокироваться даже после двойного вызова эффектов.
    await waitFor(() => expect(screen.getByLabelText('Заметка в дневник').textContent).toBe(''))
    expect(previews()).toHaveLength(0)
    expect(onAddEntry).toHaveBeenCalledTimes(1)
    // Кнопка вернулась из «Сохраняется…»: значит setSaving(false) до пользователя дошёл.
    const add = screen.getByRole('button', { name: 'Добавить' })
    // Пустое поле по правилам формы недоступно — проверяем возобновляемость вводом.
    expect(add.hasAttribute('disabled')).toBe(true)
    await user.type(screen.getByLabelText('Заметка в дневник'), 'Второй раз')
    expect((screen.getByRole('button', { name: 'Добавить' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps every image from three pastes made in one act', async () => {
    const user = userEvent.setup()
    const onUploadImage = vi.fn()
    render(<Harness goal={makeGoal()} onUploadImage={onUploadImage} />)
    const editor = await openComposer(user)

    await act(async () => {
      pasteImage(editor, png('a.png'))
      pasteImage(editor, png('b.png'))
      pasteImage(editor, png('c.png'))
    })

    const urls = previews().map((img) => img.getAttribute('src') ?? '')
    expect(urls).toHaveLength(3)
    expect(new Set(urls).size).toBe(3)
    expect(onUploadImage).not.toHaveBeenCalled()

    await act(async () => {
      for (let i = 0; i < 8; i++) pasteImage(editor, png(`fill-${i}.png`))
    })
    expect(previews()).toHaveLength(MAX_IMAGES)
  })

  it('ignores a second submit while the first one is still running', async () => {
    const user = userEvent.setup()
    let release: () => void = () => undefined
    const onUploadImage = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('diary/once.png')
        })
    )
    const onAddEntry = vi.fn().mockResolvedValue(undefined)
    render(<Harness goal={makeGoal()} onUploadImage={onUploadImage} onAddEntry={onAddEntry} />)
    const editor = await openComposer(user)

    pasteImage(editor, png('once.png'))
    await user.type(editor, 'Один раз')

    const add = screen.getByRole('button', { name: 'Добавить' })
    // Два клика в одном act: перерисовки между ними нет, кнопка ещё не успела
    // стать отключённой — от двойного входа защищает только флаг в ref.
    await act(async () => {
      add.click()
      add.click()
    })

    expect(onUploadImage).toHaveBeenCalledTimes(1)
    release()
    await waitFor(() => expect(onAddEntry).toHaveBeenCalledTimes(1))
    expect(onAddEntry).toHaveBeenCalledWith(1, expect.any(String), ['diary/once.png'])
  })

  it('frees every blob url when the form closes without saving, uploading nothing', async () => {
    const user = userEvent.setup()
    const onUploadImage = vi.fn()
    render(<Harness goal={makeGoal()} defaultExpanded onUploadImage={onUploadImage} />)
    await user.click(screen.getByRole('button', { name: 'Редактировать цель' }))
    const editor = screen.getByLabelText('Заметка в дневник')

    pasteImage(editor, png('a.png'))
    pasteImage(editor, png('b.png'))
    const urls = previews().map((img) => img.getAttribute('src') ?? '')

    await user.click(screen.getByLabelText('Свернуть'))
    await waitFor(() => expect(screen.queryByLabelText('Заметка в дневник')).toBeNull())

    expect(onUploadImage).not.toHaveBeenCalled()
    expect(urls).toHaveLength(2)
    expect(urls.every((url) => savedUrls(url) === 1)).toBe(true)
  })

  it('finishes an in-flight save after the form unmounts and frees each blob url once', async () => {
    const user = userEvent.setup()
    let release: () => void = () => undefined
    const onUploadImage = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('diary/late.png')
        })
    )
    const onAddEntry = vi.fn().mockResolvedValue(undefined)
    render(<Harness goal={makeGoal()} defaultExpanded onUploadImage={onUploadImage} onAddEntry={onAddEntry} />)
    await user.click(screen.getByRole('button', { name: 'Редактировать цель' }))
    const editor = screen.getByLabelText('Заметка в дневник')

    pasteImage(editor, png('late.png'))
    const url = previews()[0]?.getAttribute('src') ?? ''
    await user.type(editor, 'Успеем закрыть')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    await user.click(screen.getByLabelText('Свернуть'))
    await waitFor(() => expect(screen.queryByLabelText('Заметка в дневник')).toBeNull())
    expect(onAddEntry).not.toHaveBeenCalled()

    release()
    await waitFor(() => expect(onAddEntry).toHaveBeenCalledTimes(1))
    expect(onAddEntry).toHaveBeenCalledWith(1, expect.any(String), ['diary/late.png'])
    expect(savedUrls(url)).toBe(1)
  })

  it('offers a partial status through the popover menu', async () => {
    const user = userEvent.setup()
    const onSetChecklist = vi.fn().mockResolvedValue(undefined)
    render(<Harness goal={makeGoal({ checklist: [{ id: 'a', text: 'гигиена', status: 'pending' }] })} onSetChecklist={onSetChecklist} />)
    await user.click(screen.getByRole('button', { expanded: false }))

    await user.click(screen.getByRole('button', { name: 'гигиена' }))
    await user.click(screen.getByRole('menuitem', { name: 'Частично' }))
    expect(onSetChecklist).toHaveBeenLastCalledWith(1, [{ id: 'a', text: 'гигиена', status: 'partial' }])
  })

  it('keeps a history card locked until edit mode, then unlocks editing', async () => {
    const user = userEvent.setup()
    const onSetChecklist = vi.fn().mockResolvedValue(undefined)
    render(
      <Harness
        readOnly
        onSetChecklist={onSetChecklist}
        goal={makeGoal({
          status: 'failed',
          failedAt: '2026-09-20 10:00:00',
          finalPercent: 0,
          finalUnits: 0,
          checklist: [{ id: 'a', text: 'гигиена', status: 'pending' }]
        })}
      />
    )
    await user.click(screen.getByRole('button', { expanded: false }))

    await user.click(screen.getByRole('button', { name: 'гигиена' }))
    expect(screen.queryByRole('menuitem', { name: 'Выполнено' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Редактировать цель' }))
    await user.click(screen.getByRole('button', { name: 'гигиена' }))
    await user.click(screen.getByRole('menuitem', { name: 'Выполнено' }))
    expect(onSetChecklist).toHaveBeenCalledWith(1, [{ id: 'a', text: 'гигиена', status: 'completed' }])
  })
})