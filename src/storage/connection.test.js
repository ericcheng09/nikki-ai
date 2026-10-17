import 'fake-indexeddb/auto'
import { createConnection, getDb, loadEntries, saveEntry } from './connection.js'

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
