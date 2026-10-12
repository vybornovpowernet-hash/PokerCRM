import { useState } from 'react'
import type { FormEvent } from 'react'
import { parseUnits } from '../../lib/money'
import type { GoalInput } from '../goals.api'
import type { GoalMetric } from '../goals.types'

interface GoalCreatorProps {
  onCancel: () => void
  onCreate: (input: GoalInput) => Promise<void>
}

interface MetricOption {
  label: string
  hint: string
  placeholder: string
  field: 'target' | 'title'
}

const METRIC_OPTIONS: Record<GoalMetric, MetricOption> = {
  bankroll: { label: 'Банкролл', hint: 'целевая сумма баланса в USD по текущим курсам', placeholder: '5000', field: 'target' },
  distance: { label: 'Турниры', hint: 'целевое количество сыгранных турниров', placeholder: '100', field: 'target' },
  custom: { label: 'Своя', hint: 'никаких метрик — достижение отмечаете вручную', placeholder: 'например, выучить испанский', field: 'title' },
  daily: { label: 'Ежедневник', hint: 'дело на один день — выполнение отмечаете сами', placeholder: 'например, зарядка', field: 'title' }
}

function makeGoalInput(metric: GoalMetric, targetUnits: number, title: string, deadline: string, checklist: string[]): GoalInput {
  if (metric === 'daily') return { metric, targetUnits: 1, title: title.trim(), checklist }
  if (metric === 'custom') return { metric, targetUnits: 1, title: title.trim(), deadline: deadline || undefined, checklist }
  if (metric === 'bankroll') return { metric, targetUnits, deadline: deadline || undefined, checklist }
  return { metric, targetUnits, deadline: deadline || undefined, checklist }
}

export function GoalCreator({ onCancel, onCreate }: GoalCreatorProps) {
  const [metric, setMetric] = useState<GoalMetric>('bankroll')
  const [target, setTarget] = useState('')
  const [deadline, setDeadline] = useState('')
  const [checklist, setChecklist] = useState<string[]>([])
  const [itemText, setItemText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const option = METRIC_OPTIONS[metric]
  const isBinary = metric === 'custom' || metric === 'daily'

  const resetFields = () => {
    setTarget('')
    setDeadline('')
    setChecklist([])
  }

  const commit = async (input: GoalInput) => {
    setBusy(true)
    try {
      await onCreate(input)
      resetFields()
    } catch {
      /* ошибка показана в баннере страницы */
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (isBinary) {
      const title = target.trim()
      if (!title) {
        setError('Введите название цели')
        return
      }
      if (title.length > 100) {
        setError('Название цели не должно превышать 100 символов')
        return
      }
      await commit(makeGoalInput(metric, 1, title, deadline, checklist))
      return
    }
    if (metric === 'bankroll') {
      const units = parseUnits(target.replace(/\s/g, ''))
      if (units === null || units <= 0) {
        setError('Введите сумму цели в долларах')
        return
      }
      await commit(makeGoalInput(metric, units, '', deadline, checklist))
      return
    }
    const n = Number(target.trim())
    if (!Number.isInteger(n) || n <= 0) {
      setError('Введите целое число турниров')
      return
    }
    await commit(makeGoalInput(metric, n, '', deadline, checklist))
  }

  const addItem = () => {
    const text = itemText.trim()
    if (!text) return
    setChecklist((prev) => [...prev, text.slice(0, 200)])
    setItemText('')
  }

  const removeItem = (index: number) => {
    setChecklist((prev) => prev.filter((_, i) => i !== index))
  }

  const label = metric === 'bankroll' ? 'Сумма цели, USD' : metric === 'distance' ? 'Количество турниров' : 'Название цели'

  return (
    <form onSubmit={submit} className="mb-6 rounded-2xl border border-white/10 bg-white/[0.05] p-6 shadow-lg shadow-black/30 backdrop-blur-xl">
      <p className="text-sm font-medium text-slate-200">Новая цель</p>

      <div className="mt-4 flex gap-2">
        {Object.entries(METRIC_OPTIONS).map(([id, opt]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setMetric(id as GoalMetric)
              setError(null)
            }}
            aria-pressed={metric === id}
            className={
              metric === id
                ? 'rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-400'
                : 'rounded-lg border border-slate-700/70 px-3 py-1.5 text-sm text-slate-400 transition hover:text-slate-200'
            }
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">{option.hint}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-slate-400">{label}</span>
          <input
            type={metric === 'distance' ? 'number' : 'text'}
            min={metric === 'distance' ? 1 : undefined}
            step={metric === 'distance' ? 1 : undefined}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={option.placeholder}
            autoFocus
            className="mt-1 w-full rounded-lg border border-slate-700/70 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-indigo-400/70"
          />
        </label>
        {metric !== 'daily' && (
          <label className="block">
            <span className="text-xs text-slate-400">Дедлайн (необязательно)</span>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700/70 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-indigo-400/70"
            />
          </label>
        )}
      </div>

      <fieldset className="mt-4">
        <span className="text-xs text-slate-400">Пункты на старте (необязательно)</span>
        {checklist.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {checklist.map((text, index) => (
              <li key={index} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 text-sm text-slate-200">{text}</span>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  aria-label={`Удалить пункт «${text}»`}
                  className="rounded p-1 text-slate-500 transition hover:bg-rose-500/15 hover:text-rose-300"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex items-center gap-2">
          <input
            value={itemText}
            onChange={(e) => setItemText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addItem()
              }
            }}
            placeholder="Новый пункт…"
            aria-label="Пункт на старте"
            maxLength={200}
            className="min-w-0 flex-1 rounded-lg border border-slate-700/70 bg-slate-950/60 px-3 py-1.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-indigo-400/70"
          />
          <button
            type="button"
            onClick={addItem}
            disabled={!itemText.trim()}
            aria-label="Добавить пункт на старте"
            className="shrink-0 rounded-lg border border-slate-600/60 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Добавить
          </button>
        </div>
      </fieldset>

      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}

      <div className="mt-5 flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !target.trim()}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Создать цель
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:text-slate-200">
          Отмена
        </button>
      </div>
    </form>
  )
}