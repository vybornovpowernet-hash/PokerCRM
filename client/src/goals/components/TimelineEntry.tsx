import { useState } from 'react'
import { motion } from 'motion/react'
import { MAX_DIARY_LENGTH, diaryTextLength, isDiaryHtml, sanitizeDiaryHtml } from '../diaryHtml'
import { formatDateShort } from '../metrics'
import type { GoalEntry } from '../goals.types'
import { ConfirmDialog } from './ConfirmDialog'
import { DiaryEditor } from './DiaryEditor'
import { PencilIcon, TrashIcon } from './icons'
import { ImageLightbox } from './ImageLightbox'

interface TimelineEntryProps {
  entry: GoalEntry
  index: number
  readonly: boolean
  busy: boolean
  onEdit: (entryId: number, content: string, images: string[]) => Promise<unknown>
  onDelete: (entryId: number) => Promise<unknown>
}

export function TimelineEntry({ entry, index, readonly, busy, onEdit, onDelete }: TimelineEntryProps) {
  const delay = Math.min(index * 0.05, 0.3)
  const isUser = entry.kind === 'user'
  const dotClass = isUser
    ? 'bg-slate-300'
    : entry.milestone === 100
      ? 'bg-emerald-400'
      : entry.milestone === null
        ? 'bg-rose-400'
        : 'bg-cyan-300'

  const [editing, setEditing] = useState(false)
  const [textHtml, setTextHtml] = useState(entry.content)
  const [images, setImages] = useState(entry.images)
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const textLen = diaryTextLength(textHtml)
  const canSave = textLen >= 1 && textLen <= MAX_DIARY_LENGTH

  const startEdit = () => {
    setTextHtml(entry.content)
    setImages(entry.images)
    setSaveError(null)
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setSaveError(null)
  }

  const save = async () => {
    if (!canSave || busy) return
    setSaveBusy(true)
    setSaveError(null)
    try {
      await onEdit(entry.id, textHtml, images)
      setEditing(false)
    } catch {
      setSaveError('Не удалось сохранить запись')
    } finally {
      setSaveBusy(false)
    }
  }

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.25, delay, ease: 'easeOut' }}
      className="flex items-start gap-3 overflow-hidden"
    >
      <span aria-hidden="true" className={`relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-slate-900/70 ${dotClass}`} />
      <div className={`min-w-0 flex-1 ${isUser ? 'rounded-xl border border-slate-700/60 bg-slate-800/50 px-3 py-2' : 'pt-1'}`}>
        {editing && isUser ? (
          <div className="flex flex-col gap-2">
            <DiaryEditor ariaLabel="Редактирование заметки" initialContent={entry.content} autofocus onChange={setTextHtml} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saveBusy || !canSave}
                  className="rounded-lg border border-slate-600/60 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-700/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saveBusy}
                  className="rounded-lg border border-slate-700/60 px-3 py-1 text-xs text-slate-500 transition hover:bg-slate-700/30"
                >
                  Отмена
                </button>
              </div>
              {saveError && (
                <p role="alert" className="text-xs text-rose-300">
                  {saveError}
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2">
              {isUser && isDiaryHtml(entry.content) ? (
                <div
                  className="min-w-0 flex-1 break-words text-base leading-relaxed text-slate-300 [&_mark]:rounded-sm [&_mark]:bg-yellow-300/40 [&_mark]:px-0.5 [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
                  dangerouslySetInnerHTML={{ __html: sanitizeDiaryHtml(entry.content) }}
                />
              ) : (
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-base leading-relaxed text-slate-300">{entry.content}</p>
              )}
              {isUser && !readonly && !busy && (
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label="Редактировать запись"
                    onClick={startEdit}
                    className="rounded-md p-1 text-slate-600 transition hover:bg-slate-700/50 hover:text-slate-200"
                  >
                    <PencilIcon />
                  </button>
                  <button
                    type="button"
                    aria-label="Удалить запись"
                    onClick={() => setConfirmDelete(true)}
                    className="rounded-md p-1 text-slate-600 transition hover:bg-rose-500/20 hover:text-rose-300"
                  >
                    <TrashIcon />
                  </button>
                </span>
              )}
            </div>
            {entry.images.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {entry.images.map((path) => (
                  <button
                    type="button"
                    key={path}
                    onClick={() => setLightbox(path)}
                    aria-label="Открыть изображение"
                    className="block h-16 w-16 overflow-hidden rounded-lg border border-slate-700/60 transition hover:border-indigo-400/60"
                  >
                    <img src={`/uploads/${path}`} alt="Изображение записи" className="h-full w-full object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
            <div className="mt-0.5 flex items-center gap-2">
              <time className="text-xs text-slate-600">{formatDateShort(entry.createdAt.slice(0, 10))}</time>
              {isUser && !readonly && !busy && entry.images.length > 0 && (
                <span className="text-xs text-slate-600">
                  {entry.images.length} {entry.images.length === 1 ? 'вложение' : 'вложений'}
                </span>
              )}
            </div>
          </>
        )}
      </div>
      {lightbox && <ImageLightbox src={`/uploads/${lightbox}`} onClose={() => setLightbox(null)} />}
      {confirmDelete && (
        <ConfirmDialog
          title="Удалить запись?"
          message="Заметка исчезнет из дневника. Это действие нельзя отменить."
          confirmLabel="Удалить"
          tone="danger"
          busy={saveBusy}
          onConfirm={() => {
            setConfirmDelete(false)
            void onDelete(entry.id)
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </motion.li>
  )
}