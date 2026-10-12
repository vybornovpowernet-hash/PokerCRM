import { useEffect, useRef } from 'react'

export function usePoll(fn: () => void | Promise<void>, intervalMs: number): void {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      try {
        await fnRef.current()
      } catch {
        // keep polling alive; callers own their error handling
      }
      if (!cancelled) {
        timer = setTimeout(() => void tick(), intervalMs)
      }
    }

    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [intervalMs])
}