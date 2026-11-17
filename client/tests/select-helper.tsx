import { screen, waitFor } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { expect } from 'vitest'

/**
 * Точка входа для тестов кастомного `Select` (client/src/components/Select.tsx).
 * Раньше эти контролы были нативными `<select>`, и тесты пользовались `user.selectOptions`
 * и `.value`. Кастомный список так не проверяется: значение живёт не в DOM-узле, а в
 * состоянии страницы, поэтому выбирать надо кликом по опции, а сверять — подпись триггера.
 */

/** Триггер списка по доступному имени (проп `ariaLabel`). */
export function selectTrigger(name: string): HTMLElement {
  return screen.getByRole('combobox', { name })
}

/** То, что показано в списке, пока он закрыт. */
export function selectValue(name: string): string {
  return (selectTrigger(name).textContent ?? '').trim()
}

/** Открыть список и кликнуть опцию — без сверки результата (для контролов, чьё значение
 * читается из чужого стейта: например, размер шрифта живёт в состоянии редактора). */
export async function clickOption(user: UserEvent, name: string, label: string): Promise<void> {
  await user.click(selectTrigger(name))
  await user.click(await screen.findByRole('option', { name: label }))
}

/** Мышиный путь пользователя: открыть список и кликнуть нужную опцию. */
export async function pickOption(user: UserEvent, name: string, label: string): Promise<void> {
  await clickOption(user, name, label)
  await waitFor(() => expect(selectValue(name)).toBe(label))
}

/** Подписи всех опций открытого меню — порядок и состав задаёт сам список. */
export function openOptionLabels(): string[] {
  return screen
    .getAllByRole('option')
    .map((el) => (el.textContent ?? '').trim())
    .filter(Boolean)
}
