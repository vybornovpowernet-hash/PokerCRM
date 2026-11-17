import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { inputCls } from '../lib/ui'

export interface SelectOption {
  /** Нативный `<select>` оперирует строками: числа (id рума) приходят уже строками. */
  value: string
  label: string
  disabled?: boolean
  /** Цвет подписи опции: имена румов красятся цветом рума, как везде в приложении. */
  color?: string
}

interface SelectProps {
  value: string
  /** Имя как у Shadcn Select: переход на Radix позже = замена этого файла, а не вызовов. */
  onValueChange: (value: string) => void
  options: SelectOption[]
  /** Доступное имя контрола: раньше `<label>` не был связан с `<select>`, и имя было недоступно. */
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
  className?: string
  /**
   * Классы триггера. По умолчанию — `inputCls` (как у остальных полей форм). Компактные
   * места (тулбар дневника, модалка) передают свою строку: здесь важен и размер отступов,
   * и `text-xs`, и оттенок фона — а ломать из-за этого вёрстку страницы ради одной кнопки
   * нельзя. Раскрытие всегда одно и то же, поэтому список выглядит одинаково везде.
   */
  triggerCls?: string
}

/** Триггер «как поле формы»: те же токены, что у `inputCls` на всех остальных контролах. */
const defaultTriggerCls = `${inputCls} gap-2 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50`

/** Пауза ввода с клавиатуры, после которой набранный префикс забывается. */
const TYPEAHEAD_MS = 700

/**
 * Выпадающий список вместо нативного `<select>`.
 *
 * Причина: закрытое поле уже было тёмным (`color-scheme: dark` в index.css + `inputCls`),
 * а раскрытый список рисует операционная система, и CSS до него не дотягивается —
 * на Windows это светло-серое полотно с системным синим выделением, то есть разрыв
 * тёмной темы. Единственный способ управлять его цветами — свой список.
 *
 * Позиционирование — `absolute` внутри `relative`-обёртки (тот же приём, что в
 * `RoomNameCombobox`): контейнеры формы и фильтров не используют `overflow-hidden` и
 * `backdrop-blur`, поэтому портал, как в `HabitPopover`, здесь не нужен.
 */
export function Select({ value, onValueChange, options, ariaLabel, placeholder, disabled, className, triggerCls }: SelectProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const typeahead = useRef({ prefix: '', at: 0 })
  const listId = useId()

  const selectedIndex = options.findIndex((o) => o.value === value)
  const current = selectedIndex >= 0 ? options[selectedIndex] : undefined
  const expanded = open && !disabled

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  // Подсветка клавиатуры стартует с выбранной опции, а не с начала списка.
  useEffect(() => {
    if (!expanded) return
    setActive(selectedIndex >= 0 ? selectedIndex : 0)
  }, [expanded, selectedIndex])

  // Активная опция должна оставаться видимой внутри прокручиваемого меню.
  useEffect(() => {
    if (!expanded) return
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [expanded, active])

  function choose(option: SelectOption) {
    if (option.disabled) return
    onValueChange(option.value)
    setOpen(false)
  }

  /** Поиск с клавиатуры по префиксу — то, что нативный список умел по умолчанию. */
  function byTypeahead(key: string) {
    const now = Date.now()
    const state = typeahead.current
    state.prefix = now - state.at > TYPEAHEAD_MS ? key : state.prefix + key
    state.at = now
    const from = active + 1
    const ordered = [...options.slice(from), ...options.slice(0, from)]
    const found = ordered.find((o) => o.label.toLowerCase().startsWith(state.prefix.toLowerCase()))
    if (found) setActive(options.indexOf(found))
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    if (!expanded) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a - 1 + options.length) % options.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(options.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const option = options[active]
      if (option) choose(option)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      // Event остановлен: иначе модалка (слушатель на window) закрылась бы вместе
      // с раскрытым списком, а у нативного `<select>` Escape закрывал только меню.
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === 'Tab') {
      setOpen(false)
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      byTypeahead(e.key)
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={`flex w-full items-center justify-between text-left focus-visible:ring-2 focus-visible:ring-slate-500/30 ${triggerCls ?? defaultTriggerCls}`}
        style={current?.color ? { color: current.color } : undefined}
      >
        <span className="truncate">{current?.label ?? placeholder ?? '—'}</span>
        <svg aria-hidden="true" viewBox="0 0 16 16" className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}>
          <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-30 mt-1 max-h-64 w-max min-w-full max-w-[calc(100vw_-_2rem)] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl shadow-black/40"
        >
          {options.map((option, i) => {
            const selected = option.value === value
            return (
              <li key={option.value} role="none">
                <button
                  type="button"
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={selected}
                  data-active={i === active}
                  disabled={option.disabled}
                  onClick={() => choose(option)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors duration-150 ${
                    i === active ? 'bg-slate-800 text-slate-200' : 'text-slate-200'
                  } ${option.disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  <span className="truncate" style={option.color ? { color: option.color } : undefined}>
                    {option.label}
                  </span>
                  {selected && (
                    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-slate-400">
                      <path d="m3.5 8.5 3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
