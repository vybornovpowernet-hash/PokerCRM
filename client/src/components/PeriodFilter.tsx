import { useState } from 'react'
import { ChevronIcon } from './icons'
import { PRESETS, isNextMonthDisabled, monthBounds, rangeFor, type PresetId } from '../lib/date'
import { activeBtn, inactiveBtn, inputCls, navBtn } from '../lib/ui'

interface PeriodFilterProps {
  dateFrom: string
  dateTo: string
  onChange: (range: { from: string; to: string }) => void
  defaultPreset?: PresetId
}

export function PeriodFilter({ dateFrom, dateTo, onChange, defaultPreset = 'month' }: PeriodFilterProps) {
  const [preset, setPreset] = useState<PresetId | null>(defaultPreset)

  function selectPreset(id: PresetId) {
    setPreset(id)
    onChange(rangeFor(id))
  }

  function shiftMonth(delta: number) {
    setPreset(null)
    onChange(monthBounds(dateFrom, delta))
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => selectPreset(p.id)} className={preset === p.id ? activeBtn : inactiveBtn}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Предыдущий месяц"
          title="Предыдущий месяц"
          onClick={() => shiftMonth(-1)}
          className={navBtn}
        >
          <ChevronIcon dir="left" />
        </button>
        <label className="flex items-center gap-2">
          <span className="text-sm text-slate-400">Начало</span>
          <input
            type="date"
            className={`${inputCls} w-auto`}
            value={dateFrom}
            onChange={(e) => {
              setPreset(null)
              onChange({ from: e.target.value, to: dateTo })
            }}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-sm text-slate-400">Конец</span>
          <input
            type="date"
            className={`${inputCls} w-auto`}
            value={dateTo}
            onChange={(e) => {
              setPreset(null)
              onChange({ from: dateFrom, to: e.target.value })
            }}
          />
        </label>
        <button
          type="button"
          aria-label="Следующий месяц"
          title="Следующий месяц"
          onClick={() => shiftMonth(1)}
          disabled={isNextMonthDisabled(dateFrom)}
          className={navBtn}
        >
          <ChevronIcon dir="right" />
        </button>
      </div>
    </div>
  )
}
