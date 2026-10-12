import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { RoomTemplate } from '../lib/types'

interface Props {
  value: string
  options: RoomTemplate[]
  onType: (value: string) => void
  onSelect: (template: RoomTemplate) => void
  placeholder?: string
  inputClass: string
}

export default function RoomNameCombobox({ value, options, onType, onSelect, placeholder, inputClass }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const query = value.trim().toLowerCase()
  const filtered = options.filter((t) => t.insertName.toLowerCase().includes(query) || t.label.toLowerCase().includes(query))
  const expanded = open && filtered.length > 0

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  function choose(template: RoomTemplate) {
    onSelect(template)
    setOpen(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!expanded) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
        setActive(0)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % filtered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a - 1 + filtered.length) % filtered.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selected = filtered[active]
      if (selected) choose(selected)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        className={inputClass}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          onType(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {expanded && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl shadow-black/40">
          {filtered.map((t, i) => (
            <li key={t.key}>
              <button
                type="button"
                onClick={() => choose(t)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition ${
                  i === active ? 'bg-slate-800 text-slate-100' : 'text-slate-300'
                }`}
              >
                <span>{t.label}</span>
                <span className="text-xs text-slate-500">{t.rateSourceLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}