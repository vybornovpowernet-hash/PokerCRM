import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import AdmZip from 'adm-zip'
import { createBackup } from '../scripts/backup.mjs'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeRoot(options: { withDiary?: boolean } = {}): string {
  const { withDiary = true } = options
  const root = mkdtempSync(join(tmpdir(), 'poker-crm-backup-test-'))
  roots.push(root)
  mkdirSync(join(root, 'data'), { recursive: true })
  const db = new DatabaseSync(join(root, 'data', 'poker-crm.sqlite'))
  db.exec('CREATE TABLE rooms (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
  db.exec("INSERT INTO rooms (name) VALUES ('GG')")
  db.close()
  if (withDiary) {
    mkdirSync(join(root, 'data', 'uploads', 'diary'), { recursive: true })
    writeFileSync(join(root, 'data', 'uploads', 'diary', 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  return root
}

describe('backup script', () => {
  it('packs the database snapshot and every diary photo into one archive', () => {
    const root = makeRoot()
    const dest = createBackup(root)

    expect(dest.endsWith('.zip')).toBe(true)
    expect(dest.startsWith(join(root, 'data', 'backups'))).toBe(true)
    expect(existsSync(dest)).toBe(true)

    const entries = new AdmZip(dest)
      .getEntries()
      .map((entry) => entry.entryName)
      .sort()
    expect(entries).toEqual(['poker-crm.sqlite', 'uploads/diary/photo.png'])
  })

  it('writes a readable, consistent snapshot of the live database', () => {
    const root = makeRoot()
    const dest = createBackup(root)

    const extracted = join(root, 'extracted')
    new AdmZip(dest).extractEntryTo('poker-crm.sqlite', extracted, false, true)
    const restored = new DatabaseSync(join(extracted, 'poker-crm.sqlite'), { readOnly: true })
    try {
      const rows = restored.prepare('SELECT name FROM rooms').all() as { name: string }[]
      expect(rows.map((row) => row.name)).toEqual(['GG'])
    } finally {
      restored.close()
    }
  })

  it('succeeds when no diary photos exist yet', () => {
    const root = makeRoot({ withDiary: false })
    const dest = createBackup(root)
    const entries = new AdmZip(dest).getEntries().map((entry) => entry.entryName)
    expect(entries).toEqual(['poker-crm.sqlite'])
  })

  it('leaves no temporary snapshot behind', () => {
    const root = makeRoot()
    const before = readdirSync(tmpdir())
    createBackup(root)
    const leaked = readdirSync(tmpdir()).filter((name) => !before.includes(name) && name.startsWith('poker-crm-backup-'))
    expect(leaked).toEqual([])

    const backups = readdirSync(join(root, 'data', 'backups'))
    expect(backups).toHaveLength(1)
    expect(backups[0]?.endsWith('.zip')).toBe(true)
  })

  it('fails loudly when the database is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'poker-crm-backup-test-'))
    roots.push(root)
    expect(() => createBackup(root)).toThrow(/DB not found/)
  })
})
