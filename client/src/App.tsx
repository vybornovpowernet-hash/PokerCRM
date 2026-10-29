import { lazy, Suspense, useEffect, useState } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import BalancesPage from './pages/Balances'
import SessionsPage from './pages/Sessions'
import RoomsPage from './pages/Rooms'
import TransactionsPage from './pages/Transactions'
import TournamentsPage from './pages/Tournaments'
import { ErrorBoundary } from './components/ErrorBoundary'
import { GearIcon, SettingsModal } from './components/SettingsModal'
import { api } from './lib/api'
import { formatAmount } from './lib/money'
import { onBalancesChanged } from './lib/events'
import { usePoll } from './lib/usePoll'
import type { Notification } from './lib/types'

type TabId = 'balances' | 'sessions' | 'rooms' | 'transactions' | 'tournaments' | 'goals' | 'habits' | 'stats'

const TABS: { id: TabId; label: string }[] = [
  { id: 'balances', label: 'Балансы' },
  { id: 'sessions', label: 'Сессии' },
  { id: 'rooms', label: 'Румы' },
  { id: 'transactions', label: 'Транзакции' },
  { id: 'tournaments', label: 'Турниры' },
  { id: 'goals', label: 'Цели' },
  { id: 'habits', label: 'Привычки' },
  { id: 'stats', label: 'Статистика' }
]

const GoalsPage = lazy(() => import('./goals/GoalsPage').then((m) => ({ default: m.GoalsPage })))
const HabitsPage = lazy(() => import('./habits/HabitsPage').then((m) => ({ default: m.HabitsPage })))
const GoalToasts = lazy(() => import('./goals/components/GoalToasts').then((m) => ({ default: m.GoalToasts })))
// Statistics carries Recharts + d3 (~300 kB minified): it must not ride along in
// the entry bundle for users who never open the tab.
const StatsPage = lazy(() => import('./pages/Statistics'))

const TAB_KEY = 'poker-crm-tab'

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const saved = localStorage.getItem(TAB_KEY)
    return TABS.some((t) => t.id === saved) ? (saved as TabId) : 'balances'
  })
  const [health, setHealth] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(TAB_KEY, activeTab)
  }, [activeTab])

  usePoll(async () => {
    try {
      const res = await fetch('/api/health')
      const body = (await res.json()) as { ok?: boolean }
      setHealth(body.ok ? 'online' : 'offline')
    } catch {
      setHealth('offline')
    }
  }, 30_000)

  useEffect(() => {
    api.rooms.list().catch(() => undefined)
  }, [])

  const pages: Record<TabId, React.ReactNode> = {
    balances: <BalancesPage />,
    sessions: <SessionsPage />,
    rooms: <RoomsPage />,
    transactions: <TransactionsPage />,
    tournaments: <TournamentsPage />,
    goals: <GoalsPage />,
    habits: <HabitsPage />,
    stats: <StatsPage />
  }

  // Always use the wider shell to avoid layout shift between tabs (habits needs it)
  const contentWidth = 'max-w-[90rem]'

  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <div className="min-h-screen">
          <NotificationsBanner />
          <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
            <div className={`mx-auto flex ${contentWidth} flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-3`}>
              <div className="flex shrink-0 items-baseline gap-3">
                <h1 className="shrink-0 whitespace-nowrap text-lg font-semibold tracking-tight text-slate-100">Poker CRM</h1>
                {health && (
                  <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-500">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${health === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    {health}
                  </span>
                )}
                <BankrollBadge />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <nav className="flex flex-wrap items-center gap-1.5 whitespace-nowrap">
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm transition ${
                        activeTab === tab.id ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>
                <button
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Настройки"
                  title="Настройки"
                  className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-900 hover:text-slate-200"
                >
                  <GearIcon />
                </button>
              </div>
            </div>
          </header>
          {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
          <main className={`mx-auto ${contentWidth} px-6 py-6`}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.18, ease: 'easeOut' } }}
                exit={
                  activeTab === 'goals'
                    ? { opacity: 0, y: -8, transition: { duration: 0.25, ease: 'easeOut' } }
                    : { opacity: 0, transition: { duration: 0 } }
                }
              >
                <Suspense fallback={<TabLoader />}>{pages[activeTab]}</Suspense>
              </motion.div>
            </AnimatePresence>
          </main>
          <Suspense fallback={null}>
            <GoalToasts />
          </Suspense>
        </div>
      </MotionConfig>
    </ErrorBoundary>
  )
}

function TabLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <motion.span
        className="h-6 w-6 rounded-full border-2 border-slate-700 border-t-indigo-400"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
      />
    </div>
  )
}

function BankrollBadge() {
  const [totalUsd, setTotalUsd] = useState<number | null>(null)

  const load = () => {
    return api.balances
      .current()
      .then((d) => setTotalUsd(d.totalUsd))
      .catch(() => setTotalUsd(null))
  }

  usePoll(load, 30_000)

  useEffect(() => {
    return onBalancesChanged(load)
  }, [])

  return (
    <span className="ml-2 shrink-0 whitespace-nowrap text-lg text-slate-400">
      <span className="shrink-0">Банкролл:</span>
      <span className="ml-1.5 font-semibold tabular-nums text-emerald-400">{totalUsd != null ? formatAmount(totalUsd, 'USD') : '—'}</span>
    </span>
  )
}

function NotificationsBanner() {
  const [notifications, setNotifications] = useState<Notification[]>([])

  usePoll(() => {
    return api.notifications
      .list()
      .then(setNotifications)
      .catch(() => undefined)
  }, 30_000)

  if (notifications.length === 0) return null

  return (
    <div className="border-b border-amber-900/60 bg-amber-950/60">
      <div className="mx-auto flex max-w-7xl flex-col gap-1 px-6 py-2">
        {notifications.map((n) => (
          <div key={n.id} className="flex items-center justify-between gap-3 text-sm text-amber-200">
            <span>
              <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />
              {n.message}
            </span>
            <button
              onClick={() => api.notifications.dismiss(n.id).then(() => setNotifications((prev) => prev.filter((x) => x.id !== n.id)))}
              className="ml-auto shrink-0 rounded px-2 py-0.5 text-xs text-amber-300/70 hover:bg-amber-900/50 hover:text-amber-100"
            >
              Понятно
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}