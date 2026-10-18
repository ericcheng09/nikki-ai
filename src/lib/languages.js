// Pure functions for diary languages and the custom language list
// (spec 2.2, 4.3; decisions.md Phase 2 日記語言 / 設定頁). No UI or storage
// concerns; the clock is injectable like in diary.js, and inputs are never
// mutated.
//
// customLanguages items: { name, updatedAt, deleted, deletedAt }, with
// timestamps from Date.prototype.toISOString() and deletedAt null while
// active. Deletion is soft so it can sync later; the 90-day tombstone
// cleanup and the sync merge (spec 6) come in Phase 4.

export const AUTO_LANGUAGE = 'auto'
export const BUILT_IN_LANGUAGES = Object.freeze(['日文', '英文'])
// Select value of the 「其他」 option. Blank text is never a valid
// language, so this can never collide with a real language value.
export const OTHER_OPTION_VALUE = ''

const AUTO_LABEL = '自動判斷'
const OTHER_LABEL = '其他'

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : ''
}

// Resolves the text typed for 「其他」. Returns null for blank input (the
// caller shows 請輸入日記語言), otherwise { language, isCustom }:
// typing a built-in or the auto option selects it instead of creating a
// custom language. Matching is exact and case-sensitive after trimming.
export function resolveLanguageInput(text) {
  const name = trimmed(text)
  if (!name) return null
  if (name === AUTO_LANGUAGE || name === AUTO_LABEL) {
    return { language: AUTO_LANGUAGE, isCustom: false }
  }
  if (BUILT_IN_LANGUAGES.includes(name)) return { language: name, isCustom: false }
  return { language: name, isCustom: true }
}

// True for values that belong in the custom list (not auto, not built-in).
export function isCustomLanguage(value) {
  return resolveLanguageInput(value)?.isCustom === true
}

// Valid items only, with `name` trimmed; first record per name wins.
// Records named like a reserved option (auto, 自動判斷, 日文, 英文) are
// dropped since they could never be custom. Stored data could be malformed
// (manual edits, a future sync bug), so bad input never throws. Items are
// copied, never mutated.
function cleanList(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const result = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    if (!isCustomLanguage(item.name)) continue
    const name = item.name.trim()
    if (seen.has(name)) continue
    seen.add(name)
    result.push({ ...item, name })
  }
  return result
}

function isDeleted(item) {
  return item.deleted === true
}

// Adds a custom language after the user saved an entry with it.
// - auto / built-in / blank: list unchanged
// - already active: unchanged (updatedAt kept, so sync sees no change)
// - soft-deleted: revived in place, keeping one record per name
// - new: appended, so the list keeps first-added order
export function addLanguage(list, name, { now = new Date() } = {}) {
  const items = cleanList(list)
  if (!isCustomLanguage(name)) return items
  const target = trimmed(name)
  const timestamp = now.toISOString()
  const index = items.findIndex((item) => item.name === target)

  if (index === -1) {
    return [...items, { name: target, updatedAt: timestamp, deleted: false, deletedAt: null }]
  }
  if (!isDeleted(items[index])) return items
  const revived = { ...items[index], updatedAt: timestamp, deleted: false, deletedAt: null }
  return items.map((item, i) => (i === index ? revived : item))
}

// Soft-deletes a custom language. Missing or already deleted: unchanged.
export function removeLanguage(list, name, { now = new Date() } = {}) {
  const items = cleanList(list)
  const target = trimmed(name)
  const index = items.findIndex(
    (item) => item.name === target && !isDeleted(item),
  )
  if (!target || index === -1) return items
  const timestamp = now.toISOString()
  const removed = { ...items[index], updatedAt: timestamp, deleted: true, deletedAt: timestamp }
  return items.map((item, i) => (i === index ? removed : item))
}

// Names of the languages that are not deleted, in list order.
export function activeLanguageNames(list) {
  return cleanList(list)
    .filter((item) => !isDeleted(item))
    .map((item) => item.name)
}

// Options for the editor's language select, as { value, label, kind }:
// 自動判斷, 日文, 英文, active custom languages, then 其他. An entry whose
// custom language is not active in the list (deleted, or never listed)
// still shows it, after the active ones, so the select keeps its value;
// other entries do not see it (decisions.md Phase 2 設定頁).
export function languageOptions(list, currentLanguage) {
  const custom = activeLanguageNames(list)
  const current = trimmed(currentLanguage)
  if (isCustomLanguage(current) && !custom.includes(current)) custom.push(current)

  return [
    { value: AUTO_LANGUAGE, label: AUTO_LABEL, kind: 'auto' },
    ...BUILT_IN_LANGUAGES.map((name) => ({ value: name, label: name, kind: 'builtIn' })),
    ...custom.map((name) => ({ value: name, label: name, kind: 'custom' })),
    { value: OTHER_OPTION_VALUE, label: OTHER_LABEL, kind: 'other' },
  ]
}
