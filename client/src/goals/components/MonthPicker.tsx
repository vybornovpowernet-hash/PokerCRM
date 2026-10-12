import { monthLabel } from '../metrics'

interface MonthPickerProps {
  month: string
  onPrev: () => void
  onNext: () => void
  nextDisabled: boolean
}

export function MonthPicker({ month, onPrev, onNext, nextDisabled }: MonthPickerProps) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Предыдущий месяц"
        className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-700/40 hover:text-slate-200"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <span className="min-w-40 px-2 text-center text-sm font-medium text-slate-200">{monthLabel(month)}</span>
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        aria-label="Следующий месяц"
        className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-700/40 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  )
}