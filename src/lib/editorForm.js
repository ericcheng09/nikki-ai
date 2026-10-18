// Pure helpers for the diary editor form state (no React, no storage).
import { AUTO_LANGUAGE, OTHER_OPTION_VALUE, resolveLanguageInput } from './languages.js'

// Stored language of an entry; missing or invalid values count as auto.
export function entryLanguage(entry) {
  return resolveLanguageInput(entry?.language)?.language ?? AUTO_LANGUAGE
}

// The language the form would save: the select value, or for 「其他」 the
// typed name resolved with the shared rule (so typing 日文 means 日文).
// null for a blank 「其他」.
export function formLanguage(language, otherLanguage) {
  if (language !== OTHER_OPTION_VALUE) return language
  return resolveLanguageInput(otherLanguage)?.language ?? null
}

// True when the form differs from the last saved version in any editable
// field (date, content, language). AI review only sends the saved
// version, so this blocks it (decisions.md Phase 2 AI 批改). A new entry
// (no saved version) has no "unsaved changes" in this sense.
export function hasUnsavedChanges(saved, { date, content, language, otherLanguage }) {
  if (!saved) return false
  return (
    date !== saved.date ||
    content !== saved.content ||
    formLanguage(language, otherLanguage) !== entryLanguage(saved)
  )
}
