// IndexedDB storage layer (spec 2.1, 4.1, 4.3).
import {
  activeLanguageNames,
  addLanguage,
  removeLanguage,
  resolveLanguageInput,
} from '../lib/languages.js'
import { updateEntry } from '../lib/diary.js'

// Plain IndexedDB with small Promise helpers; no wrapper library.
// Every function takes an open IDBDatabase so callers (and tests) control
// which database instance is used. Errors always surface as rejected
// Promises, and nothing here logs stored data.

export const DB_NAME = 'nikki-ai'
export const DB_VERSION = 1
export const ENTRIES_STORE = 'entries'
export const SETTINGS_STORE = 'settings'

// Known settings and their defaults (spec 4.3). Each setting is stored as
// its own record keyed by name, so new fields are added here without a
// schema migration. Only keys listed here can be read or written.
// A function, not a shared object: customLanguages is an array, and every
// caller must get its own copy so nobody can mutate the defaults.
function createDefaultSettings() {
  return {
    // Set once the user presses 開始使用 on the welcome page (spec 3.5).
    // Local-only: never synced, so each device shows the page once.
    welcomeSeen: false,
    // The user's own Gemini API key (spec 4.3, 5.1); '' means not set.
    // Synced via Google Drive from Phase 4. Never logged (spec 5.4).
    geminiApiKey: '',
    // Full model resource name, e.g. "models/gemini-2.5-flash"; '' means
    // not chosen yet (spec 4.3). Synced via Google Drive from Phase 4.
    geminiModel: '',
    // Custom diary languages, see src/lib/languages.js for the item shape
    // (soft-deleted, never removed). Synced via Google Drive from Phase 4.
    customLanguages: [],
  }
}

const KNOWN_SETTING_KEYS = Object.freeze(Object.keys(createDefaultSettings()))

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
// tombstones alike. There is deliberately no hard delete: entries are
// always soft-deleted (spec 4.1) so deletions can sync later.
export async function putEntry(db, entry) {
  await runInStore(db, ENTRIES_STORE, 'readwrite', (store) => store.put(entry))
}

// Returns all known settings, filling in defaults for unset ones.
export async function getSettings(db) {
  const settings = createDefaultSettings()
  await runInStore(db, SETTINGS_STORE, 'readonly', (store) => {
    for (const key of KNOWN_SETTING_KEYS) {
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
      // An explicit list: `in` on an object would also accept inherited
      // names such as toString or constructor from Object.prototype.
      if (KNOWN_SETTING_KEYS.includes(key)) store.put(value, key)
    }
  })
}

// Saves an entry and, when `languageToAdd` is given, adds that custom
// language to customLanguages, all in ONE transaction over both stores
// (decisions.md Phase 2 日記語言). The current list is read inside the
// transaction and changed there, so a stale copy in the UI (or a failed
// earlier load) can never overwrite it, and the entry and the list are
// saved together or not at all. Built-in, auto and already-active names
// leave the settings record untouched.
export async function putEntryAddingLanguage(
  db,
  entry,
  languageToAdd,
  { now = new Date() } = {},
) {
  await runTransaction(db, [ENTRIES_STORE, SETTINGS_STORE], 'readwrite', (tx) => {
    tx.objectStore(ENTRIES_STORE).put(entry)
    addLanguageInTransaction(tx, languageToAdd, now)
  })
}

// Adds a custom language to customLanguages inside `tx` (which must cover
// SETTINGS_STORE). Same rule as the editor: only custom names (not auto,
// built-ins or blank) belong in the list, compared after trimming.
function addLanguageInTransaction(tx, languageToAdd, now) {
  const resolved = resolveLanguageInput(languageToAdd)
  if (!resolved?.isCustom) return
  const name = resolved.language
  const settings = tx.objectStore(SETTINGS_STORE)
  const request = settings.get('customLanguages')
  request.onsuccess = () => {
    try {
      const current = request.result ?? []
      // Already active: leave the record untouched (addLanguage would
      // also tidy malformed data, which is not worth a write).
      if (activeLanguageNames(current).includes(name)) return
      settings.put(addLanguage(current, name, { now }), 'customLanguages')
    } catch {
      // Abort explicitly (rolling back the entry too) instead of letting
      // the exception escape the event handler as an uncaught error.
      tx.abort()
    }
  }
}

// Saves an edit of an existing entry (editor, edit mode). Only the
// editable fields in `changes` (date, content, language; see updateEntry)
// are applied, on top of the record CURRENTLY stored under `base.id`, read
// inside the same readwrite transaction. Fields written meanwhile by
// someone else, notably an AI analysis that finished while the editor held
// an older copy, are therefore kept.
// A missing or soft-deleted entry is never written (deleted entries must
// not come back, spec 4.1): nothing changes, including the language list,
// and the Promise resolves with null. Otherwise, with `languageToAdd`, the
// custom language list is updated in the same transaction (see
// putEntryAddingLanguage), and it resolves with the written record.
export function putEntryEdit(db, base, changes, { now = new Date(), languageToAdd } = {}) {
  const storeNames = languageToAdd ? [ENTRIES_STORE, SETTINGS_STORE] : ENTRIES_STORE
  return runTransaction(db, storeNames, 'readwrite', (tx) => {
    const entries = tx.objectStore(ENTRIES_STORE)
    const request = entries.get(base.id)
    let written = null
    request.onsuccess = () => {
      try {
        const stored = request.result
        if (!stored || stored.deleted) return
        written = updateEntry(stored, changes, { now })
        entries.put(written)
        // Only once the entry is known to be live, so a refused edit
        // leaves the list untouched as well.
        if (languageToAdd) addLanguageInTransaction(tx, languageToAdd, now)
      } catch {
        // See addLanguageInTransaction: abort instead of an uncaught error.
        tx.abort()
      }
    }
    return () => written
  })
}

// Stores an AI analysis for the entry `id` (decisions.md Phase 2 AI 批改).
// The current record is read inside one readwrite transaction and only
// `analysis` and `updatedAt` change; content and every other field stay
// as stored, so edits saved while the request ran are kept and the diary
// text is never written. A missing or soft-deleted entry discards the
// result: nothing is written and the Promise resolves with null.
// Otherwise it resolves with the written record.
export function putEntryAnalysis(db, id, analysis, { now = new Date() } = {}) {
  return runTransaction(db, ENTRIES_STORE, 'readwrite', (tx) => {
    const entries = tx.objectStore(ENTRIES_STORE)
    const request = entries.get(id)
    let written = null
    request.onsuccess = () => {
      try {
        const stored = request.result
        if (!stored || stored.deleted) return
        written = { ...stored, analysis, updatedAt: now.toISOString() }
        entries.put(written)
      } catch {
        tx.abort()
      }
    }
    return () => written
  })
}

// Soft-deletes a custom language (settings page, spec 3.6). Like
// putEntryAddingLanguage, the list is read and written inside one
// transaction so a stale copy in the UI cannot overwrite it. Entries are
// not touched: they keep their language. Resolves with the active names
// after the change; a missing or already deleted name writes nothing.
export function removeCustomLanguage(db, name, { now = new Date() } = {}) {
  return runTransaction(db, SETTINGS_STORE, 'readwrite', (tx) => {
    const settings = tx.objectStore(SETTINGS_STORE)
    const request = settings.get('customLanguages')
    let activeNames = []
    request.onsuccess = () => {
      try {
        const current = request.result ?? []
        activeNames = activeLanguageNames(current)
        const target = resolveLanguageInput(name)?.language
        if (!activeNames.includes(target)) return
        const next = removeLanguage(current, target, { now })
        settings.put(next, 'customLanguages')
        activeNames = activeLanguageNames(next)
      } catch {
        // See putEntryAddingLanguage: abort instead of an uncaught error.
        tx.abort()
      }
    }
    return () => activeNames
  })
}
