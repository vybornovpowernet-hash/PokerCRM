import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Select, type SelectOption } from '../src/components/Select'

const OPTIONS: SelectOption[] = [
  { value: '0', label: '— выбери рум —', disabled: true },
  { value: '1', label: 'Депозит' },
  { value: '2', label: 'Вывод' },
  { value: '3', label: 'Перевод', color: '#fcd34d' }
]

/** Контролируемый список ровно в том виде, в котором его держит страница. */
function Harness({ initial = '1' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <div>
      <p data-testid="outside">фон страницы</p>
      <Select ariaLabel="Тип" value={value} onValueChange={setValue} options={OPTIONS} placeholder="— выбери рум —" />
      <output>выбрано: {value}</output>
    </div>
  )
}

function trigger(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Тип' })
}

function optionByLabel(label: string): HTMLElement {
  return screen.getByRole('option', { name: label })
}

describe('кастомный Select', () => {
  it('рисует меню палитрой приложения, а не системными цветами', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(trigger())
    // закрытое поле было тёмным, а раскрытый список рисует ОС — ради этого весь компонент
    expect(screen.getByRole('listbox').className).toContain('bg-slate-900')
    expect(optionByLabel('Депозит').className).toContain('text-slate-200')
    // подсветка клавиатуры стартует с выбранной опции, а не с начала списка
    expect(optionByLabel('Депозит').getAttribute('data-active')).toBe('true')
    expect(document.querySelector('[data-active="true"]')?.className).toContain('bg-slate-800')
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(trigger().getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id)
    // `inputCls` снимает outline: без кольца фокуса контрол был бы невидим для Tab
    expect(trigger().className).toContain('focus-visible:ring-2')
  })

  it('клик по опции пишет значение в состояние родителя и закрывает меню', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(trigger())
    await user.click(optionByLabel('Вывод'))

    expect(screen.getByText('выбрано: 2')).toBeTruthy()
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(trigger().textContent?.trim()).toBe('Вывод')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('выбранная опция помечена в списке, остальные — нет', async () => {
    const user = userEvent.setup()
    render(<Harness initial="0" />)

    await user.click(trigger())
    expect(optionByLabel('— выбери рум —').getAttribute('aria-selected')).toBe('true')
    expect(optionByLabel('Депозит').getAttribute('aria-selected')).toBe('false')
    expect(optionByLabel('Вывод').getAttribute('aria-selected')).toBe('false')
    expect((optionByLabel('— выбери рум —') as HTMLButtonElement).disabled).toBe(true)
  })

  it('стрелки и Enter выбирают с клавиатуры, Escape отменяет без потери значения', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(trigger())
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(screen.getByText('выбрано: 3')).toBeTruthy()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeTruthy()
    await user.keyboard('{ArrowDown}{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByText('выбрано: 3')).toBeTruthy()
    expect(trigger().textContent?.trim()).toBe('Перевод')
  })

  it('поиск по префиксу с клавиатуры — то, что нативный список умел по умолчанию', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(trigger())
    await user.keyboard('в{Enter}')
    await waitFor(() => expect(screen.getByText('выбрано: 2')).toBeTruthy())
  })

  it('клик вне закрывает меню и ничего не меняет', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(trigger())
    expect(screen.getByRole('listbox')).toBeTruthy()
    await user.click(screen.getByTestId('outside'))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByText('выбрано: 1')).toBeTruthy()
  })

  it('цвет опции доезжает до подписи — имена румов остаются крашеными', async () => {
    const user = userEvent.setup()
    render(<Harness initial="0" />)

    await user.click(trigger())
    expect((optionByLabel('Перевод').querySelector('span') as HTMLElement).style.color).toBe('rgb(252, 211, 77)')

    await user.click(optionByLabel('Перевод'))
    expect((trigger() as HTMLElement).style.color).toBe('rgb(252, 211, 77)')
  })

  it('triggerCls заменяет токен поля, но не поведение: компактный триггер, то же меню', async () => {
    const user = userEvent.setup()
    render(
      <Select
        ariaLabel="Размер шрифта"
        triggerCls="cursor-pointer gap-1 rounded-md px-1.5 py-1 text-xs"
        value="18"
        onValueChange={() => undefined}
        options={[
          { value: '16', label: '16' },
          { value: '18', label: '18' }
        ]}
      />
    )

    const size = screen.getByRole('combobox', { name: 'Размер шрифта' })
    expect(size.className).toContain('text-xs')
    // базовый токен формы не подмешан: в тулбаре свои отступы и кегль
    expect(size.className).not.toContain('px-3')
    expect(size.className).not.toContain('bg-slate-900/50')

    await user.click(size)
    expect(screen.getByRole('listbox').className).toContain('bg-slate-900')
    expect(screen.getByRole('option', { name: '16' }).className).toContain('text-slate-200')
  })

  it('отключённый контрол не открывается', async () => {
    const user = userEvent.setup()
    render(<Select ariaLabel="Направление" value="in" onValueChange={() => undefined} disabled options={[{ value: 'in', label: 'В рум' }]} />)

    const locked = screen.getByRole('combobox', { name: 'Направление' })
    await user.click(locked)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(locked.getAttribute('aria-expanded')).toBe('false')
    expect(locked.hasAttribute('disabled')).toBe(true)
  })
})
