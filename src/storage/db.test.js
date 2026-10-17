import { IDBFactory } from 'fake-indexeddb'
import {
  DB_NAME,
  DB_VERSION,
  ENTRIES_STORE,
  SETTINGS_STORE,
  openDatabase,
  getAllEntries,
  putEntry,
  removeEntry,
  getSettings,
  saveSettings,
  seedSampleEntry,
  dismissSampleEntry,
} from './db.js'

const entry = (overrides = {}) => ({
  id: 'id-1',
  date: '2026-10-17',
  content: 'Hello',
  language: 'auto',
  createdAt: '2026-10-17T01:00:00.000Z',
  updatedAt: '2026-10-17T01:00:00.000Z',
  deleted: false,
  deletedAt: null,
  isSample: false,
  analysis: null,
  ...overrides,
})

// A fresh in-memory IndexedDB per test keeps tests fully isolated.
let factory
let db

beforeEach(async () => {
  factory = new IDBFactory()
  db = await openDatabase({ factory })
})

afterEach(() => {
  db?.close()
})

describe('openDatabase', () => {
  it('creates the entries and settings stores on first open', () => {
    expect(db.name).toBe(DB_NAME)
    expect(db.version).toBe(DB_VERSION)
    expect([...db.objectStoreNames].sort()).toEqual(
      [ENTRIES_STORE, SETTINGS_STORE].sort(),
    )
    const tx = db.transaction(ENTRIES_STORE, 'readonly')
    expect(tx.objectStore(ENTRIES_STORE).keyPath).toBe('id')
  })

  it('rejects when IndexedDB is unavailable', async () => {
    await expect(openDatabase({ factory: null })).rejects.toThrow()
  })

  it('rejects when the stored database version is newer than ours', async () => {
    db.close()
    // Simulate a database created by a newer app version.
    await new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION + 1)
      req.onsuccess = () => {
        req.result.close()
        resolve()
      }
      req.onerror = () => reject(req.error)
    })
    await expect(openDatabase({ factory })).rejects.toThrow()
    db = null
  })
})

describe('entries', () => {
  it('returns an empty array when nothing is stored', async () => {
    expect(await getAllEntries(db)).toEqual([])
  })

  it('reads back a written entry unchanged', async () => {
    await putEntry(db, entry())
    expect(await getAllEntries(db)).toEqual([entry()])
  })

  it('overwrites an entry with the same id instead of adding a new one', async () => {
    await putEntry(db, entry())
    await putEntry(db, entry({ content: 'Edited', updatedAt: '2026-10-18T00:00:00.000Z' }))
    const all = await getAllEntries(db)
    expect(all).toHaveLength(1)
    expect(all[0].content).toBe('Edited')
  })

  it('stores multiple entries and returns them all', async () => {
    await putEntry(db, entry({ id: 'a' }))
    await putEntry(db, entry({ id: 'b' }))
    expect((await getAllEntries(db)).map((e) => e.id).sort()).toEqual(['a', 'b'])
  })

  it('stores and returns a soft-delete tombstone with only its 4 fields', async () => {
    const tombstone = {
      id: 'id-1',
      updatedAt: '2026-10-18T00:00:00.000Z',
      deleted: true,
      deletedAt: '2026-10-18T00:00:00.000Z',
    }
    await putEntry(db, entry())
    await putEntry(db, tombstone)
    expect(await getAllEntries(db)).toEqual([tombstone])
  })

  it('rejects when the entry has no id', async () => {
    await expect(putEntry(db, { content: 'no id' })).rejects.toThrow()
    expect(await getAllEntries(db)).toEqual([])
  })

  it('removes an entry entirely by id', async () => {
    await putEntry(db, entry({ id: 'sample', isSample: true }))
    await putEntry(db, entry({ id: 'keep' }))
    await removeEntry(db, 'sample')
    expect((await getAllEntries(db)).map((e) => e.id)).toEqual(['keep'])
  })

  it('resolves when removing an id that does not exist', async () => {
    await expect(removeEntry(db, 'missing')).resolves.toBeUndefined()
  })
})

describe('settings', () => {
  it('defaults sampleDismissed to false when nothing is stored', async () => {
    expect(await getSettings(db)).toEqual({ sampleDismissed: false })
  })

  it('reads back a saved sampleDismissed value', async () => {
    await saveSettings(db, { sampleDismissed: true })
    expect(await getSettings(db)).toEqual({ sampleDismissed: true })
  })

  it('ignores unknown setting keys', async () => {
    // toString / constructor exist on Object.prototype and must not be
    // mistaken for known settings.
    await saveSettings(db, {
      sampleDismissed: true,
      somethingElse: 'x',
      toString: 'x',
      constructor: 'x',
    })
    expect(await getSettings(db)).toEqual({ sampleDismissed: true })
    // getSettings only reads known keys, so inspect the raw store to make
    // sure the unknown key was never written.
    const keys = await new Promise((resolve, reject) => {
      const request = db
        .transaction(SETTINGS_STORE, 'readonly')
        .objectStore(SETTINGS_STORE)
        .getAllKeys()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    expect(keys).toEqual(['sampleDismissed'])
  })

  it('leaves settings unchanged when saving an empty object', async () => {
    await saveSettings(db, { sampleDismissed: true })
    await saveSettings(db, {})
    expect(await getSettings(db)).toEqual({ sampleDismissed: true })
  })
})

describe('persistence', () => {
  it('keeps entries and settings after closing and reopening the database', async () => {
    await putEntry(db, entry())
    await saveSettings(db, { sampleDismissed: true })
    db.close()

    db = await openDatabase({ factory })
    expect(await getAllEntries(db)).toEqual([entry()])
    expect(await getSettings(db)).toEqual({ sampleDismissed: true })
  })
})

describe('seedSampleEntry', () => {
  const sample = entry({ id: 'sample-id', isSample: true, date: '2026-10-17' })

  it('puts the sample on first run and reports it was added', async () => {
    expect(await seedSampleEntry(db, sample)).toBe(true)
    expect(await getAllEntries(db)).toEqual([sample])
  })

  it('does not add a second copy or overwrite the existing sample', async () => {
    await seedSampleEntry(db, sample)
    const later = { ...sample, date: '2026-12-31', updatedAt: '2026-12-31T00:00:00.000Z' }
    expect(await seedSampleEntry(db, later)).toBe(false)
    expect(await getAllEntries(db)).toEqual([sample])
  })

  it('adds the sample only once when run concurrently', async () => {
    const results = await Promise.all([
      seedSampleEntry(db, sample),
      seedSampleEntry(db, { ...sample, date: '2026-12-31' }),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    const all = await getAllEntries(db)
    expect(all).toHaveLength(1)
    // The first transaction wins; the second must not overwrite it.
    expect(all[0].date).toBe('2026-10-17')
  })

  it('does not add the sample once it has been dismissed', async () => {
    await saveSettings(db, { sampleDismissed: true })
    expect(await seedSampleEntry(db, sample)).toBe(false)
    expect(await getAllEntries(db)).toEqual([])
  })

  it('leaves other entries untouched', async () => {
    await putEntry(db, entry({ id: 'mine' }))
    await seedSampleEntry(db, sample)
    expect((await getAllEntries(db)).map((e) => e.id).sort()).toEqual(['mine', 'sample-id'])
  })
})

describe('dismissSampleEntry', () => {
  const sample = entry({ id: 'sample-id', isSample: true })

  it('removes the sample record entirely and sets sampleDismissed', async () => {
    await seedSampleEntry(db, sample)
    await putEntry(db, entry({ id: 'mine' }))

    await dismissSampleEntry(db, 'sample-id')

    // No tombstone is left behind for the sample.
    expect((await getAllEntries(db)).map((e) => e.id)).toEqual(['mine'])
    expect(await getSettings(db)).toEqual({ sampleDismissed: true })
  })

  it('keeps the sample away on later seeding', async () => {
    await seedSampleEntry(db, sample)
    await dismissSampleEntry(db, 'sample-id')
    expect(await seedSampleEntry(db, sample)).toBe(false)
    expect(await getAllEntries(db)).toEqual([])
  })

  it('still records the dismissal when the sample record is already gone', async () => {
    await dismissSampleEntry(db, 'sample-id')
    expect(await getSettings(db)).toEqual({ sampleDismissed: true })
  })

  it('changes neither store when the transaction fails', async () => {
    await seedSampleEntry(db, sample)
    // An invalid key makes delete() throw, which must abort the whole
    // transaction so sampleDismissed is not set on its own.
    await expect(dismissSampleEntry(db, {})).rejects.toThrow()
    expect(await getAllEntries(db)).toEqual([sample])
    expect(await getSettings(db)).toEqual({ sampleDismissed: false })
  })
})
