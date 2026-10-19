// Pure functions for Google Drive sync (spec 6; decisions.md Phase 4):
// the Drive file format, merging two snapshots and the 90-day tombstone
// purge. No storage, network or UI here; the clock is injectable, inputs
// are never mutated, and nothing is ever logged (the snapshot holds the
// user's Gemini API key).
//
// Snapshot (local data, and the parsed Drive file):
//   {
//     entries: [DiaryEntry],              // see diary.js, incl. tombstones
//     customLanguages: [{ name, ... }],   // see languages.js
//     settings: { geminiApiKey?: { value, updatedAt },
//                 geminiModel?:  { value, updatedAt } },
//   }
// Drive file: the snapshot plus { format: SYNC_FORMAT, version: SYNC_VERSION }.

import { isCustomLanguage } from './languages.js'

export const SYNC_FORMAT = 'nikki-ai-sync'
export const SYNC_VERSION = 1
export const PURGE_AFTER_MS = 90 * 24 * 60 * 60 * 1000

// Only these settings are synced; welcomeSeen stays local (spec 4.3).
const SYNCED_SETTINGS = Object.freeze(['geminiApiKey', 'geminiModel'])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Milliseconds since epoch, or NaN. Times are compared as instants rather
// than strings so a timestamp written with an offset still compares right.
function toTime(value) {
  return typeof value === 'string' ? Date.parse(value) : NaN
}

function hasValidTime(value) {
  return !Number.isNaN(toTime(value))
}

// JSON with object keys sorted recursively, so two records with the same
// data always produce the same string whatever their key order. Used for
// the tie-break and for change detection, both of which must give the
// same answer on every device.
export function canonicalJson(value) {
  return JSON.stringify(value, (_key, val) => {
    if (!isPlainObject(val)) return val
    const sorted = {}
    for (const key of Object.keys(val).sort()) sorted[key] = val[key]
    return sorted
  })
}

// Records are plain JSON data, so a JSON round trip is a full deep copy;
// results never share nested objects (e.g. analysis) with the inputs.
function deepCopy(value) {
  return JSON.parse(JSON.stringify(value))
}

// --- Record normalisation -------------------------------------------------
// Malformed records are skipped rather than failing the whole sync; valid
// records keep unknown extra fields so a newer app version's data survives.

function normalizeEntry(item) {
  if (!isPlainObject(item)) return null
  if (typeof item.id !== 'string' || item.id === '') return null
  if (!hasValidTime(item.updatedAt)) return null
  return deepCopy(item)
}

// Languages are keyed by trimmed name; reserved names (auto, 自動判斷,
// 日文, 英文) are never custom and therefore never synced.
function normalizeLanguage(item) {
  if (!isPlainObject(item)) return null
  if (!isCustomLanguage(item.name)) return null
  if (!hasValidTime(item.updatedAt)) return null
  return { ...deepCopy(item), name: item.name.trim() }
}

function normalizeSetting(field) {
  if (!isPlainObject(field)) return null
  if (typeof field.value !== 'string') return null
  if (!hasValidTime(field.updatedAt)) return null
  return deepCopy(field)
}

function isRecordDeleted(record) {
  return record.deleted === true
}

// An empty value means the user cleared the setting (e.g. deleted the API
// key); it plays the role of a tombstone in the tie-break.
function isSettingCleared(field) {
  return field.value === ''
}

// Last write wins (spec 6). On equal updatedAt the result must not depend
// on which side is local, or the two devices would disagree forever:
// the deleted/cleared one wins (a deletion is never undone by a tie), and
// otherwise the larger canonical JSON wins.
function pickWinner(a, b, isDeleted) {
  const ta = toTime(a.updatedAt)
  const tb = toTime(b.updatedAt)
  if (ta !== tb) return ta > tb ? a : b
  const da = isDeleted(a)
  const db = isDeleted(b)
  if (da !== db) return da ? a : b
  return canonicalJson(b) > canonicalJson(a) ? b : a
}

// Validated records keyed by `keyOf`, in first-seen order. Duplicate keys
// within one list are resolved with the same rule as across devices, so
// the outcome does not depend on list order.
function toRecordMap(list, normalize, keyOf, isDeleted) {
  const map = new Map()
  if (!Array.isArray(list)) return map
  for (const item of list) {
    const record = normalize(item)
    if (!record) continue
    const key = keyOf(record)
    const existing = map.get(key)
    map.set(key, existing ? pickWinner(existing, record, isDeleted) : record)
  }
  return map
}

const ENTRY_RULES = {
  normalize: normalizeEntry,
  keyOf: (record) => record.id,
  isDeleted: isRecordDeleted,
}

const LANGUAGE_RULES = {
  normalize: normalizeLanguage,
  keyOf: (record) => record.name,
  isDeleted: isRecordDeleted,
}

function normalizeRecords(list, rules) {
  return [...toRecordMap(list, rules.normalize, rules.keyOf, rules.isDeleted).values()]
}

function normalizeSettings(settings) {
  const result = {}
  if (!isPlainObject(settings)) return result
  for (const key of SYNCED_SETTINGS) {
    const field = normalizeSetting(settings[key])
    if (field) result[key] = field
  }
  return result
}

function normalizeSnapshot(snapshot) {
  const source = isPlainObject(snapshot) ? snapshot : {}
  return {
    entries: normalizeRecords(source.entries, ENTRY_RULES),
    customLanguages: normalizeRecords(source.customLanguages, LANGUAGE_RULES),
    settings: normalizeSettings(source.settings),
  }
}

// --- Drive file -----------------------------------------------------------

// Local snapshot -> object to upload as the Drive file (JSON.stringify it).
export function buildSyncFile(snapshot) {
  return { format: SYNC_FORMAT, version: SYNC_VERSION, ...normalizeSnapshot(snapshot) }
}

// Drive file contents (a JSON string, or an already parsed value) ->
//   { ok: true, data: snapshot }
//   { ok: false, error: 'format' }              not a readable sync file
//   { ok: false, error: 'unsupportedVersion' }  another app or file version
// On failure the caller must stop the sync without uploading, so a file
// written by a newer app version is never overwritten with older data.
export function parseSyncFile(input) {
  let file = input
  if (typeof input === 'string') {
    try {
      file = JSON.parse(input)
    } catch {
      return { ok: false, error: 'format' }
    }
  }
  if (!isPlainObject(file)) return { ok: false, error: 'format' }
  if (typeof file.format !== 'string' || typeof file.version !== 'number') {
    return { ok: false, error: 'format' }
  }
  if (file.format !== SYNC_FORMAT || file.version !== SYNC_VERSION) {
    return { ok: false, error: 'unsupportedVersion' }
  }
  if (
    !Array.isArray(file.entries) ||
    !Array.isArray(file.customLanguages) ||
    !isPlainObject(file.settings)
  ) {
    return { ok: false, error: 'format' }
  }
  return { ok: true, data: normalizeSnapshot(file) }
}

// --- Purge ----------------------------------------------------------------

// Removes tombstones deleted more than 90 days before `now` (spec 6).
// Exactly 90 days is kept. A tombstone whose deletedAt cannot be parsed is
// kept: dropping it could let an old copy on another device resurrect the
// record. Live records are never removed. An invalid `now` (e.g. an
// Invalid Date) purges nothing: comparing against NaN would otherwise treat
// every tombstone as expired.
export function purgeExpiredTombstones(records, now = new Date()) {
  const nowTime = now instanceof Date ? now.getTime() : NaN
  if (Number.isNaN(nowTime)) return [...records]
  const cutoff = nowTime - PURGE_AFTER_MS
  return records.filter((record) => {
    if (!isRecordDeleted(record)) return true
    const deletedAt = toTime(record.deletedAt)
    return Number.isNaN(deletedAt) || deletedAt >= cutoff
  })
}

// --- Merge ----------------------------------------------------------------

// Union by key, newer updatedAt wins. Output order: local records first
// (so the user's language list does not reorder), then remote-only ones.
function mergeRecords(localList, remoteList, rules) {
  const local = toRecordMap(localList, rules.normalize, rules.keyOf, rules.isDeleted)
  const remote = toRecordMap(remoteList, rules.normalize, rules.keyOf, rules.isDeleted)
  const merged = new Map(local)
  for (const [key, record] of remote) {
    const existing = merged.get(key)
    merged.set(key, existing ? pickWinner(existing, record, rules.isDeleted) : record)
  }
  return [...merged.values()]
}

// Per field, newer updatedAt wins; a missing (or invalid) field is older
// than any present one, and a field missing on both sides stays missing.
function mergeSettings(localSettings, remoteSettings) {
  const result = {}
  for (const key of SYNCED_SETTINGS) {
    const a = localSettings[key]
    const b = remoteSettings[key]
    if (a && b) result[key] = pickWinner(a, b, isSettingCleared)
    else if (a || b) result[key] = a ?? b
  }
  return result
}

// Order-insensitive fingerprint of a normalised snapshot: records sorted
// by key, objects by key name. Equal fingerprints mean nothing to write.
function fingerprint(data) {
  const byKey = (keyOf) => (a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0)
  return canonicalJson({
    entries: [...data.entries].sort(byKey(ENTRY_RULES.keyOf)),
    customLanguages: [...data.customLanguages].sort(byKey(LANGUAGE_RULES.keyOf)),
    settings: data.settings,
  })
}

// Merges the local snapshot with the parsed Drive snapshot (`remote` is
// null when Drive has no file yet) and purges expired tombstones.
// Returns:
//   merged         the snapshot both sides should hold afterwards
//   localChanged   merged differs from local -> write it locally
//   remoteChanged  merged differs from Drive (or no file) -> upload it
// Malformed records are left out of `merged` and of the comparison.
export function mergeSync(local, remote, { now = new Date() } = {}) {
  const localData = normalizeSnapshot(local)
  const remoteData = remote == null ? null : normalizeSnapshot(remote)
  const other = remoteData ?? normalizeSnapshot(undefined)

  const merged = {
    entries: purgeExpiredTombstones(
      mergeRecords(localData.entries, other.entries, ENTRY_RULES),
      now,
    ),
    customLanguages: purgeExpiredTombstones(
      mergeRecords(localData.customLanguages, other.customLanguages, LANGUAGE_RULES),
      now,
    ),
    settings: mergeSettings(localData.settings, other.settings),
  }

  const mergedPrint = fingerprint(merged)
  return {
    merged,
    localChanged: mergedPrint !== fingerprint(localData),
    remoteChanged: remoteData === null || mergedPrint !== fingerprint(remoteData),
  }
}
