import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const db = join(root, 'data', 'poker-crm.sqlite')
const backupsDir = join(root, 'data', 'backups')

if (!existsSync(db)) {
  console.error('DB not found:', db)
  process.exit(1)
}

mkdirSync(backupsDir, { recursive: true })

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const dest = join(backupsDir, `poker-crm-${stamp}.sqlite`)

// The app runs on a live connection in WAL mode, so committed rows may still sit
// in the -wal file. A plain file copy can miss them, so the backup is taken with
// VACUUM INTO: it reads a consistent snapshot (WAL included) and writes one
// self-contained file.
const source = new DatabaseSync(db, { readOnly: true })
try {
  source.exec('PRAGMA busy_timeout = 5000')
  source.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`)
} finally {
  source.close()
}

console.log('Backup saved:', dest)