import { useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { MAX_DIARY_LENGTH, diaryTextLength } from '../diaryHtml'
import { DiaryEditor } from './DiaryEditor'
import { PaperclipIcon } from './icons'

const MAX_IMAGES = 10

interface ImageAttachment {
  path: string
  uploading: boolean
}

interface EntryComposerProps {
  busy: boolean
  onAdd: (content: string, images: string[]) => Promise<unknown>
  onUpload: (file: File) => Promise<string>
  actions?: ReactNode
}

export function EntryComposer({ busy, onAdd, onUpload, actions }: EntryComposerProps) {
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

  const detectFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    setError(null)
    const slots = MAX_IMAGES - attachments.length
    if (slots <= 0) {
      setError(`Не более ${MAX_IMAGES} изображений на запись`)
      return
    }
    const next = [...attachments, ...files.slice(0, slots).map(() => ({ path: '', uploading: true }))]
    setAttachments(next)
    setBusyImages(true)
    let failed = false
    for (let i = 0; i < files.length && i < slots; i++) {
      try {
        const path = await onUpload(files[i]!)
        setAttachments((prev) => prev.map((a, j) => (j === attachments.length + i ? { path, uploading: false } : a)))
      } catch {
        failed = true
        setAttachments((prev) => prev.filter((_, j) => j !== attachments.length + i))
      }
    }
    setBusyImages(false)
    if (failed) setError('Не удалось загрузить одно из изображений')
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
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(e) => void detectFiles(e)} aria-hidden="true" tabIndex={-1} />
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
        {actions && <div className="flex items-center justify-end gap-2">{actions}</div>}
      </div>

      {error && (
        <p role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      )}
    </div>
  )
}