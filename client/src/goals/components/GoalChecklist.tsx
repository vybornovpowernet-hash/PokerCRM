import { useState } from 'react'
import type { FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChecklistStatusMenu } from './ChecklistStatusMenu'
import { checklistProgressLabel } from '../metrics'
import type { ChecklistItem, ChecklistStatus } from '../goals.types'

interface GoalChecklistProps {
  items: ChecklistItem[]
  busy: boolean
  onChange: (items: ChecklistItem[]) => Promise<unknown>
  readOnly?: boolean
}

interface MenuAnchor {
  id: string
  x: number
  top: number
  bottom: number
}

const STATUS_SQUARE: Record<ChecklistStatus, string> = {
  pending: 'border-slate-600 bg-slate-950/40 text-slate-600 hover:border-slate-500',
  completed: 'border-emerald-400/60 bg-emerald-500 text-slate-950',
  failed: 'border-rose-400/60 bg-rose-500 text-white'
}

const STATUS_TEXT: Record<ChecklistStatus, string> = {
  pending: 'text-slate-200',
  completed: 'text-slate-500 line-through decoration-slate-600',
  failed: 'text-slate-500 line-through decoration-rose-500/70'
}

function StatusGlyph({ status }: { status: ChecklistStatus }) {
  if (status === 'completed') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 12 5 5L20 7" />
      </svg>
    )
  }
  if (status === 'failed') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    )
  }
  return null
}

export function GoalChecklist({ items, busy, onChange, readOnly = false }: GoalChecklistProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuAnchor | null>(null)

  const commit = async (next: ChecklistItem[]) => {
    setError(null)
    try {
      await onChange(next)
    } catch {
      setError('Не удалось сохранить чеклист')
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const value = text.trim()
    if (!value) return
    await commit([...items, { id: crypto.randomUUID(), text: value.slice(0, 200), status: 'pending' }])
    setText('')
  }

  const setStatus = (id: string, status: ChecklistStatus) => {
    setMenu(null)
    void commit(items.map((item) => (item.id === id ? { ...item, status } : item)))
  }

  const openMenu = (item: ChecklistItem, el: HTMLButtonElement) => {
    const rect = el.getBoundingClientRect()
    setMenu({ id: item.id, x: rect.left, top: rect.top, bottom: rect.bottom })
  }

  const remove = (id: string) => {
    void commit(items.filter((item) => item.id !== id))
  }

  const activeItem = menu ? items.find((item) => item.id === menu.id) ?? null : null

  return (
    <div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Разбейте цель на конкретные шаги — прогресс появится здесь.</p>
      ) : (
        <ul className="space-y-1.5">
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.li
                key={item.id}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0, transition: { duration: 0.15 } }}
                className="flex items-center gap-3"
              >
                <button
                  type="button"
                  onClick={(e) => openMenu(item, e.currentTarget)}
                  disabled={busy || readOnly}
                  aria-haspopup="menu"
                  aria-expanded={menu?.id === item.id}
                  aria-label={item.text}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${STATUS_SQUARE[item.status]}`}
                >
                  <StatusGlyph status={item.status} />
                </button>
                <span className={`min-w-0 flex-1 text-sm ${STATUS_TEXT[item.status]}`}>{item.text}</span>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    disabled={busy}
                    aria-label={`Удалить пункт «${item.text}»`}
                    className="rounded p-1 text-slate-500 transition hover:bg-rose-500/15 hover:text-rose-300 disabled:opacity-50"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <p className="mt-2 text-xs text-slate-500">{checklistProgressLabel(items)}</p>

      {!readOnly && (
        <form onSubmit={submit} className="mt-3 flex items-center gap-2">
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (error) setError(null)
            }}
            placeholder="Новый пункт…"
            aria-label="Новый пункт"
            maxLength={200}
            className="min-w-0 flex-1 rounded-lg border border-slate-700/70 bg-slate-950/60 px-3 py-1.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-indigo-400/70"
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            aria-label="Добавить пункт"
            className="shrink-0 rounded-lg border border-slate-600/60 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Добавить
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      {menu && activeItem && (
        <ChecklistStatusMenu
          x={menu.x}
          anchorTop={menu.top}
          anchorBottom={menu.bottom}
          text={activeItem.text}
          status={activeItem.status}
          onSelect={(status) => setStatus(menu.id, status)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
