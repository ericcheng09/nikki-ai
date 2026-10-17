import { IDBFactory } from 'fake-indexeddb'
import {
  DB_NAME,
  DB_VERSION,
  ENTRIES_STORE,
  SETTINGS_STORE,
  openDatabase,
  getAllEntries,
  putEntry,
  getSettings,
  saveSettings,
  putEntryAddingLanguage,
  removeCustomLanguage,
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
})

describe('settings', () => {
  const rawKeys = () =>
    new Promise((resolve, reject) => {
      const request = db
        .transaction(SETTINGS_STORE, 'readonly')
        .objectStore(SETTINGS_STORE)
        .getAllKeys()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

  it('reads back a saved geminiApiKey without touching other settings', async () => {
    await saveSettings(db, { welcomeSeen: true })
    await saveSettings(db, { geminiApiKey: 'test-key' })
    expect(await getSettings(db)).toEqual({
      welcomeSeen: true,
      geminiApiKey: 'test-key',
      geminiModel: '',
      customLanguages: [],
    })
  })

  it('saves geminiModel independently of the API key', async () => {
    await saveSettings(db, { geminiApiKey: 'test-key' })
    await saveSettings(db, { geminiModel: 'models/gemini-2.5-flash' })
    await saveSettings(db, { geminiApiKey: '' })
    const settings = await getSettings(db)
    expect(settings.geminiModel).toBe('models/gemini-2.5-flash')
    expect(settings.geminiApiKey).toBe('')
  })

  it('can clear geminiApiKey back to an empty string', async () => {
    await saveSettings(db, { geminiApiKey: 'test-key' })
    await saveSettings(db, { geminiApiKey: '', geminiModel: '', customLanguages: [] })
    expect((await getSettings(db)).geminiApiKey).toBe('')
  })

  it('defaults welcomeSeen to false when nothing is stored', async () => {
    expect(await getSettings(db)).toEqual({ welcomeSeen: false, geminiApiKey: '', geminiModel: '', customLanguages: [] })
  })

  it('reads back a saved welcomeSeen value', async () => {
    await saveSettings(db, { welcomeSeen: true })
    expect(await getSettings(db)).toEqual({ welcomeSeen: true, geminiApiKey: '', geminiModel: '', customLanguages: [] })
  })

  it('ignores unknown setting keys, including inherited names', async () => {
    // toString / constructor exist on Object.prototype and must not be
    // mistaken for known settings.
    await saveSettings(db, {
      welcomeSeen: true,
      unknownFlag: true,
      toString: 'x',
      constructor: 'x',
    })
    expect(await getSettings(db)).toEqual({ welcomeSeen: true, geminiApiKey: '', geminiModel: '', customLanguages: [] })
    // getSettings only reads known keys, so inspect the raw store to make
    // sure only the known key was written.
    expect(await rawKeys()).toEqual(['welcomeSeen'])
  })

  it('leaves settings unchanged when saving an empty object', async () => {
    await saveSettings(db, { welcomeSeen: true })
    await saveSettings(db, {})
    expect(await getSettings(db)).toEqual({ welcomeSeen: true, geminiApiKey: '', geminiModel: '', customLanguages: [] })
  })
})

describe('persistence', () => {
  it('keeps entries and settings after closing and reopening the database', async () => {
    await putEntry(db, entry())
    await saveSettings(db, { welcomeSeen: true })
    db.close()

    db = await openDatabase({ factory })
    expect(await getAllEntries(db)).toEqual([entry()])
    expect(await getSettings(db)).toEqual({ welcomeSeen: true, geminiApiKey: '', geminiModel: '', customLanguages: [] })
  })
})

describe('settings defaults', () => {
  it('gives every caller its own customLanguages array', async () => {
    const first = await getSettings(db)
    first.customLanguages.push({ name: 'x' })
    const second = await getSettings(db)
    expect(second.customLanguages).toEqual([])
    expect(second.customLanguages).not.toBe(first.customLanguages)
  })

  it('saves and reads back customLanguages', async () => {
    const list = [{ name: '韓文', updatedAt: 'T', deleted: false, deletedAt: null }]
    await saveSettings(db, { customLanguages: list })
    expect((await getSettings(db)).customLanguages).toEqual(list)
  })
})

describe('putEntryAddingLanguage', () => {
  const NOW = new Date('2026-10-18T00:00:00.000Z')
  const NOW_ISO = NOW.toISOString()
  const item = (name, overrides = {}) => ({
    name,
    updatedAt: '2026-10-01T00:00:00.000Z',
    deleted: false,
    deletedAt: null,
    ...overrides,
  })

  // Counts writes to the settings store by recording put() calls.
  function spyOnSettingsPuts() {
    const keys = []
    const original = db.transaction.bind(db)
    vi.spyOn(db, 'transaction').mockImplementation((...args) => {
      const tx = original(...args)
      const originalStore = tx.objectStore.bind(tx)
      tx.objectStore = (name) => {
        const store = originalStore(name)
        if (name === SETTINGS_STORE) {
          const put = store.put.bind(store)
          store.put = (value, key) => {
            keys.push(key)
            return put(value, key)
          }
        }
        return store
      }
      return tx
    })
    return keys
  }

  it('saves the entry and appends a new custom language', async () => {
    await putEntryAddingLanguage(db, entry({ language: '韓文' }), '韓文', { now: NOW })
    expect(await getAllEntries(db)).toEqual([entry({ language: '韓文' })])
    expect((await getSettings(db)).customLanguages).toEqual([item('韓文', { updatedAt: NOW_ISO })])
  })

  it('trims the name with the shared language rule', async () => {
    await putEntryAddingLanguage(db, entry(), '  韓文 \n', { now: NOW })
    expect((await getSettings(db)).customLanguages).toEqual([item('韓文', { updatedAt: NOW_ISO })])
  })

  it('does not write when the padded name is already active', async () => {
    await saveSettings(db, { customLanguages: [item('韓文')] })
    const keys = spyOnSettingsPuts()
    await putEntryAddingLanguage(db, entry(), ' 韓文 ', { now: NOW })
    expect(keys).toEqual([])
  })

  it('reads the current list inside the transaction and keeps other items', async () => {
    await saveSettings(db, { customLanguages: [item('法文')] })
    await putEntryAddingLanguage(db, entry(), '韓文', { now: NOW })
    expect((await getSettings(db)).customLanguages).toEqual([
      item('法文'),
      item('韓文', { updatedAt: NOW_ISO }),
    ])
  })

  it('revives a deleted language in place', async () => {
    const tombstone = item('韓文', { deleted: true, deletedAt: '2026-10-02T00:00:00.000Z' })
    await saveSettings(db, { customLanguages: [tombstone] })
    await putEntryAddingLanguage(db, entry(), '韓文', { now: NOW })
    expect((await getSettings(db)).customLanguages).toEqual([item('韓文', { updatedAt: NOW_ISO })])
  })

  it('does not write settings for an already active language', async () => {
    await saveSettings(db, { customLanguages: [item('韓文')] })
    const keys = spyOnSettingsPuts()
    await putEntryAddingLanguage(db, entry({ content: 'v2' }), '韓文', { now: NOW })
    expect(keys).toEqual([])
    expect((await getSettings(db)).customLanguages).toEqual([item('韓文')])
    expect((await getAllEntries(db))[0].content).toBe('v2')
  })

  it('does not write settings for built-in, auto or missing languages', async () => {
    const keys = spyOnSettingsPuts()
    for (const language of ['日文', '英文', 'auto', '自動判斷', '', undefined, null]) {
      await putEntryAddingLanguage(db, entry(), language, { now: NOW })
    }
    expect(keys).toEqual([])
    expect((await getSettings(db)).customLanguages).toEqual([])
    expect(await getAllEntries(db)).toEqual([entry()])
  })

  it('saves nothing when the entry cannot be written', async () => {
    await saveSettings(db, { customLanguages: [item('法文')] })
    const bad = entry()
    delete bad.id
    await expect(putEntryAddingLanguage(db, bad, '韓文', { now: NOW })).rejects.toThrow()
    expect(await getAllEntries(db)).toEqual([])
    expect((await getSettings(db)).customLanguages).toEqual([item('法文')])
  })

  it('rolls back the entry when updating the list fails', async () => {
    await saveSettings(db, { customLanguages: [item('法文')] })
    // A clock that throws makes the in-transaction list update fail after
    // the entry was already put.
    const brokenNow = { toISOString: () => { throw new Error('clock') } }
    await expect(
      putEntryAddingLanguage(db, entry(), '韓文', { now: brokenNow }),
    ).rejects.toThrow()
    expect(await getAllEntries(db)).toEqual([])
    expect((await getSettings(db)).customLanguages).toEqual([item('法文')])
  })
})

describe('removeCustomLanguage', () => {
  const NOW = new Date('2026-10-18T00:00:00.000Z')
  const NOW_ISO = NOW.toISOString()
  const item = (name, overrides = {}) => ({
    name,
    updatedAt: '2026-10-01T00:00:00.000Z',
    deleted: false,
    deletedAt: null,
    ...overrides,
  })

  it('soft-deletes the language and resolves with the remaining active names', async () => {
    await saveSettings(db, { customLanguages: [item('韓文'), item('法文')] })
    await expect(removeCustomLanguage(db, '韓文', { now: NOW })).resolves.toEqual(['法文'])
    expect((await getSettings(db)).customLanguages).toEqual([
      item('韓文', { updatedAt: NOW_ISO, deleted: true, deletedAt: NOW_ISO }),
      item('法文'),
    ])
  })

  it('does not touch entries', async () => {
    await putEntry(db, entry({ language: '韓文' }))
    await saveSettings(db, { customLanguages: [item('韓文')] })
    await removeCustomLanguage(db, '韓文', { now: NOW })
    expect(await getAllEntries(db)).toEqual([entry({ language: '韓文' })])
  })

  it('writes nothing for a missing, deleted or blank name', async () => {
    const tombstone = item('法文', { deleted: true, deletedAt: '2026-10-02T00:00:00.000Z' })
    await saveSettings(db, { customLanguages: [item('韓文'), tombstone] })
    for (const name of ['德文', '法文', '', null]) {
      await expect(removeCustomLanguage(db, name, { now: NOW })).resolves.toEqual(['韓文'])
    }
    expect((await getSettings(db)).customLanguages).toEqual([item('韓文'), tombstone])
  })

  it('resolves with an empty list when nothing is stored', async () => {
    await expect(removeCustomLanguage(db, '韓文', { now: NOW })).resolves.toEqual([])
    expect((await getSettings(db)).customLanguages).toEqual([])
  })

  it('works on the stored list, not a stale copy', async () => {
    await saveSettings(db, { customLanguages: [item('韓文')] })
    // Another tab added 法文 after this page loaded its list.
    await putEntryAddingLanguage(db, entry(), '法文', { now: NOW })
    await expect(removeCustomLanguage(db, '韓文', { now: NOW })).resolves.toEqual(['法文'])
  })

  it('rejects and keeps the list when the update fails', async () => {
    await saveSettings(db, { customLanguages: [item('韓文')] })
    const brokenNow = { toISOString: () => { throw new Error('clock') } }
    await expect(removeCustomLanguage(db, '韓文', { now: brokenNow })).rejects.toThrow()
    expect((await getSettings(db)).customLanguages).toEqual([item('韓文')])
  })
})
