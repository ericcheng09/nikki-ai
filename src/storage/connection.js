// App-wide access to the IndexedDB database.
// The database is opened once per page load and the same Promise is reused
// by every caller, so React re-renders and StrictMode's double-invoked
// effects never open extra connections.
import {
  openDatabase,
  getAllEntries,
  putEntry,
  putEntryAddingLanguage,
  putEntryAnalysis,
  putEntryEdit,
  removeCustomLanguage,
  addCustomLanguage,
  getSettings,
  saveSettings,
  readSyncSnapshot as readSnapshotFromDb,
  LEGACY_SETTING_UPDATED_AT,
  applySyncResult as applySyncResultToDb,
} from './db.js'
import { softDeleteEntry } from '../lib/diary.js'
import { activeLanguageNames } from '../lib/languages.js'

// Add/remove resolve with the active names after the call; comparing the
// count with the one before tells whether the list was actually written.
function activeCount(list) {
  return activeLanguageNames(list).length
}

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

// --- Change notifications (decisions.md Phase 4) -----------------------------
// Two separate signals so sync never triggers itself:
// - syncedDataChange: the user changed synced data on this device (entry
//   save/edit/delete, analysis, language add/remove, API key or model).
//   The sync scheduler listens to this one.
// - syncReplacedData: a sync wrote data from another device. Pages listen
//   to this one to reload; it never schedules another sync.
// Both fire only after the write has been committed.

// A small listener set; one failing listener must not break the write that
// triggered it or the other listeners, so errors are swallowed on purpose
// (and never logged: listeners may receive nothing, but stay safe anyway).
function createSignal() {
  const listeners = new Set()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit() {
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch {
          // Ignored, see above.
        }
      }
    },
  }
}

const syncedDataChange = createSignal()
const syncReplacedData = createSignal()

// Subscribes to local changes of synced data; returns an unsubscribe.
export function onSyncedDataChange(listener) {
  return syncedDataChange.subscribe(listener)
}

// Subscribes to "a sync wrote new data locally"; returns an unsubscribe.
export function onSyncReplacedData(listener) {
  return syncReplacedData.subscribe(listener)
}

// Settings that are synced; welcomeSeen is local only (spec 4.3).
const SYNCED_SETTING_KEYS = ['geminiApiKey', 'geminiModel', 'customLanguages']

export function getDb() {
  return connection.getDb()
}

// Raw records including soft-delete tombstones; callers filter and sort.
export async function loadEntries() {
  return getAllEntries(await getDb())
}

export async function saveEntry(entry) {
  await putEntry(await getDb(), entry)
  syncedDataChange.emit()
}

// Saves an entry and adds `language` (typed via 「其他」) to the custom
// language list in the same transaction; see putEntryAddingLanguage.
export async function saveEntryAddingLanguage(entry, language) {
  await putEntryAddingLanguage(await getDb(), entry, language)
  syncedDataChange.emit()
}

// Saves an edit of an existing entry: date, content and language from
// `changes` are merged onto the currently stored record, so an analysis
// written meanwhile is kept. `languageToAdd` (typed via 「其他」) is added
// to the custom list in the same transaction. Resolves with the written
// record, or null when the entry is missing or deleted (nothing is
// written); see putEntryEdit.
export async function saveEntryEdit(base, changes, languageToAdd) {
  const written = await putEntryEdit(await getDb(), base, changes, { languageToAdd })
  // null means nothing was written (entry missing or deleted).
  if (written) syncedDataChange.emit()
  return written
}

// Stores an AI analysis on entry `id` without touching its other fields.
// Resolves with the written record, or null when the entry is missing or
// deleted (the result is discarded); see putEntryAnalysis.
export async function saveEntryAnalysis(id, analysis) {
  const written = await putEntryAnalysis(await getDb(), id, analysis)
  if (written) syncedDataChange.emit()
  return written
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

// Adds a custom language to the list right away (editor's 「加入」) and
// resolves with the active names; see addCustomLanguage in db.js.
// Notifies only when the name became active, i.e. something was written.
export async function saveCustomLanguage(name) {
  const db = await getDb()
  const before = (await getSettings(db)).customLanguages
  const names = await addCustomLanguage(db, name)
  if (names.length !== activeCount(before)) syncedDataChange.emit()
  return names
}

// Soft-deletes a custom language and resolves with the remaining active
// names; see removeCustomLanguage in db.js.
export async function deleteCustomLanguage(name) {
  const db = await getDb()
  const before = (await getSettings(db)).customLanguages
  const names = await removeCustomLanguage(db, name)
  if (names.length !== activeCount(before)) syncedDataChange.emit()
  return names
}

// All known settings with defaults filled in (spec 4.3).
export async function loadSettings() {
  return getSettings(await getDb())
}

// Saves the given settings; unknown keys are ignored by the db layer.
// Notifies sync when a synced setting was part of the write.
// `automatic: true` marks a value the app chose by itself (the automatic
// Flash model choice): it is stamped with the legacy epoch instead of now,
// so it never overrides a choice the user made on another device, while a
// device without any other value still syncs it (decisions.md Phase 4).
export async function updateSettings(partial, { automatic = false } = {}) {
  const options = automatic ? { now: new Date(LEGACY_SETTING_UPDATED_AT) } : {}
  await saveSettings(await getDb(), partial, options)
  if (SYNCED_SETTING_KEYS.some((key) => Object.hasOwn(partial, key))) {
    syncedDataChange.emit()
  }
}

// Everything that is synced, in the sync.js snapshot shape.
export async function readSyncSnapshot() {
  return readSnapshotFromDb(await getDb())
}

// Writes a merged sync result (see applySyncResult in db.js) and, when it
// changed anything, tells the pages to reload. It deliberately does not
// emit syncedDataChange, which would schedule another sync. Resolves with
// whether anything was written.
export async function applySyncResult(merged) {
  const changed = await applySyncResultToDb(await getDb(), merged)
  if (changed) syncReplacedData.emit()
  return changed
}

// Remembers, for this page load only, that the user pressed 開始使用.
// If saving welcomeSeen fails, the home screen would otherwise read false
// and send the user straight back to the welcome page. After a reload the
// stored value decides again (the page may then show once more).
let welcomeSeenThisSession = false

export function isWelcomeSeenThisSession() {
  return welcomeSeenThisSession
}

// Marks the welcome page as seen: first in memory (so it can never trap
// the user), then persisted. The returned Promise rejects if saving fails.
export async function markWelcomeSeen() {
  welcomeSeenThisSession = true
  await updateSettings({ welcomeSeen: true })
}
