import { useEffect, useRef, useState } from 'react'
import type { ReactNode, TransitionEvent } from 'react'
import { useReducedMotion } from 'motion/react'

interface CollapseProps {
  open: boolean
  children: ReactNode
  className?: string
}

const DURATION_MS = 300
const FALLBACK_MS = DURATION_MS + 150

export function Collapse({ open, children, className = '' }: CollapseProps) {
  const reduced = useReducedMotion()
  const [mounted, setMounted] = useState(open)
  const [expanded, setExpanded] = useState(open && !reduced)
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearFallback = () => {
    if (fallback.current !== null) {
      clearTimeout(fallback.current)
      fallback.current = null
    }
  }

  useEffect(() => {
    if (open) {
      clearFallback()
      setMounted(true)
      const frame = requestAnimationFrame(() => setExpanded(true))
      return () => cancelAnimationFrame(frame)
    }
    setExpanded(false)
    if (reduced) {
      setMounted(false)
      return
    }
    fallback.current = setTimeout(() => setMounted(false), FALLBACK_MS)
    return clearFallback
  }, [open, reduced])

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || open) return
    clearFallback()
    setMounted(false)
  }

  if (!mounted) return null

  return (
    <div
      onTransitionEnd={handleTransitionEnd}
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
        expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      } ${className}`}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
