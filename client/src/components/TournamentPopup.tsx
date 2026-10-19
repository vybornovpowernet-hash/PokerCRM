import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { formatAmount, formatUnits, parseUnits } from '../lib/money'
import { detectRoomTemplate } from '../lib/templates'
import type { DayReconcile, Room, TournamentImportEntry, TournamentImportFailure, TournamentLineInput, TournamentRow } from '../lib/types'

const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-100 shadow-inner outline-none transition focus:border-slate-500'
const colCls = 'text-xs uppercase tracking-wider text-slate-500'
const rowGrid = 'grid grid-cols-[1fr_auto_1fr_2.5rem] items-center gap-2'
const importGrid = 'grid grid-cols-[5.5rem_1fr_auto_auto_auto_auto] items-center gap-2'
const textareaCls =
  'w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 font-mono text-xs leading-relaxed text-slate-200 shadow-inner outline-none transition focus:border-slate-500'
const CLIPBOARD_READ_ERROR = 'Не удалось прочитать текст из буфера обмена. Убедитесь, что вы скопировали текстовый отчет, а не картинку'
const FORMAT_ERROR = 'Неверный формат данных. Убедитесь, что скопирован именно отчет PokerDom'

interface RowDraft {
  id: string
  buyin: string
  result: string
}

interface ImportStats {
  total: number
  parsed: number
  failed: TournamentImportFailure[]
}

interface ArchiveStats {
  fileName: string
  total: number
  parsed: number
  failed: TournamentImportFailure[]
}

const emptyRow = (): RowDraft => ({ id: crypto.randomUUID(), buyin: '', result: '' })

const NEW_ROWS_COUNT = 5

const isFilled = (r: RowDraft) => r.buyin.trim() !== '' || r.result.trim() !== ''

interface Props {
  open: boolean
  room: Room | null
  date: string
  onClose: () => void
  onChanged: () => void
}

const toImportEntry = (r: { tournamentId: number; name: string | null; date: string; buyin: number; result: number; rank: number | null; entrants: number | null; currency: string }): TournamentImportEntry => ({
  tournamentId: r.tournamentId,
  name: r.name,
  date: r.date,
  buyin: r.buyin,
  result: r.result,
  rank: r.rank,
  entrants: r.entrants,
  currency: r.currency
})

const toRow = (buyin: number, result: number): RowDraft => ({ id: crypto.randomUUID(), buyin: formatUnits(buyin), result: formatUnits(result) })

/**
 * Content identity of an imported tournament. Rows loaded from the DB carry the
 * id they were stored with, and the PokerDom id algorithm changed (32-bit → 53-bit),
 * so a freshly parsed report no longer matches them by id — the numbers still do.
 * Used to keep an already-loaded tournament from being added a second time.
 */
const naturalKey = (t: { date: string; name: string | null; buyin: number; result: number; rank: number | null }): string =>
  [t.date, t.name ?? '', t.buyin, t.result, t.rank ?? ''].join('|')

export function TournamentPopup({ open, room, date, onClose, onChanged }: Props) {
  const [rows, setRows] = useState<RowDraft[]>([])
  const [imports, setImports] = useState<TournamentImportEntry[]>([])
  const [savedImportIds, setSavedImportIds] = useState<number[]>([])
  const [removedImportIds, setRemovedImportIds] = useState<number[]>([])
  const [savedImportKeys, setSavedImportKeys] = useState<string[]>([])
  const [archiveStats, setArchiveStats] = useState<ArchiveStats[]>([])
  const [textDraft, setTextDraft] = useState<string>('')
  const [textErrors, setTextErrors] = useState<TournamentImportFailure[]>([])
  const [textParsedCount, setTextParsedCount] = useState(0)
  const [textBusy, setTextBusy] = useState(false)
  const [reconcile, setReconcile] = useState<DayReconcile | null>(null)
  const [wouldReanchor, setWouldReanchor] = useState<{ from: string; to: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  const fileRef = useRef<HTMLInputElement>(null)

  const roomId = room?.id ?? 0
  const currency = room?.tournamentCurrency ?? 'USD'

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!open || !room) return
    setError(null)
    setReconcile(null)
    setWouldReanchor(null)
    setImports([])
    setSavedImportIds([])
    setRemovedImportIds([])
    setSavedImportKeys([])
    setArchiveStats([])
    setTextDraft('')
    setTextErrors([])
    setTextParsedCount(0)
    setRows(Array.from({ length: NEW_ROWS_COUNT }, emptyRow))
    api.tournaments
      .list(room.id, date)
      .then((saved) => {
        if (!mountedRef.current) return
        if (saved.length === 0) return
        const manual = saved.filter((r) => r.tournamentId === null)
        const imported = saved.filter((r): r is TournamentRow & { tournamentId: number } => r.tournamentId !== null)
        if (detectRoomTemplate(room.name) === 'pokerdom') {
          if (manual.length > 0 || imported.length > 0) {
            setRows([...manual.map((r) => toRow(r.buyin, r.result)), ...imported.map((r) => toRow(r.buyin, r.result)), emptyRow()])
            setRemovedImportIds(imported.map((r) => r.tournamentId))
            setSavedImportKeys(imported.map(naturalKey))
          }
          return
        }
        if (imported.length > 0) {
          setImports(imported.map((r) => toImportEntry(r)))
          setSavedImportIds(imported.map((r) => r.tournamentId))
        }
        if (manual.length > 0) {
          setRows([...manual.map((r) => toRow(r.buyin, r.result)), emptyRow()])
        }
      })
      .catch(() => undefined)
  }, [open, room, date])

  if (!open || !room) return null

  const template = detectRoomTemplate(room.name)
  const isGgRoom = template === 'gg'
  const isPokerDomRoom = template === 'pokerdom'

  function addRow() {
    setRows((prev) => [...prev, emptyRow()])
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  function setCell(id: string, field: 'buyin' | 'result', value: string) {
    setRows((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
      if (next.every(isFilled)) next.push(emptyRow())
      return next
    })
  }

  function collectLines(): TournamentLineInput[] {
    const lines: TournamentLineInput[] = []
    for (const r of rows) {
      const buyinText = r.buyin.trim()
      const resultText = r.result.trim()
      if (buyinText === '' && resultText === '') continue
      const buyin = parseUnits(buyinText || '0')
      const result = parseUnits(resultText || '0')
      if (buyin === null || result === null || buyin < 0 || result < 0) {
        throw new Error('Введите суммы корректно (до 2 знаков, не отрицательные)')
      }
      lines.push({ buyin, result, currency })
    }
    return lines
  }

  const importStats: ImportStats | null =
    archiveStats.length === 0
      ? null
      : {
          total: archiveStats.reduce((sum, a) => sum + a.total, 0),
          parsed: archiveStats.reduce((sum, a) => sum + a.parsed, 0),
          failed: archiveStats.flatMap((a) => a.failed)
        }
  // The archive stop-cock only fires when there is genuinely nothing to save:
  // a partially parsed archive (or one with unreadable files) still keeps the
  // recognised tournaments, so the user may save them — the losses are reported.
  const importHasFailures = archiveStats.some((a) => a.parsed < a.total || a.failed.length > 0)
  const importBlocked = archiveStats.some((a) => a.total === 0)

  async function handleFiles(files: File[]) {
    if (files.length === 0) return
    if (busyRef.current) return
    busyRef.current = true
    setError(null)
    setImportBusy(true)
    const messages: string[] = []
    try {
      for (const file of files) {
        try {
          const res = await api.tournaments.importGg(roomId, file)
          if (!mountedRef.current) return
          const skip = new Set(removedImportIds)
          setImports((prev) => {
            const seen = new Set(prev.map((t) => t.tournamentId))
            return [...prev, ...res.tournaments.filter((t) => !seen.has(t.tournamentId) && !skip.has(t.tournamentId))]
          })
          setArchiveStats((prev) => [
            ...prev.filter((a) => a.fileName !== file.name),
            { fileName: file.name, total: res.totalSources, parsed: res.successfullyParsed, failed: res.failures }
          ])
        } catch (e) {
          messages.push(`${file.name}: ${e instanceof Error ? e.message : 'Не удалось разобрать архив'}`)
        }
      }
    } finally {
      busyRef.current = false
      if (mountedRef.current) {
        setImportBusy(false)
        if (messages.length > 0) setError(messages.join('\n'))
      }
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleParseText() {
    if (busyRef.current) return
    busyRef.current = true
    setError(null)
    setTextErrors([])
    setTextParsedCount(0)
    let text = textDraft.trim()
    if (text === '') {
      try {
        text = (await navigator.clipboard.readText()).trim()
        if (mountedRef.current) setTextDraft(text)
      } catch {
        text = ''
      }
    }
    if (text === '') {
      setTextErrors([{ source: '', error: CLIPBOARD_READ_ERROR }])
      busyRef.current = false
      return
    }
    setTextBusy(true)
    try {
      const res = await api.tournaments.importPokerDom(roomId, text)
      if (!mountedRef.current) return
      setTextParsedCount(res.successfullyParsed)
      if (res.tournaments.length === 0) {
        setTextErrors([{ source: '', error: FORMAT_ERROR }])
        return
      }
      const skip = new Set(removedImportIds)
      const skipKeys = new Set(savedImportKeys)
      setImports((prev) => {
        const seen = new Set(prev.map((t) => t.tournamentId))
        return [...prev, ...res.tournaments.filter((t) => !seen.has(t.tournamentId) && !skip.has(t.tournamentId) && !skipKeys.has(naturalKey(t)))]
      })
      setTextErrors(res.failures)
    } catch (e) {
      if (mountedRef.current) {
        const serverMsg = e instanceof Error ? e.message : ''
        setTextErrors([{ source: '', error: serverMsg.startsWith('Сервер не ответил') ? serverMsg : FORMAT_ERROR }])
      }
    } finally {
      busyRef.current = false
      if (mountedRef.current) setTextBusy(false)
    }
  }

  function clearImport() {
    setImports([])
    setSavedImportIds([])
    setArchiveStats([])
  }

  async function removeImport(id: number, whenSaved: boolean) {
    if (busyRef.current) return
    busyRef.current = true
    setError(null)
    const next = imports.filter((t) => t.tournamentId !== id)
    setImports(next)
    const nextSaved = savedImportIds.filter((x) => x !== id)
    setSavedImportIds(nextSaved)
    if (!whenSaved) {
      busyRef.current = false
      return
    }
    try {
      await api.tournaments.deleteImport(roomId, id)
      if (mountedRef.current) onChanged()
    } catch (e) {
      if (mountedRef.current) {
        setImports(imports)
        setSavedImportIds(savedImportIds)
        setError(e instanceof Error ? e.message : 'Не удалось удалить турнир')
      }
    } finally {
      busyRef.current = false
    }
  }

  async function preview() {
    if (busyRef.current) return
    busyRef.current = true
    setError(null)
    setBusy(true)
    try {
      const res = await api.tournaments.preview(roomId, date, collectLines(), imports)
      if (mountedRef.current) {
        setReconcile(res.reconcile)
        setWouldReanchor(res.wouldReanchor)
      }
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function save() {
    if (busyRef.current) return
    busyRef.current = true
    setError(null)
    setBusy(true)
    try {
      await api.tournaments.save(roomId, date, collectLines(), imports, removedImportIds)
      if (mountedRef.current) {
        onChanged()
        onClose()
      }
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function saveThen(action: 'adjust' | 'writeoff') {
    if (busyRef.current) return
    busyRef.current = true
    setError(null)
    setBusy(true)
    try {
      // «Списать на казино» rides along with the save: the server writes the
      // closing casino transaction in the same transaction as the import, so a
      // day can never end up saved-but-open. Only the balance adjustment stays a
      // second call — it rewrites the balance and needs the saved tournaments.
      const saved = await api.tournaments.save(roomId, date, collectLines(), imports, removedImportIds, action === 'writeoff')
      if (!mountedRef.current) return
      // The server may have re-anchored the balance to the import's own dates —
      // «Поправить баланс» must follow it there, the modal day may be empty now.
      const res = action === 'adjust' ? await api.tournaments.adjustBalance(roomId, saved.reanchored?.to ?? date) : saved.reconcile
      if (mountedRef.current) {
        setReconcile(res)
        setWouldReanchor(null)
        onChanged()
      }
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-slate-100">
            Турниры — <span style={{ color: room.color }}>{room.name}</span> — {date}
          </h2>
          <button onClick={onClose} tabIndex={-1} className="rounded-lg px-3 py-1 text-sm text-slate-400 transition hover:bg-slate-900 hover:text-slate-200">
            Закрыть
          </button>
        </div>

        {error && <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}

        <div className={rowGrid}>
          <span className={colCls}>Бай-ин</span>
          <span />
          <span className={colCls}>Результат</span>
          <button
            onClick={addRow}
            className="justify-self-end text-xs text-slate-400 transition hover:text-slate-200"
            title="Добавить строку"
          >
            + строка
          </button>
        </div>

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.id} className={rowGrid}>
              <input
                className={inputCls}
                value={r.buyin}
                onChange={(e) => setCell(r.id, 'buyin', e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                autoComplete="off"
                aria-label={`Бай-ин строки ${i + 1}`}
              />
              <span className="text-slate-600">→</span>
              <input
                className={inputCls}
                value={r.result}
                onChange={(e) => setCell(r.id, 'result', e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                autoComplete="off"
                aria-label={`Результат строки ${i + 1}`}
              />
              <button
                onClick={() => removeRow(r.id)}
                tabIndex={-1}
                disabled={rows.length === 1}
                title="Удалить строку"
                className="justify-self-end rounded-lg px-2 py-1 text-sm text-slate-500 transition hover:text-red-400 disabled:opacity-30"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-600">
          Пустые строки игнорируются; заполнен только бай-ин → результат считается 0. Профит турнира = результат − байин. Все суммы — в {currency};
          переводятся в USD по курсу дня.
        </p>

        {isGgRoom && (
        <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-200">Импорт из архива GG (отчёты .zip)</span>
            <label className="cursor-pointer rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-500">
              {importBusy || textBusy ? 'Разбор…' : 'Выбрать архивы'}
              <input
                ref={fileRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                multiple
                disabled={importBusy || textBusy}
                onChange={(e) => {
                  const selected = Array.from(e.target.files ?? [])
                  e.target.value = ''
                  if (selected.length > 0) void handleFiles(selected)
                }}
              />
            </label>
          </div>

          {importStats && (
            <div className="mt-3 text-sm">
              {importBlocked ? (
                <p className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-red-300">
                  В архиве нет файлов отчётов (.txt) — сохранять нечего.
                </p>
              ) : importHasFailures ? (
                <p className="rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-amber-300">
                  Не удалось разобрать часть отчётов — сохранены будут распознанные турниры ({importStats.parsed}). Остальные пропускаются, список ошибок ниже.
                </p>
              ) : (
                <p className="text-emerald-300">Разобрано турниров: {importStats.parsed} из {importStats.total} файлов.</p>
              )}
              {importStats.failed.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-red-400/80">
                  {importStats.failed.map((f) => (
                    <li key={`${f.source}-${f.error}`}>
                      {f.source}
                      {f.source && f.error ? ' — ' : ''}
                      {f.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        )}

        {isPokerDomRoom && (
        <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-200">Импорт из текста PokerDom (вставка из буфера)</span>
            <button
              onClick={() => void handleParseText()}
              disabled={textBusy || busy || importBusy}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-500 disabled:opacity-40"
            >
              {textBusy ? 'Разбор…' : 'Вставить и разобрать'}
            </button>
          </div>

          <textarea
            className={`${textareaCls} mt-3`}
            rows={5}
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            placeholder={'Вставьте текст отчёта PokerDom, например:\n16 сент., 14:00\nСупер Прогрессивный Нокаут 30 000 р.\nБЛ Холдем\n500 р.\n500 р.\t13\t1 288,05 р.'}
          />

          {textParsedCount > 0 && (
            <p className="mt-2 text-sm text-emerald-300">Разобрано турниров: {textParsedCount}.</p>
          )}

          {textErrors.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-xs text-amber-300">Не всё удалось разобрать ({textErrors.length} блоков):</p>
              <ul className="space-y-0.5 text-xs text-red-400/80">
                {textErrors.map((f, i) => (
                  <li key={i}>
                    {f.source ? `${f.source} — ` : ''}
                    {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        )}

        {imports.length > 0 && (() => {
          const importDays = [...new Set(imports.map((t) => t.date))].sort()
          const multiDay = importDays.length > 1 || (importDays.length === 1 && importDays[0] !== date)
          return (
            <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
              {multiDay && (
                <p className="text-xs text-slate-500">
                  Турниры из отчёта распределятся по датам: {importDays.join(', ')}.
                </p>
              )}
              <div className="mt-1 space-y-1">
                <div className={importGrid}>
                  <span className={colCls}>Дата</span>
                  <span className={colCls}>Турнир</span>
                  <span className={`${colCls} text-right`}>Бай-ин</span>
                  <span className={`${colCls} text-right`}>Результат</span>
                  <span className={`${colCls} text-right`}>Место</span>
                  <span className={`${colCls} text-right`} aria-hidden>Удалить</span>
                </div>
                {imports.map((t) => (
                  <div key={t.tournamentId} className={`${importGrid} text-sm text-slate-300`}>
                    <span className="tabular-nums text-slate-500">{t.date}</span>
                    <span className="truncate" title={t.name ?? t.tournamentId.toString()}>
                      {t.name ?? `#${t.tournamentId}`}
                    </span>
                    <span className="text-right tabular-nums">
                      {formatAmount(t.buyin, t.currency)}
                      {t.buyinUsd != null && <span className="ml-1 text-xs text-slate-500">≈{formatAmount(t.buyinUsd, 'USD')}</span>}
                    </span>
                    <span className="text-right tabular-nums">
                      {formatAmount(t.result, t.currency)}
                      {t.resultUsd != null && <span className="ml-1 text-xs text-slate-500">≈{formatAmount(t.resultUsd, 'USD')}</span>}
                    </span>
                    <span className="text-right tabular-nums text-slate-500">
                      {t.rank != null ? (t.entrants != null ? `${t.rank} из ${t.entrants}` : `${t.rank}`) : '—'}
                    </span>
                    <button
                      onClick={() => void removeImport(t.tournamentId, savedImportIds.includes(t.tournamentId))}
                      className="justify-self-end rounded px-1.5 text-slate-500 transition hover:bg-red-950/40 hover:text-red-300 disabled:opacity-40"
                      title="Удалить турнир"
                      aria-label={`Удалить турнир ${t.name ?? t.tournamentId}`}
                      disabled={importBusy || busy || textBusy}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              {importStats && (
                <button onClick={clearImport} className="mt-2 text-xs text-slate-400 transition hover:text-slate-200">
                  Убрать импорт
                </button>
              )}
            </div>
          )
        })()}

        <div className="flex gap-2">
          <button
            onClick={preview}
            disabled={busy || importBusy || textBusy}
            className="flex-1 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 disabled:opacity-40"
          >
            Проверить
          </button>
          <button
            onClick={save}
            disabled={busy || importBusy || textBusy || importBlocked}
            title={importBlocked ? 'В архиве нет файлов отчётов (.txt) — сохранять нечего' : importHasFailures ? 'Часть отчётов не разобрана — сохранятся распознанные турниры' : undefined}
            className="flex-1 rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-white disabled:opacity-40"
          >
            Сохранить
          </button>
        </div>

        {reconcile && (
          <div className={`space-y-3 rounded-xl border p-4 ${reconcile.flagged ? 'border-amber-800 bg-amber-950/30' : 'border-emerald-900 bg-emerald-950/30'}`}>
            {wouldReanchor && (
              <p className="text-xs text-slate-400">
                Баланс {wouldReanchor.from} будет привязан к {wouldReanchor.to} при сохранении — сверка выполняется на этот день.
              </p>
            )}
            <div className="text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Профит из баланса</span>
                <span className="font-medium tabular-nums text-slate-100">
                  {reconcile.sessionProfitUsd != null ? formatAmount(reconcile.sessionProfitUsd, 'USD') : reconcile.blank ?? '—'}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-slate-400">Профит турниров</span>
                <span className="font-medium tabular-nums text-slate-100">{formatAmount(reconcile.tournamentProfitUsd, 'USD')}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-slate-400">Казино</span>
                <span className="font-medium tabular-nums text-slate-100">{formatAmount(reconcile.casinoUsd, 'USD')}</span>
              </div>
              {reconcile.remainderUsd != null && (
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-slate-400">Остаток</span>
                  <span className={`font-medium tabular-nums ${reconcile.flagged ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {formatAmount(reconcile.remainderUsd, 'USD')}
                  </span>
                </div>
              )}
            </div>

            {reconcile.flagged ? (
              <div className="space-y-2">
                <p className="text-sm text-amber-200">
                  Расхождение {reconcile.discrepancyPct != null ? `${Math.round(reconcile.discrepancyPct * 100)}%` : ''} — больше 5%. Что делаем?
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => saveThen('adjust')}
                    disabled={busy || importBusy || textBusy || importBlocked}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-500 disabled:opacity-40"
                  >
                    Поправить баланс
                  </button>
                  <button
                    onClick={() => saveThen('writeoff')}
                    disabled={busy || importBusy || textBusy || importBlocked}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-500 disabled:opacity-40"
                  >
                    Списать на казино
                  </button>
                  <span className="self-center text-xs text-slate-500">или поправь строки и нажми «Проверить» снова</span>
                </div>
              </div>
            ) : reconcile.blank ? (
              // no basis to compare (no balance / only an interpolated one / no rate) — say why instead of a green "сходится"
              <p className="text-xs text-slate-400">{reconcile.blank}</p>
            ) : (
              <p className="text-xs text-emerald-300">Расхождение в пределах 5% — сходится.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}