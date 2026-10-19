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
  addCustomLanguage,
  putEntryAnalysis,
  putEntryEdit,
  readSyncSnapshot,
  applySyncResult,
  LEGACY_SETTING_UPDATED_AT,
  getGoogleAuth,
  saveGoogleAuth,
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

describe('addCustomLanguage', () => {
  const NOW = new Date('2026-10-18T00:00:00.000Z')
  const NOW_ISO = NOW.toISOString()
  const item = (name, overrides = {}) => ({
    name,
    updatedAt: '2026-10-01T00:00:00.000Z',
    deleted: false,
    deletedAt: null,
    ...overrides,
  })

  it('appends a new, trimmed language and resolves with the active names', async () => {
    await saveSettings(db, { customLanguages: [item('韓文')] })
    await expect(addCustomLanguage(db, ' 法文 ', { now: NOW })).resolves.toEqual(['韓文', '法文'])
    expect((await getSettings(db)).customLanguages).toEqual([
      item('韓文'),
      item('法文', { updatedAt: NOW_ISO }),
    ])
  })

  it('works when nothing is stored yet', async () => {
    await expect(addCustomLanguage(db, '韓文', { now: NOW })).resolves.toEqual(['韓文'])
    expect((await getSettings(db)).customLanguages).toEqual([item('韓文', { updatedAt: NOW_ISO })])
  })

  it('revives a soft-deleted language in place instead of adding a second record', async () => {
    const tombstone = item('韓文', { deleted: true, deletedAt: '2026-10-02T00:00:00.000Z' })
    await saveSettings(db, { customLanguages: [tombstone, item('法文')] })
    await expect(addCustomLanguage(db, '韓文', { now: NOW })).resolves.toEqual(['韓文', '法文'])
    expect((await getSettings(db)).customLanguages).toEqual([
      item('韓文', { updatedAt: NOW_ISO }),
      item('法文'),
    ])
  })

  it('writes nothing for an active, built-in, auto or blank name', async () => {
    // A malformed extra field would be tidied by any write, so an
    // unchanged record proves nothing was written.
    const stored = [{ ...item('韓文'), extra: 1 }]
    await saveSettings(db, { customLanguages: stored })
    for (const name of ['韓文', ' 韓文 ', '日文', '英文', 'auto', '自動判斷', '', '  ', null]) {
      await expect(addCustomLanguage(db, name, { now: NOW })).resolves.toEqual(['韓文'])
    }
    expect((await getSettings(db)).customLanguages).toEqual(stored)
  })

  it('works on the stored list, not a stale copy', async () => {
    await saveSettings(db, { customLanguages: [item('韓文')] })
    // Another tab added 法文 after this page loaded its list.
    await putEntryAddingLanguage(db, entry(), '法文', { now: NOW })
    await expect(addCustomLanguage(db, '德文', { now: NOW })).resolves.toEqual([
      '韓文',
      '法文',
      '德文',
    ])
  })

  it('rejects and keeps the list when the update fails', async () => {
    await saveSettings(db, { customLanguages: [item('韓文')] })
    const brokenNow = { toISOString: () => { throw new Error('clock') } }
    await expect(addCustomLanguage(db, '法文', { now: brokenNow })).rejects.toThrow()
    expect((await getSettings(db)).customLanguages).toEqual([item('韓文')])
  })
})

const sampleAnalysis = (overrides = {}) => ({
  detectedLanguage: '英文',
  grammarErrors: [],
  unclearSentences: [],
  naturalExpressions: [],
  correctedText: 'Hello.',
  translation: '你好。',
  analyzedAt: '2026-10-18T00:00:00.000Z',
  ...overrides,
})

describe('putEntryAnalysis', () => {
  const NOW = new Date('2026-10-18T05:00:00.000Z')

  it('sets only analysis and updatedAt and keeps every other stored field', async () => {
    const stored = entry({ content: 'Stored text', date: '2026-10-10', language: '日文' })
    await putEntry(db, stored)
    const written = await putEntryAnalysis(db, stored.id, sampleAnalysis(), { now: NOW })
    const expected = { ...stored, analysis: sampleAnalysis(), updatedAt: NOW.toISOString() }
    expect(await getAllEntries(db)).toEqual([expected])
    expect(written).toEqual(expected)
  })

  it('works on the stored record, not on a copy held by the caller', async () => {
    await putEntry(db, entry({ content: 'Newer text saved meanwhile' }))
    await putEntryAnalysis(db, 'id-1', sampleAnalysis(), { now: NOW })
    expect((await getAllEntries(db))[0].content).toBe('Newer text saved meanwhile')
  })

  it('replaces an older analysis', async () => {
    await putEntry(db, entry({ analysis: sampleAnalysis({ translation: '舊的' }) }))
    await putEntryAnalysis(db, 'id-1', sampleAnalysis({ translation: '新的' }), { now: NOW })
    expect((await getAllEntries(db))[0].analysis.translation).toBe('新的')
  })

  it('discards the result for a missing entry and resolves with null', async () => {
    await putEntry(db, entry({ id: 'other' }))
    await expect(putEntryAnalysis(db, 'missing', sampleAnalysis(), { now: NOW })).resolves.toBeNull()
    expect(await getAllEntries(db)).toEqual([entry({ id: 'other' })])
  })

  it('discards the result for a soft-deleted entry and keeps the tombstone', async () => {
    const tombstone = {
      id: 'id-1',
      updatedAt: '2026-10-17T02:00:00.000Z',
      deleted: true,
      deletedAt: '2026-10-17T02:00:00.000Z',
    }
    await putEntry(db, tombstone)
    await expect(putEntryAnalysis(db, 'id-1', sampleAnalysis(), { now: NOW })).resolves.toBeNull()
    expect(await getAllEntries(db)).toEqual([tombstone])
  })

  it('rejects and keeps the stored entry when the write fails', async () => {
    await putEntry(db, entry())
    const brokenNow = { toISOString: () => { throw new Error('clock') } }
    await expect(putEntryAnalysis(db, 'id-1', sampleAnalysis(), { now: brokenNow })).rejects.toThrow()
    expect(await getAllEntries(db)).toEqual([entry()])
  })
})

describe('putEntryEdit', () => {
  const NOW = new Date('2026-10-18T06:00:00.000Z')
  const changes = { date: '2026-10-16', content: 'Edited', language: '英文' }

  it('merges the editable fields onto the stored record and resolves with it', async () => {
    await putEntry(db, entry())
    const written = await putEntryEdit(db, entry(), changes, { now: NOW })
    const expected = { ...entry(), ...changes, updatedAt: NOW.toISOString() }
    expect(written).toEqual(expected)
    expect(await getAllEntries(db)).toEqual([expected])
  })

  it('keeps an analysis saved while the caller held an older copy', async () => {
    const stale = entry()
    await putEntry(db, stale)
    await putEntryAnalysis(db, stale.id, sampleAnalysis(), { now: new Date('2026-10-18T05:00:00.000Z') })
    const written = await putEntryEdit(db, stale, changes, { now: NOW })
    expect(written.analysis).toEqual(sampleAnalysis())
    expect((await getAllEntries(db))[0]).toMatchObject({ ...changes, analysis: sampleAnalysis() })
  })

  it('never writes fields other than date, content and language', async () => {
    await putEntry(db, entry())
    await putEntryEdit(
      db,
      entry(),
      { ...changes, analysis: 'x', createdAt: 'x', deleted: true },
      { now: NOW },
    )
    expect((await getAllEntries(db))[0]).toMatchObject({
      analysis: null,
      createdAt: entry().createdAt,
      deleted: false,
    })
  })

  it('writes nothing and resolves with null for a missing entry', async () => {
    await expect(putEntryEdit(db, entry(), changes, { now: NOW })).resolves.toBeNull()
    expect(await getAllEntries(db)).toEqual([])
  })

  it('does not resurrect a soft-deleted entry', async () => {
    const tombstone = {
      id: 'id-1',
      updatedAt: '2026-10-17T02:00:00.000Z',
      deleted: true,
      deletedAt: '2026-10-17T02:00:00.000Z',
    }
    await putEntry(db, tombstone)
    await expect(putEntryEdit(db, entry(), changes, { now: NOW })).resolves.toBeNull()
    expect(await getAllEntries(db)).toEqual([tombstone])
  })

  it.each([
    ['missing', null],
    ['deleted', { id: 'id-1', updatedAt: 'x', deleted: true, deletedAt: 'x' }],
  ])('leaves the language list untouched for a %s entry', async (_label, stored) => {
    if (stored) await putEntry(db, stored)
    await saveSettings(db, { customLanguages: [] })
    await expect(
      putEntryEdit(db, entry(), { language: '韓文' }, { now: NOW, languageToAdd: '韓文' }),
    ).resolves.toBeNull()
    expect((await getSettings(db)).customLanguages).toEqual([])
    expect(await getAllEntries(db)).toEqual(stored ? [stored] : [])
  })

  it('adds a custom language in the same transaction and keeps the analysis', async () => {
    await putEntry(db, entry({ analysis: sampleAnalysis() }))
    const written = await putEntryEdit(
      db,
      entry(),
      { ...changes, language: '韓文' },
      { now: NOW, languageToAdd: '韓文' },
    )
    expect(written).toMatchObject({ language: '韓文', analysis: sampleAnalysis() })
    expect((await getSettings(db)).customLanguages.map((item) => item.name)).toEqual(['韓文'])
  })

  it('rolls back the entry when updating the language list fails', async () => {
    await putEntry(db, entry())
    // Make the settings write throw inside the transaction, after the
    // entry was already put.
    const original = db.transaction.bind(db)
    vi.spyOn(db, 'transaction').mockImplementation((...args) => {
      const tx = original(...args)
      const originalStore = tx.objectStore.bind(tx)
      tx.objectStore = (name) => {
        const store = originalStore(name)
        if (name === SETTINGS_STORE) {
          store.put = () => {
            throw new Error('boom')
          }
        }
        return store
      }
      return tx
    })
    await expect(
      putEntryEdit(db, entry(), changes, { now: NOW, languageToAdd: '韓文' }),
    ).rejects.toThrow()
    vi.restoreAllMocks()
    expect(await getAllEntries(db)).toEqual([entry()])
    expect((await getSettings(db)).customLanguages).toEqual([])
  })

  it('rejects when the entry has no id', async () => {
    const bad = entry()
    delete bad.id
    await expect(putEntryEdit(db, bad, changes, { now: NOW })).rejects.toThrow()
  })
})

describe('sync storage', () => {
  const DAY = 24 * 60 * 60 * 1000
  const NOW = new Date('2026-10-19T00:00:00.000Z')
  const T1 = '2026-10-01T00:00:00.000Z'
  const T2 = '2026-10-02T00:00:00.000Z'
  const T3 = '2026-10-03T00:00:00.000Z'
  const lang = (name, updatedAt = T1) => ({ name, updatedAt, deleted: false, deletedAt: null })
  const tomb = (id, at) => ({ id, updatedAt: at, deleted: true, deletedAt: at })

  // Raw value of any key in the settings store, including sync metadata.
  function rawSetting(key) {
    return new Promise((resolve, reject) => {
      const request = db.transaction(SETTINGS_STORE, 'readonly').objectStore(SETTINGS_STORE).get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  function rawPut(key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite')
      tx.objectStore(SETTINGS_STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  const merged = ({ entries = [], customLanguages = [], settings = {} } = {}) => ({
    entries,
    customLanguages,
    settings,
  })

  describe('setting timestamps', () => {
    it('keeps the schema version (settings are key/value, no migration)', () => {
      expect(DB_VERSION).toBe(1)
    })

    it('stamps the API key on save and on delete', async () => {
      await saveSettings(db, { geminiApiKey: 'k' }, { now: new Date(T1) })
      expect(await rawSetting('geminiApiKeyUpdatedAt')).toBe(T1)
      await saveSettings(db, { geminiApiKey: '' }, { now: new Date(T2) })
      expect(await rawSetting('geminiApiKeyUpdatedAt')).toBe(T2)
      expect(await rawSetting('geminiModelUpdatedAt')).toBeUndefined()
    })

    it('stamps the model on every write (user change or auto-select)', async () => {
      await saveSettings(db, { geminiModel: 'models/a' }, { now: new Date(T1) })
      await saveSettings(db, { geminiModel: 'models/b' }, { now: new Date(T3) })
      expect(await rawSetting('geminiModelUpdatedAt')).toBe(T3)
    })

    it('does not stamp anything for other settings', async () => {
      await saveSettings(db, { welcomeSeen: true, customLanguages: [] })
      expect(await rawSetting('geminiApiKeyUpdatedAt')).toBeUndefined()
      expect(await rawSetting('geminiModelUpdatedAt')).toBeUndefined()
    })

    it('ignores timestamps passed in directly and keeps them out of getSettings', async () => {
      await saveSettings(db, { geminiApiKeyUpdatedAt: T3 })
      expect(await rawSetting('geminiApiKeyUpdatedAt')).toBeUndefined()
      await saveSettings(db, { geminiApiKey: 'k' })
      expect(Object.keys(await getSettings(db)).sort()).toEqual(
        ['customLanguages', 'geminiApiKey', 'geminiModel', 'welcomeSeen'],
      )
    })

    it('uses the current time by default', async () => {
      const before = Date.now()
      await saveSettings(db, { geminiApiKey: 'k' })
      expect(Date.parse(await rawSetting('geminiApiKeyUpdatedAt'))).toBeGreaterThanOrEqual(before)
    })
  })

  describe('readSyncSnapshot', () => {
    it('returns an empty snapshot and omits settings that were never set', async () => {
      await saveSettings(db, { welcomeSeen: true })
      expect(await readSyncSnapshot(db)).toEqual({ entries: [], customLanguages: [], settings: {} })
    })

    it('returns entries with tombstones, languages and timestamped settings', async () => {
      await putEntry(db, entry())
      await putEntry(db, tomb('id-2', T2))
      await saveSettings(db, { customLanguages: [lang('韓文')] })
      await saveSettings(db, { geminiApiKey: 'k' }, { now: new Date(T2) })
      await saveSettings(db, { geminiModel: '' }, { now: new Date(T3) })
      const snapshot = await readSyncSnapshot(db)
      expect(snapshot.entries).toHaveLength(2)
      expect(snapshot.entries).toContainEqual(tomb('id-2', T2))
      expect(snapshot.customLanguages).toEqual([lang('韓文')])
      expect(snapshot.settings).toEqual({
        geminiApiKey: { value: 'k', updatedAt: T2 },
        geminiModel: { value: '', updatedAt: T3 },
      })
      expect(snapshot.settings.welcomeSeen).toBeUndefined()
    })

    it('reports a legacy value without timestamp with the epoch', async () => {
      await rawPut('geminiApiKey', 'old-key')
      expect((await readSyncSnapshot(db)).settings).toEqual({
        geminiApiKey: { value: 'old-key', updatedAt: LEGACY_SETTING_UPDATED_AT },
      })
      expect(LEGACY_SETTING_UPDATED_AT).toBe('1970-01-01T00:00:00.000Z')
    })
  })

  describe('applySyncResult', () => {
    const apply = (data) => applySyncResult(db, data, { now: NOW })

    it('writes entries that are new or newer and reports a change', async () => {
      await putEntry(db, entry({ updatedAt: T1 }))
      const newer = entry({ updatedAt: T2, content: 'remote' })
      const added = entry({ id: 'id-2' })
      await expect(apply(merged({ entries: [newer, added] }))).resolves.toBe(true)
      const stored = await getAllEntries(db)
      expect(stored).toHaveLength(2)
      expect(stored).toContainEqual(newer)
      expect(stored).toContainEqual(added)
    })

    it('reports no change when everything is already stored', async () => {
      await putEntry(db, entry())
      await saveSettings(db, { customLanguages: [lang('韓文')] })
      await saveSettings(db, { geminiApiKey: 'k' }, { now: new Date(T1) })
      const snapshot = await readSyncSnapshot(db)
      await expect(apply(snapshot)).resolves.toBe(false)
      expect(await readSyncSnapshot(db)).toEqual(snapshot)
    })

    it('keeps a local edit made after the snapshot over older merged data', async () => {
      await putEntry(db, entry({ updatedAt: T1 }))
      const stale = await readSyncSnapshot(db)
      // The user edits while the sync request is in flight.
      const edited = entry({ updatedAt: T3, content: 'edited meanwhile' })
      await putEntry(db, edited)
      const remoteNewer = entry({ updatedAt: T2, content: 'remote' })
      await expect(apply(merged({ ...stale, entries: [remoteNewer] }))).resolves.toBe(false)
      expect(await getAllEntries(db)).toEqual([edited])
    })

    it('does not resurrect an entry deleted locally after the snapshot', async () => {
      await putEntry(db, entry({ updatedAt: T1 }))
      await putEntry(db, tomb('id-1', T3))
      await apply(merged({ entries: [entry({ updatedAt: T2 })] }))
      expect(await getAllEntries(db)).toEqual([tomb('id-1', T3)])
    })

    it('applies a remote deletion that is newer', async () => {
      await putEntry(db, entry({ updatedAt: T1 }))
      await apply(merged({ entries: [tomb('id-1', T2)] }))
      expect(await getAllEntries(db)).toEqual([tomb('id-1', T2)])
    })

    it('uses the sync tie-break on equal updatedAt (deletion wins)', async () => {
      await putEntry(db, entry({ updatedAt: T2 }))
      await apply(merged({ entries: [tomb('id-1', T2)] }))
      expect(await getAllEntries(db)).toEqual([tomb('id-1', T2)])
    })

    it('keeps the local record on a tie it wins', async () => {
      await putEntry(db, tomb('id-1', T2))
      await expect(apply(merged({ entries: [entry({ updatedAt: T2 })] }))).resolves.toBe(false)
      expect(await getAllEntries(db)).toEqual([tomb('id-1', T2)])
    })

    it('hard-deletes local tombstones the sync purged', async () => {
      const expired = new Date(NOW.getTime() - 91 * DAY).toISOString()
      await putEntry(db, tomb('id-old', expired))
      await putEntry(db, entry())
      await expect(apply(merged({ entries: [entry()] }))).resolves.toBe(true)
      expect(await getAllEntries(db)).toEqual([entry()])
    })

    it('keeps a tombstone that is not expired even if merged lacks it', async () => {
      // e.g. a deletion made locally after the snapshot was read.
      const recent = new Date(NOW.getTime() - DAY).toISOString()
      await putEntry(db, tomb('id-new', recent))
      await expect(apply(merged())).resolves.toBe(false)
      expect(await getAllEntries(db)).toEqual([tomb('id-new', recent)])
    })

    it('never deletes live records missing from merged', async () => {
      await putEntry(db, entry({ updatedAt: '2000-01-01T00:00:00.000Z' }))
      await expect(apply(merged())).resolves.toBe(false)
      expect(await getAllEntries(db)).toHaveLength(1)
    })

    it('leaves malformed local records untouched', async () => {
      const broken = { id: 'bad', updatedAt: 'garbage', deleted: true, deletedAt: 'x' }
      await putEntry(db, broken)
      await apply(merged())
      expect(await getAllEntries(db)).toEqual([broken])
    })

    it('merges languages per name against the current list', async () => {
      await saveSettings(db, { customLanguages: [lang('韓文', T3), lang('法文', T1)] })
      await expect(
        apply(merged({ customLanguages: [{ ...lang('韓文', T2), deleted: true, deletedAt: T2 }, lang('泰文')] })),
      ).resolves.toBe(true)
      expect((await getSettings(db)).customLanguages).toEqual([
        lang('韓文', T3),
        lang('法文', T1),
        lang('泰文'),
      ])
    })

    it('applies a newer language deletion and purges an expired one', async () => {
      const expired = new Date(NOW.getTime() - 91 * DAY).toISOString()
      await saveSettings(db, {
        customLanguages: [lang('韓文', T1), { ...lang('法文', expired), deleted: true, deletedAt: expired }],
      })
      await apply(merged({ customLanguages: [{ ...lang('韓文', T2), deleted: true, deletedAt: T2 }] }))
      expect((await getSettings(db)).customLanguages).toEqual([
        { ...lang('韓文', T2), deleted: true, deletedAt: T2 },
      ])
    })

    it('writes a setting value and its timestamp only when newer', async () => {
      await saveSettings(db, { geminiApiKey: 'local' }, { now: new Date(T2) })
      await saveSettings(db, { geminiModel: 'models/local' }, { now: new Date(T1) })
      await apply(merged({
        settings: {
          geminiApiKey: { value: 'older', updatedAt: T1 },
          geminiModel: { value: 'models/remote', updatedAt: T3 },
        },
      }))
      expect((await readSyncSnapshot(db)).settings).toEqual({
        geminiApiKey: { value: 'local', updatedAt: T2 },
        geminiModel: { value: 'models/remote', updatedAt: T3 },
      })
    })

    it('applies a newer key deletion', async () => {
      await saveSettings(db, { geminiApiKey: 'secret' }, { now: new Date(T1) })
      await apply(merged({ settings: { geminiApiKey: { value: '', updatedAt: T2 } } }))
      expect((await getSettings(db)).geminiApiKey).toBe('')
      expect(await rawSetting('geminiApiKeyUpdatedAt')).toBe(T2)
    })

    it('lets any real timestamp beat a legacy value', async () => {
      await rawPut('geminiApiKey', 'legacy')
      await apply(merged({ settings: { geminiApiKey: { value: 'synced', updatedAt: T1 } } }))
      expect((await getSettings(db)).geminiApiKey).toBe('synced')
    })

    it('does not write a legacy value back just to add a timestamp', async () => {
      await rawPut('geminiApiKey', 'legacy')
      const snapshot = await readSyncSnapshot(db)
      await expect(apply(snapshot)).resolves.toBe(false)
      expect(await rawSetting('geminiApiKeyUpdatedAt')).toBeUndefined()
    })

    it('keeps a language re-added after the snapshot even though sync purged it', async () => {
      const expired = new Date(NOW.getTime() - 91 * DAY).toISOString()
      await saveSettings(db, {
        customLanguages: [{ ...lang('法文', expired), deleted: true, deletedAt: expired }],
      })
      const stale = await readSyncSnapshot(db)
      // The user re-adds 法文 while the sync request is in flight.
      await addCustomLanguage(db, '法文', { now: NOW })
      const result = merged({ ...stale, customLanguages: [] }) // purged by sync
      await apply(result)
      expect((await getSettings(db)).customLanguages).toEqual([lang('法文', NOW.toISOString())])
    })

    it('keeps a key changed locally after the snapshot over an older merged key', async () => {
      await saveSettings(db, { geminiApiKey: 'old' }, { now: new Date(T1) })
      const stale = await readSyncSnapshot(db)
      await saveSettings(db, { geminiApiKey: 'new local' }, { now: new Date(T3) })
      await expect(
        apply(merged({ ...stale, settings: { geminiApiKey: { value: 'remote', updatedAt: T2 } } })),
      ).resolves.toBe(false)
      expect((await readSyncSnapshot(db)).settings.geminiApiKey).toEqual({
        value: 'new local',
        updatedAt: T3,
      })
    })

    it('lets a model chosen elsewhere beat a model auto-selected here', async () => {
      // Automatic choices are stored with the legacy epoch (connection.js).
      await saveSettings(db, { geminiModel: 'models/auto' }, { now: new Date(LEGACY_SETTING_UPDATED_AT) })
      await apply(merged({ settings: { geminiModel: { value: 'models/user', updatedAt: T1 } } }))
      expect((await getSettings(db)).geminiModel).toBe('models/user')
    })

    it('never writes welcomeSeen', async () => {
      await saveSettings(db, { welcomeSeen: false })
      await apply(merged({ settings: { welcomeSeen: { value: 'true', updatedAt: T3 } } }))
      expect((await getSettings(db)).welcomeSeen).toBe(false)
    })
  })
})

describe('google auth record (local only)', () => {
  const SIGNED_OUT = { enabled: false, accessToken: '', expiresAt: 0, needsLogin: false }
  const signedIn = { enabled: true, accessToken: 'ya29.secret', expiresAt: 1_800_000_000_000, needsLogin: false }

  it('defaults to signed out', async () => {
    expect(await getGoogleAuth(db)).toEqual(SIGNED_OUT)
  })

  it('saves and reads back the token and flag', async () => {
    await saveGoogleAuth(db, signedIn)
    expect(await getGoogleAuth(db)).toEqual(signedIn)
  })

  it('resets omitted fields and ignores wrong types', async () => {
    await saveGoogleAuth(db, signedIn)
    await saveGoogleAuth(db, { enabled: true, needsLogin: true })
    expect(await getGoogleAuth(db)).toEqual({ ...SIGNED_OUT, enabled: true, needsLogin: true })
    await saveGoogleAuth(db, { enabled: 'yes', accessToken: 5, expiresAt: 'soon', needsLogin: null })
    expect(await getGoogleAuth(db)).toEqual(SIGNED_OUT)
  })

  it('is never part of getSettings or the sync snapshot', async () => {
    await saveGoogleAuth(db, signedIn)
    await saveSettings(db, { geminiApiKey: 'k' })
    expect(Object.keys(await getSettings(db)).sort()).toEqual(
      ['customLanguages', 'geminiApiKey', 'geminiModel', 'welcomeSeen'],
    )
    const snapshot = await readSyncSnapshot(db)
    expect(JSON.stringify(snapshot)).not.toContain('ya29.secret')
    expect(Object.keys(snapshot.settings)).toEqual(['geminiApiKey'])
  })

  it('cannot be written through saveSettings', async () => {
    await saveSettings(db, { googleAuth: signedIn })
    expect(await getGoogleAuth(db)).toEqual(SIGNED_OUT)
  })

  it('is left alone by applySyncResult', async () => {
    await saveGoogleAuth(db, signedIn)
    await applySyncResult(db, { entries: [], customLanguages: [], settings: {}, googleAuth: SIGNED_OUT })
    expect(await getGoogleAuth(db)).toEqual(signedIn)
  })
})
