import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'

interface ImageLightboxProps {
  src: string
  alt?: string
  onClose: () => void
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

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
    </div>,
    document.body
  )
}