import { useEffect, useRef, useState } from 'react'
import { ROOM_COLORS } from '../../lib/types'

interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
  label?: string
  className?: string
}

export function ColorPicker({ value, onChange, label = 'Цвет', className = '' }: ColorPickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-2.5 outline-none transition-colors duration-150 hover:border-white/20 focus-visible:border-indigo-400/60 focus-visible:ring-2 focus-visible:ring-indigo-500/20"
      >
        <span className="h-4 w-4 rounded-full ring-1 ring-inset ring-white/25" style={{ backgroundColor: value }} />
        <span className={`text-[10px] text-slate-500 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={label}
          className="absolute left-0 z-30 mt-2 w-60 rounded-2xl border border-white/10 bg-slate-800/95 p-3 shadow-2xl shadow-black/70 backdrop-blur-xl"
        >
          <div className="grid grid-cols-5 gap-2">
            {ROOM_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="option"
                aria-selected={value === c}
                aria-label={`Цвет ${c}`}
                title={c}
                onClick={() => {
                  onChange(c)
                  setOpen(false)
                }}
                className={`h-7 w-7 rounded-full transition duration-150 ${
                  value === c
                    ? 'ring-2 ring-slate-100 ring-offset-2 ring-offset-slate-800'
                    : 'ring-1 ring-inset ring-white/15 hover:scale-110'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
