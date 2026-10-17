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

// Runs `work(tx)` in a transaction over `storeNames` and resolves with the
// value returned by `getResult()` (if `work` returns one) once the
// transaction has completed, i.e. the writes are committed, not merely
// when a request succeeds. Any failure aborts the whole transaction, so
// multi-store writes are all-or-nothing.
function runTransaction(db, storeNames, mode, work) {
  return new Promise((resolve, reject) => {
    let tx
    let getResult
    try {
      tx = db.transaction(storeNames, mode)
      getResult = work(tx)
    } catch (error) {
      // Synchronous failures, e.g. DataError for an entry without an id.
      tx?.abort()
      reject(error)
      return
    }
    tx.oncomplete = () => resolve(getResult?.())
    // A failed request fires onerror and then onabort on the transaction;
    // the second reject() is a no-op, which is intended.
    // The error event bubbles from the failed request, which holds the cause
    // (tx.error is only set once the transaction aborts).
    tx.onerror = (event) => reject(event.target.error ?? tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
  })
}

// Single-store shortcut: resolves with the result of the request that
// `work(store)` returns.
function runInStore(db, storeName, mode, work) {
  return runTransaction(db, storeName, mode, (tx) => {
    const request = work(tx.objectStore(storeName))
    return () => request?.result
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
// ONLY for the sample entry (spec 3.5 / 4.1); the app uses
// dismissSampleEntry(), which also records sampleDismissed atomically.
// Regular diary entries must be soft-deleted via softDeleteEntry() +
// putEntry() so deletions can sync.
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

// Seeds the sample entry (spec 3.5) unless it was dismissed or already
// exists. Both checks and the write happen in ONE readwrite transaction
// over both stores; IndexedDB serialises overlapping readwrite
// transactions, so concurrent calls (StrictMode, two tabs) can neither add
// it twice nor overwrite an existing sample (e.g. its original date).
// Resolves with true when the sample was added.
export function seedSampleEntry(db, sample) {
  return runTransaction(db, [ENTRIES_STORE, SETTINGS_STORE], 'readwrite', (tx) => {
    let added = false
    const dismissed = tx.objectStore(SETTINGS_STORE).get('sampleDismissed')
    dismissed.onsuccess = () => {
      if (dismissed.result === true) return
      const entries = tx.objectStore(ENTRIES_STORE)
      const existing = entries.get(sample.id)
      existing.onsuccess = () => {
        if (existing.result !== undefined) return
        entries.put(sample)
        added = true
      }
    }
    return () => added
  })
}

// Deletes the sample for good (spec 3.5 / 4.1): removes the whole record,
// leaving no tombstone, and sets sampleDismissed in the same transaction so
// the two can never get out of step.
export async function dismissSampleEntry(db, id) {
  await runTransaction(db, [ENTRIES_STORE, SETTINGS_STORE], 'readwrite', (tx) => {
    tx.objectStore(ENTRIES_STORE).delete(id)
    tx.objectStore(SETTINGS_STORE).put(true, 'sampleDismissed')
  })
}
