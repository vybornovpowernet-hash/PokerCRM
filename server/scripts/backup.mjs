import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import AdmZip from 'adm-zip'

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * One self-contained archive: the WAL-safe database snapshot plus every diary
 * photo. A DB-only backup restores rows whose `images` point at files that were
 * never copied, so both halves have to travel together.
 */
export function createBackup(root = DEFAULT_ROOT) {
  const db = join(root, 'data', 'poker-crm.sqlite')
  const diaryDir = join(root, 'data', 'uploads', 'diary')
  const backupsDir = join(root, 'data', 'backups')

  if (!existsSync(db)) throw new Error(`DB not found: ${db}`)

  mkdirSync(backupsDir, { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')

  // The app runs on a live connection in WAL mode, so committed rows may still sit
  // in the -wal file. A plain file copy can miss them, so the backup is taken with
  // VACUUM INTO: it reads a consistent snapshot (WAL included) and writes one
  // self-contained file.
  const snapshot = join(tmpdir(), `poker-crm-backup-${stamp}.sqlite`)
  const source = new DatabaseSync(db, { readOnly: true })
  try {
    source.exec('PRAGMA busy_timeout = 5000')
    source.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`)
  } finally {
    source.close()
  }

  const dest = join(backupsDir, `poker-crm-${stamp}.zip`)
  try {
    const zip = new AdmZip()
    zip.addLocalFile(snapshot, '', 'poker-crm.sqlite')
    if (existsSync(diaryDir) && readdirSync(diaryDir).length > 0) {
      zip.addLocalFolder(diaryDir, 'uploads/diary')
    }
    zip.writeZip(dest)
  } finally {
    rmSync(snapshot, { force: true })
  }

  return dest
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  try {
    console.log('Backup saved:', createBackup())
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
