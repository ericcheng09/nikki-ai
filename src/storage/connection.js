// App-wide access to the IndexedDB database.
// The database is opened once per page load and the same Promise is reused
// by every caller, so React re-renders and StrictMode's double-invoked
// effects never open extra connections.
import { openDatabase, getAllEntries, putEntry } from './db.js'
import { softDeleteEntry } from '../lib/diary.js'

export function createConnection(open = openDatabase) {
  let dbPromise = null
  return {
    getDb() {
      if (!dbPromise) {
        dbPromise = open().catch((error) => {
          // Forget the failed attempt so a later call can try again,
          // while the current callers still receive the rejection.
          dbPromise = null
          throw error
        })
      }
      return dbPromise
    },
  }
}

const connection = createConnection()

export function getDb() {
  return connection.getDb()
}

// Raw records including soft-delete tombstones; callers filter and sort.
export async function loadEntries() {
  return getAllEntries(await getDb())
}

export async function saveEntry(entry) {
  await putEntry(await getDb(), entry)
}

// Returns the stored record for `id` as-is (it may be a soft-delete
// tombstone), or undefined when no record exists. The diary is small, so
// reading all records keeps the storage layer minimal.
export async function loadEntry(id) {
  const all = await loadEntries()
  return all.find((entry) => entry.id === id)
}

// Entries are always soft-deleted (spec 3.1 / 4.1): the stored record is
// replaced by a tombstone, which drops content and analysis immediately.
export async function deleteEntry(entry) {
  await saveEntry(softDeleteEntry(entry))
}
