import 'fake-indexeddb/auto'
import {
  createConnection,
  deleteEntry,
  getDb,
  loadEntries,
  loadEntry,
  saveEntry,
  saveEntryAddingLanguage,
  saveEntryAnalysis,
  saveEntryEdit,
  deleteCustomLanguage,
  saveCustomLanguage,
  loadSettings,
  updateSettings,
  isWelcomeSeenThisSession,
  markWelcomeSeen,
  onSyncedDataChange,
  onSyncReplacedData,
  readSyncSnapshot,
  applySyncResult,
} from './connection.js'

describe('createConnection', () => {
  it('opens the database only once and reuses the same Promise', async () => {
    const db = { name: 'fake' }
    const open = vi.fn().mockResolvedValue(db)
    const connection = createConnection(open)

    const first = connection.getDb()
    const second = connection.getDb()
    expect(first).toBe(second)
    expect(await first).toBe(db)
    expect(await connection.getDb()).toBe(db)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('rejects when opening fails and retries on the next call', async () => {
    const db = { name: 'fake' }
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error('blocked'))
      .mockResolvedValueOnce(db)
    const connection = createConnection(open)

    await expect(connection.getDb()).rejects.toThrow('blocked')
    expect(await connection.getDb()).toBe(db)
    expect(open).toHaveBeenCalledTimes(2)
  })
})

describe('default connection', () => {
  it('returns the same database instance on every call', async () => {
    expect(await getDb()).toBe(await getDb())
  })

  it('saves an entry and loads it back', async () => {
    const entry = {
      id: 'conn-1',
      date: '2026-10-17',
      content: 'Hello',
      createdAt: '2026-10-17T01:00:00.000Z',
      updatedAt: '2026-10-17T01:00:00.000Z',
      deleted: false,
      deletedAt: null,
    }
    await saveEntry(entry)
    expect(await loadEntries()).toContainEqual(entry)
  })
})

describe('saveEntryAddingLanguage', () => {
  it('saves the entry and adds the language through the shared connection', async () => {
    const entry = {
      id: 'conn-lang-1',
      date: '2026-10-17',
      content: '안녕',
      language: '韓文',
      createdAt: '2026-10-17T01:00:00.000Z',
      updatedAt: '2026-10-17T01:00:00.000Z',
      deleted: false,
      deletedAt: null,
    }
    await saveEntryAddingLanguage(entry, '韓文')
    expect(await loadEntry('conn-lang-1')).toEqual(entry)
    const { customLanguages } = await loadSettings()
    expect(customLanguages.map((item) => item.name)).toContain('韓文')
    await updateSettings({ customLanguages: [] })
  })

  it('rejects and saves nothing for an entry without an id', async () => {
    await expect(saveEntryAddingLanguage({ content: 'x' }, '泰文')).rejects.toThrow()
    expect((await loadSettings()).customLanguages).toEqual([])
  })
})

describe('saveEntryEdit and saveEntryAnalysis', () => {
  const base = {
    id: 'conn-ai-1',
    date: '2026-10-17',
    content: 'Hello',
    language: 'auto',
    createdAt: '2026-10-17T01:00:00.000Z',
    updatedAt: '2026-10-17T01:00:00.000Z',
    deleted: false,
    deletedAt: null,
    analysis: null,
  }
  const analysis = { correctedText: 'Hello.' }

  it('keeps an analysis stored meanwhile when an older copy is edited', async () => {
    await saveEntry(base)
    const withAnalysis = await saveEntryAnalysis(base.id, analysis)
    expect(withAnalysis).toMatchObject({ content: 'Hello', analysis })
    const written = await saveEntryEdit(base, { content: 'Edited' })
    expect(written).toMatchObject({ content: 'Edited', analysis })
    expect(await loadEntry(base.id)).toEqual(written)
  })

  it('adds a custom language with the edit', async () => {
    await saveEntry(base)
    await saveEntryEdit(base, { language: '泰文' }, '泰文')
    expect((await loadSettings()).customLanguages.map((item) => item.name)).toContain('泰文')
    await updateSettings({ customLanguages: [] })
  })

  it('refuses to edit an unknown id', async () => {
    await expect(saveEntryEdit({ ...base, id: 'conn-ai-gone' }, { content: 'x' })).resolves.toBeNull()
    expect(await loadEntry('conn-ai-gone')).toBeUndefined()
  })

  it('discards an analysis for an unknown id', async () => {
    await expect(saveEntryAnalysis('conn-ai-missing', analysis)).resolves.toBeNull()
    expect(await loadEntry('conn-ai-missing')).toBeUndefined()
  })
})

describe('deleteCustomLanguage', () => {
  it('soft-deletes through the shared connection', async () => {
    await updateSettings({
      customLanguages: [
        { name: '韓文', updatedAt: '2026-10-01T00:00:00.000Z', deleted: false, deletedAt: null },
      ],
    })
    await expect(deleteCustomLanguage('韓文')).resolves.toEqual([])
    const [stored] = (await loadSettings()).customLanguages
    expect(stored).toMatchObject({ name: '韓文', deleted: true })
    await updateSettings({ customLanguages: [] })
  })

  it('resolves with the unchanged list for an unknown name', async () => {
    await expect(deleteCustomLanguage('不存在')).resolves.toEqual([])
  })
})

describe('saveCustomLanguage', () => {
  it('adds the language through the shared connection', async () => {
    await updateSettings({ customLanguages: [] })
    await expect(saveCustomLanguage('韓文')).resolves.toEqual(['韓文'])
    const [stored] = (await loadSettings()).customLanguages
    expect(stored).toMatchObject({ name: '韓文', deleted: false })
    await updateSettings({ customLanguages: [] })
  })

  it('leaves the list unchanged for a built-in name', async () => {
    await updateSettings({ customLanguages: [] })
    await expect(saveCustomLanguage('日文')).resolves.toEqual([])
    expect((await loadSettings()).customLanguages).toEqual([])
  })
})

describe('loadEntry', () => {
  it('returns the stored record for an id', async () => {
    const entry = { id: 'load-1', content: 'Hi', deleted: false }
    await saveEntry(entry)
    expect(await loadEntry('load-1')).toEqual(entry)
  })

  it('returns undefined for an unknown id', async () => {
    expect(await loadEntry('does-not-exist')).toBeUndefined()
  })
})

describe('deleteEntry', () => {
  it('replaces the entry with a tombstone that has no content or analysis', async () => {
    const entry = {
      id: 'del-1',
      date: '2026-10-17',
      content: 'secret',
      language: 'auto',
      createdAt: '2026-10-17T01:00:00.000Z',
      updatedAt: '2026-10-17T01:00:00.000Z',
      deleted: false,
      deletedAt: null,
      analysis: { correctedText: 'x' },
    }
    await saveEntry(entry)
    await deleteEntry(entry)

    const stored = await loadEntry('del-1')
    expect(Object.keys(stored).sort()).toEqual(
      ['deleted', 'deletedAt', 'id', 'updatedAt'],
    )
    expect(stored.deleted).toBe(true)
    expect(stored.deletedAt).toBe(stored.updatedAt)
  })
})

describe('settings', () => {
  it('reads defaults and saved values through the shared connection', async () => {
    expect(await loadSettings()).toEqual({ welcomeSeen: false, geminiApiKey: '', geminiModel: '', customLanguages: [] })
    await updateSettings({ welcomeSeen: true })
    expect(await loadSettings()).toEqual({ welcomeSeen: true, geminiApiKey: '', geminiModel: '', customLanguages: [] })
  })
})

describe('markWelcomeSeen', () => {
  it('remembers the press for this session and saves welcomeSeen', async () => {
    await updateSettings({ welcomeSeen: false })
    expect(isWelcomeSeenThisSession()).toBe(false)

    await markWelcomeSeen()

    expect(isWelcomeSeenThisSession()).toBe(true)
    expect(await loadSettings()).toEqual({ welcomeSeen: true, geminiApiKey: '', geminiModel: '', customLanguages: [] })
  })
})

describe('sync change notifications', () => {
  const T1 = '2026-10-01T00:00:00.000Z'
  const base = (id) => ({
    id,
    date: '2026-10-17',
    content: 'Hello',
    language: 'auto',
    createdAt: T1,
    updatedAt: T1,
    deleted: false,
    deletedAt: null,
    analysis: null,
  })

  let changed
  let replaced
  let unsubscribe
  beforeEach(async () => {
    await updateSettings({ customLanguages: [] })
    changed = vi.fn()
    replaced = vi.fn()
    const offChange = onSyncedDataChange(changed)
    const offReplace = onSyncReplacedData(replaced)
    unsubscribe = () => {
      offChange()
      offReplace()
    }
  })
  afterEach(() => unsubscribe())

  it('fires after saving, editing, analysing and deleting an entry', async () => {
    await saveEntry(base('n-1'))
    expect(changed).toHaveBeenCalledTimes(1)
    await saveEntryEdit(base('n-1'), { content: 'Edited' })
    expect(changed).toHaveBeenCalledTimes(2)
    await saveEntryAnalysis('n-1', { correctedText: 'x' })
    expect(changed).toHaveBeenCalledTimes(3)
    await deleteEntry(base('n-1'))
    expect(changed).toHaveBeenCalledTimes(4)
    await saveEntryAddingLanguage(base('n-2'), '韓文')
    expect(changed).toHaveBeenCalledTimes(5)
    expect(replaced).not.toHaveBeenCalled()
  })

  it('does not fire when an edit or analysis wrote nothing', async () => {
    await saveEntryEdit(base('n-missing'), { content: 'x' })
    await saveEntryAnalysis('n-missing', { correctedText: 'x' })
    expect(changed).not.toHaveBeenCalled()
  })

  it('fires once the write is committed, not before', async () => {
    let storedWhenNotified
    changed.mockImplementation(() => {
      storedWhenNotified = loadEntry('n-3')
    })
    await saveEntry(base('n-3'))
    expect(await storedWhenNotified).toEqual(base('n-3'))
  })

  it('fires for language add/remove only when the list changed', async () => {
    await saveCustomLanguage('泰文')
    expect(changed).toHaveBeenCalledTimes(1)
    await saveCustomLanguage('泰文')
    await saveCustomLanguage('日文')
    expect(changed).toHaveBeenCalledTimes(1)
    await deleteCustomLanguage('泰文')
    expect(changed).toHaveBeenCalledTimes(2)
    await deleteCustomLanguage('泰文')
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('fires for the API key and model but not for welcomeSeen', async () => {
    await updateSettings({ geminiApiKey: 'k' })
    await updateSettings({ geminiApiKey: '' })
    await updateSettings({ geminiModel: 'models/x' })
    expect(changed).toHaveBeenCalledTimes(3)
    await updateSettings({ welcomeSeen: true })
    await markWelcomeSeen()
    expect(changed).toHaveBeenCalledTimes(3)
  })

  it('fires for settings and languages only after the write is committed', async () => {
    const seen = []
    changed.mockImplementation(() => {
      seen.push(loadSettings())
    })
    await updateSettings({ geminiApiKey: 'committed-key' })
    await updateSettings({ geminiModel: 'models/committed' })
    await saveCustomLanguage('越南文')
    const [afterKey, afterModel, afterLanguage] = await Promise.all(seen)
    expect(afterKey.geminiApiKey).toBe('committed-key')
    expect(afterModel.geminiModel).toBe('models/committed')
    expect(afterLanguage.customLanguages.map((item) => item.name)).toContain('越南文')
    await updateSettings({ geminiApiKey: '', geminiModel: '' })
  })

  it('stamps an automatic model choice with the legacy epoch, a user choice with now', async () => {
    await updateSettings({ geminiModel: 'models/auto' }, { automatic: true })
    expect((await readSyncSnapshot()).settings.geminiModel).toEqual({
      value: 'models/auto',
      updatedAt: '1970-01-01T00:00:00.000Z',
    })
    // Still a synced change: a device without any model uploads it.
    expect(changed).toHaveBeenCalledTimes(1)
    const before = Date.now()
    await updateSettings({ geminiModel: 'models/user' })
    const { updatedAt } = (await readSyncSnapshot()).settings.geminiModel
    expect(Date.parse(updatedAt)).toBeGreaterThanOrEqual(before)
    await updateSettings({ geminiModel: '' })
  })

  it('keeps other listeners and the write working when a listener throws', async () => {
    const off = onSyncedDataChange(() => {
      throw new Error('boom')
    })
    await expect(saveEntry(base('n-4'))).resolves.toBeUndefined()
    expect(changed).toHaveBeenCalledTimes(1)
    off()
  })

  it('stops calling a listener after unsubscribe', async () => {
    unsubscribe()
    await saveEntry(base('n-5'))
    expect(changed).not.toHaveBeenCalled()
  })

  it('applySyncResult signals replaced data, never a synced change', async () => {
    const snapshot = await readSyncSnapshot()
    const incoming = { ...base('n-remote'), updatedAt: '2026-10-05T00:00:00.000Z' }
    await expect(
      applySyncResult({ ...snapshot, entries: [...snapshot.entries, incoming] }),
    ).resolves.toBe(true)
    expect(await loadEntry('n-remote')).toEqual(incoming)
    expect(replaced).toHaveBeenCalledTimes(1)
    expect(changed).not.toHaveBeenCalled()
  })

  it('does not signal when applySyncResult changed nothing', async () => {
    await expect(applySyncResult(await readSyncSnapshot())).resolves.toBe(false)
    expect(replaced).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
  })
})
