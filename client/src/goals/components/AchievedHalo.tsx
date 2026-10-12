import { motion, useReducedMotion } from 'motion/react'

interface AchievedHaloProps {
  active: boolean
}

export function AchievedHalo({ active }: AchievedHaloProps) {
  const reduced = useReducedMotion()

  if (!active) return null

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-2xl" data-testid="achieved-halo">
      <motion.div
        className="absolute inset-0 rounded-2xl border border-emerald-300/40"
        initial={{ opacity: 0, scale: 1 }}
        animate={{ opacity: reduced ? 0.5 : [0, 0.5, 0.3], scale: reduced ? 1 : [1, 1.012, 1] }}
        transition={reduced ? { duration: 0 } : { duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute inset-0 rounded-2xl bg-emerald-400/10 blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: reduced ? 0.18 : [0, 0.18, 0] }}
        transition={reduced ? { duration: 0 } : { duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  )
}