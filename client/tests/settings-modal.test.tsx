import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from '../src/components/SettingsModal'

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }))

vi.mock('../src/lib/api', () => ({
  api: {
    settings: {
      get: mocks.get,
      update: mocks.update
    }
  }
}))

beforeEach(() => {
  mocks.get.mockReset()
  mocks.update.mockReset()
})

describe('SettingsModal', () => {
  it('loads the current boundary and offers 00:00..12:00', async () => {
    mocks.get.mockResolvedValue({ dayStartHour: 6 })
    render(<SettingsModal onClose={() => undefined} />)

    const select = (await screen.findByRole('combobox')) as HTMLSelectElement
    expect(select.value).toBe('6')
    expect(screen.getAllByRole('option')).toHaveLength(13)
  })

  it('saves the new boundary on change', async () => {
    mocks.get.mockResolvedValue({ dayStartHour: 0 })
    mocks.update.mockResolvedValue({ dayStartHour: 6 })
    const user = userEvent.setup()
    render(<SettingsModal onClose={() => undefined} />)

    const select = await screen.findByRole('combobox')
    await user.selectOptions(select, '6')

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(6))
    expect(screen.queryByText('Сохранено')).not.toBeNull()
  })
})
