import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PeriodFilter } from '../src/components/PeriodFilter'
import { rangeFor } from '../src/lib/date'

function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function monthBounds(baseKey: string, delta: number): { from: string; to: string } {
  const [year, month] = baseKey.split('-').map(Number) as [number, number]
  const first = new Date(year, month - 1 + delta, 1)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
  return { from: dayKeyOf(first), to: dayKeyOf(last) }
}

function setup(range: { from: string; to: string } = rangeFor('month')) {
  const onChange = vi.fn()
  const utils = render(<PeriodFilter dateFrom={range.from} dateTo={range.to} onChange={onChange} />)
  return { onChange, range, ...utils }
}

describe('PeriodFilter', () => {
  it('steps back to a whole previous calendar month and drops the preset highlight', () => {
    const { onChange, range } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(monthBounds(range.from, -1))

    onChange.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'За месяц' }))
    expect(onChange).toHaveBeenCalledWith(rangeFor('month'))
  })

  it('disables the forward arrow in the current month and enables it for a past month', () => {
    const { rerender, onChange } = setup()
    expect((screen.getByRole('button', { name: 'Следующий месяц' }) as HTMLButtonElement).disabled).toBe(true)

    const past = monthBounds(rangeFor('month').from, -1)
    rerender(<PeriodFilter dateFrom={past.from} dateTo={past.to} onChange={onChange} />)
    expect((screen.getByRole('button', { name: 'Следующий месяц' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('emits one range object per preset pick', () => {
    const { onChange } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'За неделю' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(rangeFor('week'))
  })

  it('clears the preset when a date input is edited by hand', () => {
    const { onChange, range } = setup()

    fireEvent.change(screen.getByLabelText('Начало'), { target: { value: '2026-01-15' } })
    expect(onChange).toHaveBeenCalledWith({ from: '2026-01-15', to: range.to })
  })
})
