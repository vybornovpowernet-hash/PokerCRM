import { createApp } from './app.js'
import { closeDb, getDb } from './db.js'
import { recomputeAllBalances } from './services/balances.js'
import { autoRefresh } from './services/rates/refresh.js'
import { closeBrowser } from './services/rates/pokerdon.js'

getDb() // ensure data dir + schema exist at startup
// Rebuild the derived auto balance chain so the v18 fix takes effect immediately
// (manual snapshots are restored by the migration, auto rows are re-derived here).
recomputeAllBalances()

const app = await createApp({ logger: true })

const port = Number(process.env.PORT ?? 3001)
const host = '127.0.0.1'

let shuttingDown = false

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  const forceExit = setTimeout(() => process.exit(exitCode), 5000)
  try {
    app.log.info('Shutting down…')
    await closeBrowser()
    await app.close()
  } catch (err) {
    app.log.error({ err }, 'Shutdown step failed')
  } finally {
    clearTimeout(forceExit)
    try {
      closeDb()
    } catch (err) {
      app.log.error({ err }, 'Failed to close the database')
    }
    process.exit(exitCode)
  }
}

process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))
process.on('SIGBREAK', () => void shutdown(0))
process.on('uncaughtException', (err) => {
  app.log.error({ err }, 'Uncaught exception')
  void shutdown(1)
})
process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason instanceof Error ? reason : new Error(String(reason)) }, 'Unhandled rejection')
  void shutdown(1)
})

try {
  const address = await app.listen({ port, host })
  app.log.info(`Poker CRM running at ${address}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

// Rates: mandatory refresh at startup + every 4 hours; a failed refresh arms a
// self-healing backoff retry (autoRefresh), so boot/transient failures resolve
// on their own instead of leaving a stale notification for hours.
void autoRefresh()
  .then((r) => app.log.info(`Rates on startup: PokerDom=${r.usdRub ? 'ok' : 'failed'}, EUR/USD=${r.eurUsd ? 'ok' : 'failed'}, CNY/USD=${r.cnyUsd ? 'ok' : 'failed'}`))
  .catch((err) => app.log.error('Startup rates refresh failed', err))

setInterval(() => {
  void autoRefresh()
    .then((r) => {
      app.log.info(`Rates refreshed (every 4h): PokerDom=${r.usdRub ? 'ok' : 'failed'}, EUR/USD=${r.eurUsd ? 'ok' : 'failed'}, CNY/USD=${r.cnyUsd ? 'ok' : 'failed'}`)
    })
    .catch((err) => app.log.error('Periodic rates refresh failed', err))
}, 4 * 60 * 60 * 1000).unref()