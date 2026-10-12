import { motion } from 'motion/react'
import { PercentCounter } from './PercentCounter'
import type { GoalStatus } from '../goals.types'

interface GoalRingProps {
  percent: number
  status: GoalStatus
  binary?: boolean
  size?: number
  stroke?: number
}

function TargetIcon({ className }: { className: string }) {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function GoalRing({ percent, status, binary = false, size = 132, stroke = 10 }: GoalRingProps) {
  const isBinary = binary
  const pct = isBinary ? (status === 'achieved' ? 100 : 0) : Math.max(0, Math.min(100, percent))
  const r = (size - stroke) / 2
  const center = size / 2
  const color =
    status === 'achieved' ? '#34d399' : status === 'failed' ? '#fb7185' : pct >= 75 ? '#2dd4bf' : '#818cf8'
  const iconClass = status === 'achieved' ? 'text-emerald-300' : status === 'failed' ? 'text-rose-300' : 'text-indigo-300/70'

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={isBinary ? 'Бинарная цель' : `Прогресс ${pct}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rotate-[-90deg]">
        <circle cx={center} cy={center} r={r} fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth={stroke} />
        {!isBinary && (
          <motion.circle
            cx={center}
            cy={center}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            initial={{ strokeDashoffset: 1 }}
            animate={{ strokeDashoffset: 1 - pct / 100 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
            style={{ filter: `drop-shadow(0 0 6px ${color}66)` }}
          />
        )}
        {isBinary && status === 'achieved' && (
          <motion.circle
            cx={center}
            cy={center}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            initial={{ strokeDashoffset: 1 }}
            animate={{ strokeDashoffset: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
            style={{ filter: `drop-shadow(0 0 6px ${color}66)` }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {isBinary ? <TargetIcon className={iconClass} /> : <span className="text-xl font-semibold tabular-nums text-slate-100"><PercentCounter value={pct} />%</span>}
      </div>
    </div>
  )
}