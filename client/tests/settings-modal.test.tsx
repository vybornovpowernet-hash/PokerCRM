import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from '../src/components/SettingsModal'
import { openOptionLabels, pickOption, selectTrigger, selectValue } from './select-helper'

/** Дефолт модалки: ровно те же 13 значений, что отдаёт серверный `dayStartHour` 0..12. */
const HOURS_LABELS = Array.from({ length: 13 }, (_, h) => `${String(h).padStart(2, '0')}:00`)

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  version: vi.fn(),
  checkUpdates: vi.fn(),
  runUpdate: vi.fn()
}))

vi.mock('../src/lib/api', () => ({
  api: {
    settings: {
      get: mocks.get,
      update: mocks.update
    },
    system: {
      version: mocks.version,
      checkUpdates: mocks.checkUpdates,
      update: mocks.runUpdate
    }
  }
}))

const availableUpdate = {
  hasUpdate: true,
  currentVersion: '1.0.0',
  latestVersion: '1.2.0',
  releaseUrl: 'https://github.com/vybornovpowernet-hash/PokerCRM/releases/tag/v1.2.0',
  releaseNotes: 'Добавлено X'
}

beforeEach(() => {
  mocks.get.mockReset()
  mocks.update.mockReset()
  mocks.version.mockReset()
  mocks.checkUpdates.mockReset()
  mocks.runUpdate.mockReset()
  mocks.version.mockResolvedValue({ version: '1.0.0', repository: 'vybornovpowernet-hash/PokerCRM' })
})

describe('SettingsModal', () => {
  it('loads the current boundary and offers 00:00..12:00', async () => {
    mocks.get.mockResolvedValue({ dayStartHour: 6 })
    render(<SettingsModal onClose={() => undefined} />)

    // раньше проверяли `select.value` и 13 `<option>` в DOM; теперь значение — подпись триггера,
    // а состав меню виден только когда список открыт
    await waitFor(() => expect(selectValue('Начало игровых суток')).toBe('06:00'))
    await userEvent.setup().click(selectTrigger('Начало игровых суток'))
    expect(openOptionLabels()).toEqual(HOURS_LABELS)
    expect(screen.getByRole('listbox').className).toContain('bg-slate-900')
    expect(document.querySelector('select')).toBeNull()
  })

  it('saves the new boundary on change', async () => {
    mocks.get.mockResolvedValue({ dayStartHour: 0 })
    mocks.update.mockResolvedValue({ dayStartHour: 6 })
    const user = userEvent.setup()
    render(<SettingsModal onClose={() => undefined} />)

    await pickOption(user, 'Начало игровых суток', '06:00')

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(6))
    expect(screen.queryByText('Сохранено')).not.toBeNull()
  })

  it('Escape закрывает список, а не модалку: второй Escape закрывает модалку', async () => {
    const onClose = vi.fn()
    mocks.get.mockResolvedValue({ dayStartHour: 0 })
    const user = userEvent.setup()
    render(<SettingsModal onClose={onClose} />)
    await waitFor(() => expect(selectValue('Начало игровых суток')).toBe('00:00'))

    // у нативного `<select>` Escape закрывал только меню и до страницы не доходил —
    // кастомный список обязан сохранять это поведение, иначе настройка терялась бы от Esc
    await user.click(selectTrigger('Начало игровых суток'))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the current application version', async () => {
    mocks.get.mockResolvedValue({ dayStartHour: 0 })
    render(<SettingsModal onClose={() => undefined} />)

    expect(await screen.findByText('v1.0.0')).not.toBeNull()
  })

  it('reports an available update with a link to the release', async () => {
    mocks.get.mockResolvedValue({ dayStartHour: 0 })
    mocks.checkUpdates.mockResolvedValue(availableUpdate)
    const user = userEvent.setup()
    render(<SettingsModal onClose={() => undefined} />)

    await user.click(screen.getByRole('button', { name: 'Проверить обновление' }))

    expect(await screen.findByText('Доступна версия v1.2.0')).not.toBeNull()
    const link = screen.getByRole('link', { name: /Открыть на GitHub/ }) as HTMLAnchorElement
    expect(link.href).toContain('/releases/tag/v1.2.0')
  })

  it('downloads and installs the update, showing the restart notice', async () => {
    mocks.get.mockResolvedValue({ dayStartHour: 0 })
    mocks.checkUpdates.mockResolvedValue(availableUpdate)
    mocks.runUpdate.mockResolvedValue({ ok: true, files: 12, message: 'Обновление загружено.' })
    const user = userEvent.setup()
    render(<SettingsModal onClose={() => undefined} />)

    await user.click(screen.getByRole('button', { name: 'Проверить обновление' }))
    const button = await screen.findByRole('button', { name: 'Скачать и обновить' })
    await user.click(button)

    await waitFor(() => expect(mocks.runUpdate).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/Программа перезапустится автоматически/)).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Скачать и обновить' })).toBeNull()
  })

  it('shows an error and re-enables the button when the update fails', async () => {
    mocks.get.mockResolvedValue({ dayStartHour: 0 })
    mocks.checkUpdates.mockResolvedValue(availableUpdate)
    mocks.runUpdate.mockRejectedValue(new Error('GitHub вернул статус 502'))
    const user = userEvent.setup()
    render(<SettingsModal onClose={() => undefined} />)

    await user.click(screen.getByRole('button', { name: 'Проверить обновление' }))
    await user.click(await screen.findByRole('button', { name: 'Скачать и обновить' }))

    expect(await screen.findByText('GitHub вернул статус 502')).not.toBeNull()
    expect(await screen.findByRole('button', { name: 'Скачать и обновить' })).not.toBeNull()
  })

  it('reports an up-to-date install when no update is available', async () => {
    mocks.get.mockResolvedValue({ dayStartHour: 0 })
    mocks.checkUpdates.mockResolvedValue({
      hasUpdate: false,
      currentVersion: '1.0.0',
      latestVersion: '1.0.0',
      releaseUrl: null,
      releaseNotes: null
    })
    const user = userEvent.setup()
    render(<SettingsModal onClose={() => undefined} />)

    await user.click(screen.getByRole('button', { name: 'Проверить обновление' }))

    expect(await screen.findByText('Установлена актуальная версия')).not.toBeNull()
  })
})
