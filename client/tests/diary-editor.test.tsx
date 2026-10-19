import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DiaryEditor } from '../src/goals/components/DiaryEditor'
import { sanitizeDiaryHtml } from '../src/goals/diaryHtml'

describe('DiaryEditor toolbar', () => {
  it('toggles bold formatting on a selection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DiaryEditor ariaLabel="Заметка в дневник" initialContent="" onChange={onChange} />)

    const editor = screen.getByLabelText('Заметка в дневник')
    await user.click(editor)
    await user.type(editor, 'жирный')
    await user.keyboard('{Control>}a{/Control}')
    await user.click(screen.getByRole('button', { name: 'Жирный' }))

    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('<strong>жирный</strong>'))
  })

  it('toggles an active state on the pressed toolbar button', async () => {
    const user = userEvent.setup()
    render(<DiaryEditor ariaLabel="Заметка в дневник" initialContent="" onChange={() => undefined} />)

    const editor = screen.getByLabelText('Заметка в дневник')
    const bold = screen.getByRole('button', { name: 'Жирный' })

    await user.click(editor)
    await user.type(editor, 'тело')
    await user.keyboard('{Control>}a{/Control}')
    expect(bold.getAttribute('aria-pressed')).toBe('false')

    await user.click(bold)
    expect(bold.getAttribute('aria-pressed')).toBe('true')

    await user.click(bold)
    expect(bold.getAttribute('aria-pressed')).toBe('false')
  })

  it('exposes the formatting controls with Russian labels', () => {
    render(<DiaryEditor ariaLabel="Заметка в дневник" initialContent="" onChange={() => undefined} />)

    expect(screen.getByRole('toolbar', { name: 'Форматирование' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Жирный' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Курсив' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Подчёркнутый' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Выделить маркером' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Палитра маркера' })).toBeTruthy()

    const size = screen.getByRole('combobox', { name: 'Размер шрифта' })
    const options = Array.from(size.querySelectorAll('option')).map((option) => option.value)
    expect(options).toEqual(['8', '10', '12', '14', '16', '18', '20'])
  })

  it('loads existing markup into the editor', () => {
    render(<DiaryEditor ariaLabel="Редактирование заметки" initialContent="<p>Курсив и <strong>жирный</strong></p>" onChange={() => undefined} />)
    const editor = screen.getByLabelText('Редактирование заметки')
    expect(editor.innerHTML).toContain('<strong>жирный</strong>')
  })

  it('loads font size and highlight markup back into the editor', () => {
    render(
      <DiaryEditor
        ariaLabel="Редактирование заметки"
        initialContent='<p>Обычный <span style="font-size: 18px">крупный</span> и <mark data-color="#fef08a" style="background-color: #fef08a">выделенный</mark></p>'
        onChange={() => undefined}
      />
    )
    const editor = screen.getByLabelText('Редактирование заметки')
    expect(editor.innerHTML).toContain('font-size: 18px')
    expect(editor.innerHTML).toContain('data-color="#fef08a"')
  })

  it('applies the selected font size to the selection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DiaryEditor ariaLabel="Заметка в дневник" initialContent="" onChange={onChange} />)

    const editor = screen.getByLabelText('Заметка в дневник')
    await user.click(editor)
    await user.type(editor, 'крупный')
    await user.keyboard('{Control>}a{/Control}')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Размер шрифта' }), '18')

    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('font-size: 18px'))
  })

  it('resets to the default size when 16 is chosen', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DiaryEditor ariaLabel="Заметка в дневник" initialContent="" onChange={onChange} />)

    const editor = screen.getByLabelText('Заметка в дневник')
    const size = screen.getByRole('combobox', { name: 'Размер шрифта' })
    await user.click(editor)
    await user.type(editor, 'обычный')
    await user.keyboard('{Control>}a{/Control}')
    await user.selectOptions(size, '18')
    await user.selectOptions(size, '16')

    expect(onChange).toHaveBeenLastCalledWith(expect.not.stringContaining('font-size'))
  })

  it('highlights the selection with a pastel color from the palette', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DiaryEditor ariaLabel="Заметка в дневник" initialContent="" onChange={onChange} />)

    const editor = screen.getByLabelText('Заметка в дневник')
    await user.click(editor)
    await user.type(editor, 'выделю')
    await user.keyboard('{Control>}a{/Control}')
    await user.click(screen.getByRole('button', { name: 'Палитра маркера' }))
    await user.click(screen.getByRole('menuitem', { name: 'Маркер #fef08a' }))

    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('data-color="#fef08a"'))
  })
})

describe('sanitizeDiaryHtml', () => {
  it('keeps a span font-size inside the allowed range', () => {
    expect(sanitizeDiaryHtml('<span style="font-size: 18px">крупный</span>')).toBe('<span style="font-size: 18px">крупный</span>')
  })

  it('drops out-of-range and non-px font sizes', () => {
    expect(sanitizeDiaryHtml('<span style="font-size: 24px">x</span>')).toBe('<span>x</span>')
    expect(sanitizeDiaryHtml('<span style="font-size: 16pt">x</span>')).toBe('<span>x</span>')
  })

  it('keeps only a hex background-color on mark and drops other styles', () => {
    expect(sanitizeDiaryHtml('<mark style="background-color: #fef08a; color: red">x</mark>')).toBe('<mark style="background-color: #fef08a">x</mark>')
    expect(sanitizeDiaryHtml('<mark style="background-color: red">x</mark>')).toBe('<mark>x</mark>')
    expect(sanitizeDiaryHtml('<mark data-color="#fbcfe8" style="background-color: #fbcfe8">x</mark>')).toBe(
      '<mark data-color="#fbcfe8" style="background-color: #fbcfe8">x</mark>'
    )
  })

  it('normalizes a browser-serialized rgb color back to hex', () => {
    expect(sanitizeDiaryHtml('<mark data-color="#fef08a" style="background-color: rgb(254, 240, 138); color: inherit;">x</mark>')).toBe(
      '<mark data-color="#fef08a" style="background-color: #fef08a">x</mark>'
    )
  })

  it('blocks url() payloads and cross-tag style injection', () => {
    expect(sanitizeDiaryHtml('<mark style="background-color: url(javascript:alert(1))">x</mark>')).toBe('<mark>x</mark>')
    expect(sanitizeDiaryHtml('<span style="background-color: #fef08a; font-size: 18px">x</span>')).toBe('<span style="font-size: 18px">x</span>')
  })

  it('drops an unterminated tag fragment instead of passing it through', () => {
    expect(sanitizeDiaryHtml('<b>привет</b><img src=x onerror=alert(1)')).toBe('<b>привет</b>')
    expect(sanitizeDiaryHtml('<b>привет</b><')).toBe('<b>привет</b>')
    expect(sanitizeDiaryHtml('смотри сюда <')).toBe('смотри сюда ')
    expect(sanitizeDiaryHtml('<p>a</p><script>alert(1)')).toBe('<p>a</p>alert(1)')
    expect(sanitizeDiaryHtml('<p>a</p> <p>b</p>')).toBe('<p>a</p> <p>b</p>')
  })
})
