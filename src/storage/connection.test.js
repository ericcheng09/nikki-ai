import 'fake-indexeddb/auto'
import {
  createConnection,
  deleteEntry,
  deleteSampleEntry,
  getDb,
  loadEntries,
  loadEntry,
  saveEntry,
  seedSample,
} from './connection.js'
import { getSettings, saveSettings } from './db.js'
import { SAMPLE_ENTRY_ID } from '../lib/sample.js'

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
      isSample: false,
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

// These share the module-level database, so each test restores the sample
// state it relies on.
describe('sample entry', () => {
  beforeEach(async () => {
    await saveSettings(await getDb(), { sampleDismissed: false })
  })

  it('seedSample stores one sample, also when called repeatedly', async () => {
    await Promise.all([seedSample(), seedSample()])
    await seedSample()
    const samples = (await loadEntries()).filter((e) => e.id === SAMPLE_ENTRY_ID)
    expect(samples).toHaveLength(1)
    expect(samples[0].isSample).toBe(true)
  })

  it('deleteEntry rejects the sample and leaves it unchanged', async () => {
    await seedSample()
    const sample = await loadEntry(SAMPLE_ENTRY_ID)
    await expect(deleteEntry(sample)).rejects.toThrow()
    expect(await loadEntry(SAMPLE_ENTRY_ID)).toEqual(sample)
  })

  it('deleteSampleEntry removes the sample without a tombstone and dismisses it', async () => {
    await seedSample()
    const sample = await loadEntry(SAMPLE_ENTRY_ID)
    await deleteSampleEntry(sample)

    expect(await loadEntry(SAMPLE_ENTRY_ID)).toBeUndefined()
    expect(await getSettings(await getDb())).toEqual({ sampleDismissed: true })
    await seedSample()
    expect(await loadEntry(SAMPLE_ENTRY_ID)).toBeUndefined()
  })

  it('deleteSampleEntry rejects a regular entry', async () => {
    const entry = { id: 'regular-1', content: 'x', deleted: false, isSample: false }
    await saveEntry(entry)
    await expect(deleteSampleEntry(entry)).rejects.toThrow()
    expect(await loadEntry('regular-1')).toEqual(entry)
  })
})
