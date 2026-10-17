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
