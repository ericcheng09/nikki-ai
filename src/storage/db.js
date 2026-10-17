// IndexedDB storage layer (spec 2.1, 4.1, 4.3).
// Plain IndexedDB with small Promise helpers; no wrapper library.
// Every function takes an open IDBDatabase so callers (and tests) control
// which database instance is used. Errors always surface as rejected
// Promises, and nothing here logs stored data.

export const DB_NAME = 'nikki-ai'
export const DB_VERSION = 1
export const ENTRIES_STORE = 'entries'
export const SETTINGS_STORE = 'settings'

// Known settings and their defaults (spec 4.3). Each setting is stored as
// its own record keyed by name, so later fields (e.g. geminiApiKey in
// Phase 2) are added here without a schema migration.
const DEFAULT_SETTINGS = {
  sampleDismissed: false,
}

export function openDatabase({ factory = globalThis.indexedDB, name = DB_NAME } = {}) {
  return new Promise((resolve, reject) => {
    if (!factory) {
      reject(new Error('IndexedDB is not available'))
      return
    }
    let request
    try {
      request = factory.open(name, DB_VERSION)
    } catch (error) {
      reject(error)
      return
    }

    request.onupgradeneeded = (event) => {
      const db = request.result
      // Migrations run step by step from the stored version; version 1
      // creates the initial stores. Add `if (oldVersion < 2)` etc. later.
      if (event.oldVersion < 1) {
        // Entries include soft-delete tombstones, keyed by their UUID.
        db.createObjectStore(ENTRIES_STORE, { keyPath: 'id' })
        // Out-of-line keys: key = setting name, value = setting value.
        db.createObjectStore(SETTINGS_STORE)
      }
    }

    request.onsuccess = () => {
      const db = request.result
      // Let a newer version in another tab upgrade instead of being blocked.
      db.onversionchange = () => db.close()
      resolve(db)
    }
    // Covers e.g. VersionError when the stored DB is newer than DB_VERSION.
    request.onerror = () => reject(request.error)
  })
}

// Runs `work(store)` in a transaction and resolves with the value of the
// request it returns once the transaction has completed (i.e. the write is
// committed), not merely when the request succeeds.
function runInStore(db, storeName, mode, work) {
  return new Promise((resolve, reject) => {
    let request
    let tx
    try {
      tx = db.transaction(storeName, mode)
      request = work(tx.objectStore(storeName))
    } catch (error) {
      // Synchronous failures, e.g. DataError for an entry without an id.
      tx?.abort()
      reject(error)
      return
    }
    tx.oncomplete = () => resolve(request?.result)
    // A failed request fires onerror and then onabort on the transaction;
    // the second reject() is a no-op, which is intended.
    tx.onerror = () => reject(tx.error ?? request?.error)
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
  })
}

// Returns every stored record as-is, including soft-delete tombstones.
// Filtering and sorting belong to src/lib/diary.js.
export function getAllEntries(db) {
  return runInStore(db, ENTRIES_STORE, 'readonly', (store) => store.getAll())
}

// Inserts or overwrites by id. Used for new entries, edits and soft-delete
// tombstones alike.
export async function putEntry(db, entry) {
  await runInStore(db, ENTRIES_STORE, 'readwrite', (store) => store.put(entry))
}

// Hard delete: removes the whole record without leaving a tombstone.
// ONLY for the sample entry (spec 3.5 / 4.1). Regular diary entries must be
// soft-deleted via softDeleteEntry() + putEntry() so deletions can sync.
export async function removeEntry(db, id) {
  await runInStore(db, ENTRIES_STORE, 'readwrite', (store) => store.delete(id))
}

// Returns all known settings, filling in defaults for unset ones.
export async function getSettings(db) {
  const settings = { ...DEFAULT_SETTINGS }
  await runInStore(db, SETTINGS_STORE, 'readonly', (store) => {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const request = store.get(key)
      request.onsuccess = () => {
        if (request.result !== undefined) settings[key] = request.result
      }
    }
  })
  return settings
}

// Saves the given settings in one transaction; unknown keys are ignored so
// typos cannot silently create new settings.
export async function saveSettings(db, partial) {
  await runInStore(db, SETTINGS_STORE, 'readwrite', (store) => {
    for (const [key, value] of Object.entries(partial)) {
      // Own-property check: `in` would also accept inherited names such as
      // toString or constructor from Object.prototype.
      if (Object.hasOwn(DEFAULT_SETTINGS, key)) store.put(value, key)
    }
  })
}
