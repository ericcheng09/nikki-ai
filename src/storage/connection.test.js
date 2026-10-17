import 'fake-indexeddb/auto'
import {
  createConnection,
  deleteEntry,
  getDb,
  loadEntries,
  loadEntry,
  saveEntry,
  loadSettings,
  updateSettings,
  isWelcomeSeenThisSession,
  markWelcomeSeen,
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
    expect(await loadSettings()).toEqual({ welcomeSeen: false, geminiApiKey: '', geminiModel: '' })
    await updateSettings({ welcomeSeen: true })
    expect(await loadSettings()).toEqual({ welcomeSeen: true, geminiApiKey: '', geminiModel: '' })
  })
})

describe('markWelcomeSeen', () => {
  it('remembers the press for this session and saves welcomeSeen', async () => {
    await updateSettings({ welcomeSeen: false })
    expect(isWelcomeSeenThisSession()).toBe(false)

    await markWelcomeSeen()

    expect(isWelcomeSeenThisSession()).toBe(true)
    expect(await loadSettings()).toEqual({ welcomeSeen: true, geminiApiKey: '', geminiModel: '' })
  })
})
