import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { MAX_DIARY_LENGTH, diaryTextLength } from '../diaryHtml'
import { DiaryEditor } from './DiaryEditor'
import { PaperclipIcon } from './icons'

const MAX_IMAGES = 10
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
const IMAGE_TYPES = new Set(IMAGE_ACCEPT.split(','))

interface ImageAttachment {
  path: string
  uploading: boolean
}

interface EntryComposerProps {
  busy: boolean
  onAdd: (content: string, images: string[]) => Promise<unknown>
  onUpload: (file: File) => Promise<string>
}

export function EntryComposer({ busy, onAdd, onUpload }: EntryComposerProps) {
  const [html, setHtml] = useState('')
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyImages, setBusyImages] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const length = diaryTextLength(html)
  const canSubmit = length >= 1 && length <= MAX_DIARY_LENGTH

  const submit = async () => {
    if (!canSubmit || busy || busyImages) return
    setError(null)
    try {
      await onAdd(html, attachments.map((a) => a.path))
      setHtml('')
      setAttachments([])
      setResetKey((k) => k + 1)
    } catch {
      setError('Не удалось добавить заметку')
    }
  }

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return
    setError(null)
    const slots = MAX_IMAGES - attachments.length
    if (slots <= 0) {
      setError(`Не более ${MAX_IMAGES} изображений на запись`)
      return
    }
    const base = attachments.length
    const accepted = files.slice(0, slots)
    setAttachments([...attachments, ...accepted.map(() => ({ path: '', uploading: true }))])
    setBusyImages(true)
    let failed = false
    for (let i = 0; i < accepted.length; i++) {
      try {
        const path = await onUpload(accepted[i]!)
        setAttachments((prev) => prev.map((a, j) => (j === base + i ? { path, uploading: false } : a)))
      } catch {
        failed = true
        setAttachments((prev) => prev.filter((_, j) => j !== base + i))
      }
    }
    setBusyImages(false)
    if (failed) setError('Не удалось загрузить одно из изображений')
  }

  const detectFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    await addFiles(files)
  }

  const pasteImages = (files: File[]) => {
    if (busy || busyImages) return
    const images = files.filter((file) => IMAGE_TYPES.has(file.type))
    if (images.length === 0) {
      setError('Поддерживаются только PNG, JPEG, WebP и GIF')
      return
    }
    void addFiles(images)
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, j) => j !== index))
    if (error) setError(null)
  }

  const attachDisabled = busyImages || attachments.length >= MAX_IMAGES

  return (
    <div className="flex flex-col gap-2">
      <DiaryEditor
        key={resetKey}
        ariaLabel="Заметка в дневник"
        initialContent=""
        onPasteImages={pasteImages}
        onChange={(value) => {
          setHtml(value)
          if (error) setError(null)
        }}
      />

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <div key={i} className="group relative h-14 w-14 overflow-hidden rounded-lg border border-slate-700/70">
              {a.uploading ? (
                <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">…</div>
              ) : (
                <img src={`/uploads/${a.path}`} alt="Вложение" className="h-full w-full object-cover" />
              )}
              {!busy && (
                <button
                  type="button"
                  aria-label="Убрать изображение"
                  onClick={() => removeAttachment(i)}
                  className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl-lg bg-black/70 text-slate-200 transition hover:bg-rose-500"
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !canSubmit || busyImages}
            className="rounded-lg border border-slate-600/60 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Добавить
          </button>
          <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} multiple className="hidden" onChange={(e) => void detectFiles(e)} aria-hidden="true" tabIndex={-1} />
          <button
            type="button"
            disabled={attachDisabled}
            onClick={() => fileRef.current?.click()}
            aria-label="Прикрепить фото"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600/60 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PaperclipIcon className="h-3.5 w-3.5" />
            Прикрепить фото
          </button>
          <span className={`text-xs tabular-nums ${length > MAX_DIARY_LENGTH ? 'text-rose-400' : 'text-slate-600'}`}>
            {length} / {MAX_DIARY_LENGTH}
          </span>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      )}
    </div>
  )
}