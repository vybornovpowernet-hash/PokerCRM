import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { ChevronIcon } from '../../components/icons'

interface ImageLightboxProps {
  images: string[]
  startIndex?: number
  alt?: string
  onClose: () => void
}

export function ImageLightbox({ images, startIndex = 0, alt, onClose }: ImageLightboxProps) {
  const count = images.length
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), Math.max(count - 1, 0)))

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (count < 2) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setIndex((i) => Math.max(i - 1, 0))
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        setIndex((i) => Math.min(i + 1, count - 1))
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, count])

  if (count === 0) return null

  const src = images[Math.min(index, count - 1)] ?? ''
  const atStart = index === 0
  const atEnd = index === count - 1

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр изображения"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/85 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.img
        key={src}
        src={src}
        alt={alt ?? 'Изображение'}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="relative max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl shadow-black/70"
        onClick={onClose}
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Закрыть"
        className="absolute right-4 top-4 rounded-lg p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="Предыдущее изображение"
            title="Предыдущее изображение"
            onClick={() => setIndex((i) => Math.max(i - 1, 0))}
            disabled={atStart}
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-slate-200 backdrop-blur transition hover:bg-black/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 sm:left-4"
          >
            <ChevronIcon dir="left" size={24} strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="Следующее изображение"
            title="Следующее изображение"
            onClick={() => setIndex((i) => Math.min(i + 1, count - 1))}
            disabled={atEnd}
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-slate-200 backdrop-blur transition hover:bg-black/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 sm:right-4"
          >
            <ChevronIcon dir="right" size={24} strokeWidth={2} />
          </button>
          <div
            aria-live="polite"
            className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs tabular-nums text-slate-200"
          >
            {index + 1} / {count}
          </div>
        </>
      )}
    </div>,
    document.body
  )
}
