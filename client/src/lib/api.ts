import type {
  ActivityView,
  AppSettings,
  AppVersionInfo,
  BalanceEntry,
  CurrentBalances,
  DayReconcile,
  FlowTotal,
  MbrSummary,
  Notification,
  OrphanedDiscrepancy,
  ReconcileFlag,
  RateInfo,
  Room,
  RoomTemplate,
  SessionDay,
  SessionStatsResult,
  SystemUpdateResult,
  TimelinePoint,
  TournamentImportEntry,
  TournamentImportResult,
  TournamentLineInput,
  TournamentRow,
  TournamentSummary,
  Transaction,
  TransactionType,
  UpdateCheckResult,
  WriteoffReason
} from './types'

const REQUEST_TIMEOUT_MS = 15_000
export const UPLOAD_TIMEOUT_MS = 60_000

interface RequestOptions extends RequestInit {
  timeoutMs?: number
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const signal = options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
  try {
    const headers = new Headers(options?.headers)
    const isForm = options?.body instanceof FormData
    if (options?.body && !isForm && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    const res = await fetch(`/api${path}`, {
      ...options,
      headers,
      signal
    })
    if (!res.ok) {
      let message = `Request failed (${res.status})`
      try {
        const body = (await res.json()) as { error?: string }
        if (body.error) message = body.error
      } catch {
        // ignore parse errors
      }
      throw new Error(message)
    }
    return (await res.json()) as T
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Сервер не ответил в течение ${Math.round(timeoutMs / 1000)} секунд`, { cause: err })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export function queryString(params: Record<string, string | number | undefined>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
  return qs ? `?${qs}` : ''
}

export interface RoomPayload {
  name: string
  cashCurrency: string
  tournamentCurrency: string
  rateSource?: string | null
  color?: string
  isWallet?: boolean
}

export interface TransactionPayload {
  roomId: number
  type: TransactionType
  amount: number
  fee?: number
  currency: string
  direction?: 'in' | 'out'
  counterpart?: string | null
  destinationRoomId?: number | null
  date: string
  comment?: string | null
}

export const api = {
  rooms: {
    list: () => request<{ rooms: Room[] }>('/rooms').then((r) => r.rooms),
    create: (payload: RoomPayload) => request<{ room: Room }>('/rooms', { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.room),
    update: (id: number, payload: Partial<RoomPayload>) =>
      request<{ room: Room }>(`/rooms/${id}`, { method: 'PUT', body: JSON.stringify(payload) }).then((r) => r.room),
    remove: (id: number) => request<{ ok: true }>(`/rooms/${id}`, { method: 'DELETE' }),
    templates: () => request<{ templates: RoomTemplate[] }>('/rooms/templates').then((r) => r.templates)
  },
  transactions: {
    list: (filters: { type?: TransactionType; roomId?: number; dateFrom?: string; dateTo?: string } = {}) =>
      request<{ transactions: Transaction[]; discrepancies: OrphanedDiscrepancy[] }>(
        `/transactions${queryString({
          ...filters,
          includeDiscrepancies: filters.type ? undefined : '1'
        })}`
      ).then((r) => ({ transactions: r.transactions, discrepancies: r.discrepancies ?? [] })),
    flows: (dateFrom: string, dateTo: string) =>
      request<{ flows: FlowTotal[] }>(`/transactions/flows${queryString({ dateFrom, dateTo })}`).then((r) => r.flows),
    create: (payload: TransactionPayload) =>
      request<{ transaction: Transaction }>('/transactions', { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.transaction),
    update: (id: number, payload: TransactionPayload) =>
      request<{ transaction: Transaction }>(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(payload) }).then((r) => r.transaction),
    remove: (id: number) => request<{ ok: true }>(`/transactions/${id}`, { method: 'DELETE' }),
    writeoffDiscrepancy: (roomId: number, date: string, comment: string, reason: WriteoffReason = 'casino') =>
      request<{ reconcile: DayReconcile }>('/transactions/writeoff-discrepancy', {
        method: 'POST',
        body: JSON.stringify({ roomId, date, comment, reason })
      }).then((r) => r.reconcile)
  },
  balances: {
    list: (date?: string) => request<{ balances: BalanceEntry[] }>(`/balances${date ? `?date=${date}` : ''}`).then((r) => r.balances),
    current: () => request<CurrentBalances>('/balances/current'),
    upsert: (payload: { roomId: number; date: string; amount: number; currency: string }) =>
      request<{ balance: BalanceEntry }>('/balances', { method: 'PUT', body: JSON.stringify(payload) }).then((r) => r.balance)
  },
  sessions: {
    list: (dateFrom: string, dateTo: string) =>
      request<{ sessions: SessionDay[] }>(`/sessions${queryString({ dateFrom, dateTo })}`).then((r) => r.sessions)
  },
  tournaments: {
    list: (roomId: number, date: string) =>
      request<{ rows: TournamentRow[] }>(`/tournaments${queryString({ roomId, date })}`).then((r) => r.rows),
    save: (
      roomId: number,
      date: string,
      lines: TournamentLineInput[],
      imports: TournamentImportEntry[] = [],
      removedImportIds: number[] = [],
      /** null = plain save; a reason closes the day in the same request. */
      writeoff: WriteoffReason | null = null
    ) =>
      request<{ rows: TournamentRow[]; reconcile: DayReconcile; days: DayReconcile[]; reanchored: { from: string; to: string } | null }>('/tournaments/bulk', {
        method: 'POST',
        body: JSON.stringify({
          roomId,
          date,
          lines,
          imports,
          removedImportIds,
          writeoff: writeoff !== null,
          writeoffReason: writeoff ?? undefined
        }),
        timeoutMs: UPLOAD_TIMEOUT_MS
      }),
    preview: (
      roomId: number,
      date: string,
      lines: TournamentLineInput[],
      imports: TournamentImportEntry[] = []
    ) =>
      request<{ reconcile: DayReconcile; wouldReanchor: { from: string; to: string } | null }>('/tournaments/preview', {
        method: 'POST',
        body: JSON.stringify({ roomId, date, lines, imports })
      }).then((r) => ({ reconcile: r.reconcile, wouldReanchor: r.wouldReanchor ?? null })),
    importGg: (roomId: number, file: File) => {
      const form = new FormData()
      form.append('file', file, file.name)
      return request<TournamentImportResult>(`/tournaments/import/${roomId}`, { method: 'POST', body: form, timeoutMs: UPLOAD_TIMEOUT_MS })
    },
    importPokerDom: (roomId: number, text: string) =>
      request<TournamentImportResult>(`/tournaments/import/${roomId}`, {
        method: 'POST',
        body: JSON.stringify({ text })
      }),
    deleteImport: (roomId: number, tournamentId: number) =>
      request<{ ok: true }>('/tournaments/delete-import', {
        method: 'POST',
        body: JSON.stringify({ roomId, tournamentId })
      }),
    reconcile: (roomId: number, date: string) =>
      request<{ reconcile: DayReconcile }>(`/tournaments/reconcile${queryString({ roomId, date })}`).then((r) => r.reconcile),
    reconcileSummary: (dateFrom: string, dateTo: string) =>
      request<{ flags: ReconcileFlag[] }>(`/tournaments/reconcile-summary${queryString({ dateFrom, dateTo })}`).then((r) => r.flags),
    adjustBalance: (roomId: number, date: string) =>
      request<{ reconcile: DayReconcile }>('/tournaments/adjust-balance', {
        method: 'POST',
        body: JSON.stringify({ roomId, date })
      }).then((r) => r.reconcile),
    acknowledgeDiscrepancy: (roomId: number, date: string, note?: string) =>
      request<{ reconcile: DayReconcile }>('/tournaments/acknowledge-discrepancy', {
        method: 'POST',
        body: JSON.stringify({ roomId, date, note })
      }).then((r) => r.reconcile),
    revokeDiscrepancyAck: (roomId: number, date: string) =>
      request<{ reconcile: DayReconcile }>('/tournaments/acknowledge-discrepancy', {
        method: 'DELETE',
        body: JSON.stringify({ roomId, date })
      }).then((r) => r.reconcile),
    summary: (dateFrom: string, dateTo: string, roomIds?: number[]) =>
      request<{ summary: TournamentSummary; mbr: MbrSummary }>(
        `/tournaments/summary${queryString({ dateFrom, dateTo, roomIds: roomIds && roomIds.length > 0 ? roomIds.join(',') : undefined })}`
      )
  },
  statistics: {
    timeline: () => request<{ timeline: TimelinePoint[] }>('/statistics/timeline').then((r) => r.timeline),
    calendar: (dateFrom: string, dateTo: string, roomIds?: number[]) =>
      request<{ activity: ActivityView }>(
        `/statistics/activity${queryString({ dateFrom, dateTo, roomIds: roomIds && roomIds.length > 0 ? roomIds.join(',') : undefined })}`
      ).then((r) => r.activity),
    sessions: (dateFrom: string, dateTo: string, roomIds?: number[]) =>
      request<{ stats: SessionStatsResult }>(
        `/statistics/sessions${queryString({ dateFrom, dateTo, roomIds: roomIds ? roomIds.join(',') : undefined })}`
      ).then((r) => r.stats)
  },
  notifications: {
    list: () => request<{ notifications: Notification[] }>('/notifications').then((r) => r.notifications),
    dismiss: (id: number) => request<{ ok: true }>(`/notifications/${id}/dismiss`, { method: 'POST' })
  },
  settings: {
    get: () => request<{ settings: AppSettings }>('/settings').then((r) => r.settings),
    update: (dayStartHour: number) =>
      request<{ settings: AppSettings }>('/settings', { method: 'PUT', body: JSON.stringify({ dayStartHour }) }).then((r) => r.settings)
  },
  system: {
    version: () => request<AppVersionInfo>('/system/version'),
    checkUpdates: () => request<UpdateCheckResult>('/system/check-updates'),
    update: () => request<SystemUpdateResult>('/system/update', { method: 'POST', timeoutMs: UPLOAD_TIMEOUT_MS })
  },
  rates: {
    status: () =>
      request<{ usdRub: RateInfo; eurUsd: RateInfo; cnyUsd: RateInfo; stale: boolean }>('/rates/status')
  }
}