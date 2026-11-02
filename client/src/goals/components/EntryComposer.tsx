import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { MAX_DIARY_LENGTH, diaryTextLength } from '../diaryHtml'
import { DiaryEditor } from './DiaryEditor'
import { PaperclipIcon } from './icons'

// Клиентская копия серверных правил: перечень MIME — server/src/services/uploads.ts,
// лимит файла — там же MAX_IMAGE_BYTES. Главное решение за сервером, здесь только
// отсекается заведомо отвергаемый файл, чтобы не гонять его в сеть.
const MAX_IMAGES = 10
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
const IMAGE_TYPES = new Set(IMAGE_ACCEPT.split(','))
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/**
 * Один элемент вложения: `local` — файл живёт только в памяти браузера (File + blob-URL
 * для превью), `remote` — файл уже на сервере. Вложением `remote` элемент становится на
 * месте после успешной загрузки в процессе сохранения.
 */
type Attachment = { id: string; kind: 'local'; file: File; url: string } | { id: string; kind: 'remote'; path: string }

interface EntryComposerProps {
  busy: boolean
  onAdd: (content: string, images: string[]) => Promise<unknown>
  onUpload: (file: File) => Promise<string>
}

export function EntryComposer({ busy, onAdd, onUpload }: EntryComposerProps) {
  const [html, setHtml] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Сброс формы после успешного сохранения делается пересозданием редактора, а не
  // очисткой документа: у Tiptap история отмены переживает clearContent, и Ctrl+Z
  // возвращал бы в черновик уже сохранённый текст (кнопка «Добавить» снова активна
  // → дубль записью). Новый экземпляр начинает с пустой истории.
  const [resetKey, setResetKey] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  // Флаг держится всю последовательность целиком: загрузки + создание записи.
  const savingRef = useRef(false)
  const mounted = useRef(true)
  // Актуальный список вложений: читается синхронно, чтобы несколько вставок в одном
  // такте не перезатёрли друг друга (стейт на этом рендере ещё старый).
  const live = useRef<Attachment[]>([])
  const freed = useRef(new Set<string>())
  // Локальный счётчик вместо crypto.randomUUID: тот недоступен вне безопасного контекста.
  const seq = useRef(0)

  useEffect(() => {
    // Строгий режим монтирует эффекты дважды: cleanup между монтированиями ставит
    // false, и без этого присваивания флаг так и остался бы «компонент размонтирован».
    mounted.current = true
  }, [])

  useEffect(
    () => () => {
      mounted.current = false
      // Форма ушла: всё, что ещё не ушло на сервер, освобождается здесь.
      for (const item of live.current) if (item.kind === 'local') releaseUrl(item.url)
    },
    []
  )

  const length = diaryTextLength(html)
  const canSubmit = length >= 1 && length <= MAX_DIARY_LENGTH

  function releaseUrl(url: string): void {
    if (freed.current.has(url)) return
    freed.current.add(url)
    URL.revokeObjectURL(url)
  }

  // Единственная точка смены списка: ref обновляется в том же такте, что и стейт.
  function applyAttachments(next: Attachment[]): void {
    live.current = next
    if (mounted.current) setAttachments(next)
  }

  const submit = async () => {
    if (!canSubmit || busy || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    const content = html
    const queue = [...live.current]
    const done: Attachment[] = []
    const paths: string[] = []
    try {
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i]!
        if (item.kind === 'remote') {
          done.push(item)
          paths.push(item.path)
          continue
        }
        let path: string
        try {
          path = await onUpload(item.file)
        } catch {
          setError('Не удалось загрузить изображение')
          restore([...done, ...queue.slice(i)])
          return
        }
        releaseUrl(item.url)
        done.push({ id: item.id, kind: 'remote', path })
        paths.push(path)
      }
      await onAdd(content, paths)
      if (!mounted.current) return
      setHtml('')
      applyAttachments([])
      setResetKey((k) => k + 1)
    } catch {
      setError('Не удалось добавить заметку')
      restore(done)
    } finally {
      savingRef.current = false
      if (mounted.current) setSaving(false)
    }
  }

  // Черновик остаётся на экране: уже загруженные элементы — remote, остальные — local,
  // поэтому повторное сохранение не гоняет на сервер то, что уже ушло.
  const restore = (items: Attachment[]) => {
    applyAttachments(items)
  }

  const addFiles = (files: File[]) => {
    if (files.length === 0) return
    setError(null)
    const images = files.filter((file) => IMAGE_TYPES.has(file.type))
    if (images.length === 0) {
      setError('Поддерживаются только PNG, JPEG, WebP и GIF')
      return
    }
    const fits = images.filter((file) => file.size <= MAX_IMAGE_BYTES)
    if (fits.length === 0) {
      setError(`Файл больше ${MAX_IMAGE_BYTES / (1024 * 1024)} МБ`)
      return
    }
    const slots = MAX_IMAGES - live.current.length
    if (slots <= 0) {
      setError(`Не более ${MAX_IMAGES} изображений на запись`)
      return
    }
    // Адрес создаётся здесь, до записи в список: функция-обновитель стейта вызывается
    // не один раз, и blob-URL внутри неё утекал бы.
    const accepted = fits.slice(0, slots)
    const created = accepted.map((file) => ({ id: `image-${++seq.current}`, kind: 'local' as const, file, url: URL.createObjectURL(file) }))
    applyAttachments([...live.current, ...created])
    if (fits.length < images.length || created.length < fits.length) {
      setError(images.length > fits.length ? `Файлы больше ${MAX_IMAGE_BYTES / (1024 * 1024)} МБ пропущены` : `Не более ${MAX_IMAGES} изображений на запись`)
    }
  }

  const detectFiles = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []))
    e.target.value = ''
  }

  const pasteImages = (files: File[]) => {
    if (busy || savingRef.current) return
    addFiles(files)
  }

  const removeAttachment = (index: number) => {
    const item = live.current[index]
    if (!item) return
    if (item.kind === 'local') releaseUrl(item.url)
    applyAttachments(live.current.filter((_, j) => j !== index))
    if (error) setError(null)
  }

  const attachDisabled = saving || live.current.length >= MAX_IMAGES

  return (
    <div className="flex flex-col gap-2">
      <DiaryEditor
        key={resetKey}
        ariaLabel="Заметка в дневник"
        initialContent=""
        readOnly={saving}
        onPasteImages={pasteImages}
        onChange={(value) => {
          setHtml(value)
          if (error) setError(null)
        }}
      />

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <div key={a.id} className="group relative h-14 w-14 overflow-hidden rounded-lg border border-slate-700/70">
              <img src={a.kind === 'local' ? a.url : `/uploads/${a.path}`} alt="Вложение" className="h-full w-full object-cover" />
              {!busy && !saving && (
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
            disabled={busy || saving || !canSubmit}
            className="rounded-lg border border-slate-600/60 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Сохраняется…' : 'Добавить'}
          </button>
          <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} multiple className="hidden" onChange={(e) => detectFiles(e)} aria-hidden="true" tabIndex={-1} />
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
