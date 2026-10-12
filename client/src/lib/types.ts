export interface Room {
  id: number
  name: string
  cashCurrency: string
  tournamentCurrency: string
  rateSource: string | null
  color: string
  isWallet: boolean
  createdAt: string
}

export const DEFAULT_ROOM_COLOR = '#f1f5f9'

export const ROOM_COLORS: string[] = [
  '#f1f5f9',
  '#cbd5e1',
  '#fde68a',
  '#fef08a',
  '#d9f99d',
  '#bbf7d0',
  '#6ee7b7',
  '#5eead4',
  '#a5f3fc',
  '#bae6fd',
  '#bfdbfe',
  '#93c5fd',
  '#c7d2fe',
  '#a5b4fc',
  '#ddd6fe',
  '#c4b5fd',
  '#e9d5ff',
  '#fbcfe8',
  '#fda4af',
  '#fdba74'
]

export interface Notification {
  id: number
  kind: string
  message: string
  createdAt: string
  dismissedAt: string | null
}

export interface AppSettings {
  dayStartHour: number
}

export interface AppVersionInfo {
  version: string
  repository: string
}

export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string | null
  releaseUrl: string | null
  releaseNotes: string | null
}

export type TransactionType = 'deposit' | 'withdraw' | 'transfer' | 'casino'
export type Direction = 'in' | 'out'

export interface Transaction {
  id: number
  roomId: number
  roomName: string
  type: TransactionType
  amount: number
  fee: number
  currency: string
  direction: Direction
  counterpart: string | null
  destinationRoomId: number | null
  destinationRoomName: string | null
  date: string
  comment: string | null
  createdAt: string
  amountUsd: number | null
}

export interface FlowTotal {
  roomId: number
  currency: string
  direction: Direction
  total: number
}

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  deposit: 'Депозит',
  withdraw: 'Вывод',
  casino: 'Казино',
  transfer: 'Перевод'
}

export const DIRECTION_LABELS: Record<Direction, string> = {
  in: 'В рум',
  out: 'Из рума'
}

export interface BalanceEntry {
  roomId: number
  roomName: string
  date: string
  amount: number
  currency: string
  source: 'manual' | 'auto'
}

export interface RateInfo {
  date: string
  rate: number
}

export interface CurrentBalances {
  balances: Array<
    BalanceEntry & {
      amountUsd: number | null
      staleRate: boolean
      hasTournaments: boolean
      pendingImport: boolean
    }
  >
  totalUsd: number | null
  rates: { stale: boolean; usdRub: RateInfo | null; eurUsd: RateInfo | null }
}

export interface RoomProfit {
  roomId: number
  roomName: string
  currency: string
  delta: number
  flowInUsd: number
  flowOutUsd: number
  profitUsd: number | null
  casinoUsd: number
  pokerProfitUsd: number | null
  convertible: boolean
}

export interface SessionDay {
  date: string
  rooms: RoomProfit[]
  totalUsd: number | null
}

export type Currency = string

export const COMMON_CURRENCIES = ['RUB', 'USD', 'EUR', 'CNY'] as const

export interface RoomTemplate {
  key: string
  label: string
  insertName: string
  rateSource: string
  rateSourceLabel: string
}

export const RATE_SOURCE_LABEL: Record<string, string> = {
  pokerdom: 'Курс PokerDom (USD→RUB)',
  'er-api': 'Курс EUR/USD и CNY/USD (er-api)'
}

export interface TournamentRow {
  id: number
  roomId: number
  roomName: string
  date: string
  buyin: number
  result: number
  currency: string
  name: string | null
  rank: number | null
  entrants: number | null
  tournamentId: number | null
}

export interface TournamentLineInput {
  buyin: number
  result: number
  currency: string
}

export interface TournamentImportEntry {
  tournamentId: number
  name: string | null
  date: string
  buyin: number
  result: number
  rank: number | null
  entrants: number | null
  currency: string
  buyinUsd?: number | null
  resultUsd?: number | null
}

export interface TournamentImportFailure {
  source: string
  error: string
}

export interface TournamentImportResult {
  tournaments: TournamentImportEntry[]
  successfullyParsed: number
  failures: TournamentImportFailure[]
  totalSources: number
}

export interface TournamentDetailRow {
  date: string
  roomName: string
  place: string | null
  buyinUsd: number | null
  profitUsd: number | null
}

export interface TournamentGroup {
  key: string
  label: string
  count: number
  totalBuyinUsd: number
  totalProfitUsd: number
  roiPercent: number | null
  bestRank: number | null
  avgEntrants: number | null
  rows: TournamentDetailRow[]
}

export interface TournamentSummary {
  count: number
  totalBuyinUsd: number
  totalProfitUsd: number
  roiPercent: number | null
  blank: string | null
  groups: TournamentGroup[]
}

/** Per-buy-in row of the isolated Mystery Battle Royale breakdown. */
export interface MbrBreakdownRow {
  buyin: number
  count: number
  profit: number
  roi: number | null
  avgPosition: number | null
}

/** Isolated Mystery Battle Royale KPI block (server `mbr`). */
export interface MbrSummary {
  count: number
  totalBuyinUsd: number
  totalProfitUsd: number
  roiPercent: number | null
  avgPosition: number | null
  blank: string | null
  breakdown: MbrBreakdownRow[]
}

export interface DayReconcile {
  date: string
  roomId: number
  roomName: string
  sessionProfitUsd: number | null
  tournamentProfitUsd: number
  casinoUsd: number
  remainderUsd: number | null
  discrepancyPct: number | null
  flagged: boolean
  blank: string | null
}

export interface ReconcileFlag {
  date: string
  roomId: number
  roomName: string
  tournamentCount: number
  flagged: boolean
  remainderUsd: number | null
}

/** An orphaned discrepancy merged into the Депозиты и выводы tab. */
export interface OrphanedDiscrepancy {
  date: string
  roomId: number
  roomName: string
  amountUsd: number
}

export interface TimelinePoint {
  seq: number
  date: string
  roomId: number
  roomName: string
  profitUsd: number
  cumulativeUsd: number
}

export interface CalendarDay {
  date: string
  count: number
  profitUsd: number | null
}

export interface ActivityCalendar {
  year: number
  month: number
  totalCount: number
  totalProfitUsd: number
  blank: string | null
  days: CalendarDay[]
}

export interface SessionStat {
  date: string
  profitUsd: number | null
}

export interface TournamentPoint {
  seq: number
  date: string
  profitUsd: number
  cumulativeUsd: number
}

export interface TournamentDayCount {
  date: string
  count: number
}

export interface TopTournament {
  profitUsd: number
  date: string
  roomId: number
  roomName: string
}

export interface SessionStatsResult {
  sessions: SessionStat[]
  totalProfitUsd: number | null
  bestSessionUsd: number | null
  worstSessionUsd: number | null
  /** Total poker tournaments (MTT + MBR); `mbrCount` is the MBR subset. */
  tournamentCount: number
  mbrCount: number
  topTournament: TopTournament | null
  tournamentDays: TournamentDayCount[]
  profitSeries: TournamentPoint[]
  averageBuyinUsd: number | null
  roiPercent: number | null
}