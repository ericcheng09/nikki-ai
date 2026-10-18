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
  getSettings,
  saveSettings,
} from './db.js'
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

// Saves an entry and adds `language` (typed via 「其他」) to the custom
// language list in the same transaction; see putEntryAddingLanguage.
export async function saveEntryAddingLanguage(entry, language) {
  await putEntryAddingLanguage(await getDb(), entry, language)
}

// Saves an edit of an existing entry: date, content and language from
// `changes` are merged onto the currently stored record, so an analysis
// written meanwhile is kept. `languageToAdd` (typed via 「其他」) is added
// to the custom list in the same transaction. Resolves with the written
// record, or null when the entry is missing or deleted (nothing is
// written); see putEntryEdit.
export async function saveEntryEdit(base, changes, languageToAdd) {
  return putEntryEdit(await getDb(), base, changes, { languageToAdd })
}

// Stores an AI analysis on entry `id` without touching its other fields.
// Resolves with the written record, or null when the entry is missing or
// deleted (the result is discarded); see putEntryAnalysis.
export async function saveEntryAnalysis(id, analysis) {
  return putEntryAnalysis(await getDb(), id, analysis)
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

// Soft-deletes a custom language and resolves with the remaining active
// names; see removeCustomLanguage in db.js.
export async function deleteCustomLanguage(name) {
  return removeCustomLanguage(await getDb(), name)
}

// All known settings with defaults filled in (spec 4.3).
export async function loadSettings() {
  return getSettings(await getDb())
}

// Saves the given settings; unknown keys are ignored by the db layer.
export async function updateSettings(partial) {
  await saveSettings(await getDb(), partial)
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
