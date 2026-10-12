import { useEffect } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react'

interface PercentCounterProps {
  value: number
  className?: string
}

export function PercentCounter({ value, className }: PercentCounterProps) {
  const reduced = useReducedMotion()
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  const raw = useMotionValue(reduced ? clamped : 0)
  const spring = useSpring(raw, { stiffness: 90, damping: 18, mass: 0.4 })
  const display = useTransform(spring, (v) => Math.max(0, Math.min(100, Math.round(v))))

  useEffect(() => {
    raw.set(clamped)
  }, [clamped, raw])

  return <motion.span className={className}>{display}</motion.span>
}