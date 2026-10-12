import { AnimatePresence } from 'motion/react'
import { TimelineEntry } from './TimelineEntry'
import type { GoalEntry } from '../goals.types'

interface GoalTimelineProps {
  entries: GoalEntry[]
  readonly: boolean
  busy: boolean
  onEditEntry: (entryId: number, content: string, images: string[]) => Promise<unknown>
  onDeleteEntry: (entryId: number) => Promise<unknown>
}

export function GoalTimeline({ entries, readonly, busy, onEditEntry, onDeleteEntry }: GoalTimelineProps) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">Событий пока нет — прогресс зафиксируется тут автоматически.</p>
  }

  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="absolute bottom-2 left-[0.4375rem] top-2 w-px bg-gradient-to-b from-slate-700 via-slate-600/50 to-transparent"
      />
      <ol className="space-y-3">
        <AnimatePresence initial={false}>
          {entries.map((entry, i) => (
            <TimelineEntry
              key={entry.id}
              entry={entry}
              index={i}
              readonly={readonly}
              busy={busy}
              onEdit={onEditEntry}
              onDelete={onDeleteEntry}
            />
          ))}
        </AnimatePresence>
      </ol>
    </div>
  )
}