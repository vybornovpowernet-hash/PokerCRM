import { addMonths, currentMonthKey, monthLabel } from '../metrics'

interface MonthNavigatorProps {
  month: string
  onMonthChange: (month: string) => void
}

const btnCls = 'rounded-lg border px-3 py-1.5 text-sm transition whitespace-nowrap'

export function MonthNavigator({ month, onMonthChange }: MonthNavigatorProps) {
  const current = currentMonthKey()
  const next = addMonths(month, 1)
  const nextReached = next > current

  return (
    <div className="ml-auto flex items-center gap-2 text-sm">
      <button
        type="button"
        onClick={() => onMonthChange(addMonths(month, -1))}
        aria-label="Предыдущий месяц"
        className={`${btnCls} border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-100`}
      >
        ◀
      </button>
      <span className="min-w-36 text-center font-medium text-slate-200">{monthLabel(month)}</span>
      <button
        type="button"
        onClick={() => onMonthChange(next)}
        disabled={nextReached}
        aria-label="Следующий месяц"
        className={`${btnCls} ${
          nextReached
            ? 'cursor-not-allowed border-slate-800 text-slate-700'
            : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-100'
        }`}
      >
        ▶
      </button>
    </div>
  )
}