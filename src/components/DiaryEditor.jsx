import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AiReviewPanel from './AiReviewPanel.jsx'
import LanguageField from './LanguageField.jsx'
import {
  createEntry,
  getLocalDateString,
  isAfterToday,
  isBlank,
} from '../lib/diary.js'
import { entryLanguage, hasUnsavedChanges } from '../lib/editorForm.js'
import {
  OTHER_OPTION_VALUE,
  addLanguage,
  languageOptions,
  resolveLanguageInput,
} from '../lib/languages.js'
import {
  deleteEntry,
  loadSettings,
  saveEntry,
  saveEntryAddingLanguage,
  saveEntryEdit,
} from '../storage/connection.js'

// One form for both modes:
// - no `entry` prop: create a new entry, then go to its page
// - `entry` prop: edit that entry in place, with a delete button
export default function DiaryEditor({ entry }) {
  const isEdit = Boolean(entry)
  // The last saved version; edits are applied on top of it.
  const [saved, setSaved] = useState(entry)
  // Default date for a new entry is "today" in the user's local timezone.
  const [date, setDate] = useState(() => entry?.date ?? getLocalDateString())
  const [content, setContent] = useState(entry?.content ?? '')
  // Select value: a language, or OTHER_OPTION_VALUE while 「其他」 is chosen.
  const [language, setLanguage] = useState(() => entryLanguage(entry))
  const [otherLanguage, setOtherLanguage] = useState('')
  // Custom language list from settings, only used to build the options.
  // If loading fails it stays empty: built-ins and 其他 still work, and the
  // list itself is updated inside the save transaction, never from here.
  const [customLanguages, setCustomLanguages] = useState([])
  // Languages this editor added through a save. A list load that finishes
  // after such a save may predate it, so these are re-applied on top of
  // the loaded list instead of being lost.
  const addedLanguagesRef = useRef([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  // Synchronous lock: state updates are async, so two quick clicks could
  // both see busy === false. The ref blocks the second one immediately.
  const busyRef = useRef(false)
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    loadSettings()
      .then((settings) => {
        if (!active) return
        const merged = addedLanguagesRef.current.reduce(
          (list, name) => addLanguage(list, name),
          settings.customLanguages ?? [],
        )
        setCustomLanguages(merged)
      })
      .catch(() => {
        // Not logged on purpose; the editor works without the list.
      })
    return () => {
      active = false
    }
  }, [])

  // The saved entry's own language is passed so an entry whose custom
  // language was deleted from the list still shows and keeps it.
  const options = languageOptions(customLanguages, entryLanguage(saved))

  // AI review only sends the saved version; see editorForm.js.
  const unsaved = isEdit && hasUnsavedChanges(saved, { date, content, language, otherLanguage })

  // A finished review only refreshes the stored analysis in memory; the
  // user's in-progress edits are separate state and stay untouched.
  function handleAnalyzed(record) {
    setSaved((current) => ({
      ...current,
      analysis: record.analysis,
      // Keep whichever is newer; timestamps are fixed-width ISO strings.
      updatedAt: record.updatedAt > current.updatedAt ? record.updatedAt : current.updatedAt,
    }))
  }

  function lock() {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    return true
  }

  function unlock() {
    busyRef.current = false
    setBusy(false)
  }

  function clearMessages() {
    setError('')
    setNotice('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (busyRef.current) return
    // The native date input can be cleared, which yields ''.
    if (!date) {
      setNotice('')
      setError('請選擇日期')
      return
    }
    // The max attribute only limits the picker UI (and may be stale after
    // midnight), so check again against today at the moment of saving.
    if (isAfterToday(date)) {
      setNotice('')
      setError('日期不能晚於今天')
      return
    }
    // Blank content is never saved; in edit mode the stored text stays.
    if (isBlank(content)) {
      setNotice('')
      setError('內容不能空白')
      return
    }
    // Only a language typed into 「其他」 is added to the list; keeping an
    // entry's (possibly deleted) language never re-adds it.
    let chosenLanguage = language
    let languageToAdd = null
    if (language === OTHER_OPTION_VALUE) {
      const resolved = resolveLanguageInput(otherLanguage)
      if (!resolved) {
        setNotice('')
        setError('請輸入日記語言')
        return
      }
      chosenLanguage = resolved.language
      if (resolved.isCustom) languageToAdd = resolved.language
    }
    if (!lock()) return
    clearMessages()
    try {
      if (isEdit) {
        // Merged onto the stored record inside the transaction, so an AI
        // analysis written while this form held an older copy is kept;
        // the written record (with that analysis) becomes the saved one.
        const written = await saveEntryEdit(
          saved,
          { date, content, language: chosenLanguage },
          languageToAdd,
        )
        // Deleted (e.g. in another tab) or gone: storage refused to bring
        // it back. Keep everything typed so the user can copy it.
        if (!written) {
          setError('這篇日記已被刪除，無法儲存。')
          unlock()
          return
        }
        setSaved(written)
        if (languageToAdd) {
          // Mirror the stored change locally so the new language shows as
          // a normal option and stays selected.
          addedLanguagesRef.current = [...addedLanguagesRef.current, languageToAdd]
          setCustomLanguages((list) => addLanguage(list, languageToAdd))
        }
        setLanguage(chosenLanguage)
        setOtherLanguage('')
        setNotice('已儲存')
        unlock()
      } else {
        // Content is stored exactly as typed.
        const created = createEntry({ date, content, language: chosenLanguage })
        // Built-in / auto / existing names need no list update.
        await (languageToAdd
          ? saveEntryAddingLanguage(created, languageToAdd)
          : saveEntry(created))
        // replace: the back button should not return to an empty new form.
        navigate(`/entry/${created.id}`, { replace: true })
      }
    } catch {
      // Not logged on purpose: never write diary content to the console.
      setError('無法儲存日記，請重新整理頁面後再試一次。')
      unlock()
    }
  }

  async function handleDelete() {
    if (busyRef.current) return
    if (!window.confirm('確定要刪除這篇日記嗎？刪除後無法復原。')) return
    if (!lock()) return
    clearMessages()
    try {
      await deleteEntry(saved)
      navigate('/')
    } catch {
      setError('無法刪除日記，請重新整理頁面後再試一次。')
      unlock()
    }
  }

  return (
    <>
      <form className="diary-editor" onSubmit={handleSubmit} noValidate>
        <h2>{isEdit ? '編輯日記' : '新增日記'}</h2>

        <label className="field">
          <span>日期</span>
          <input
            type="date"
            // Latest selectable date is today (local); recomputed on render.
            max={getLocalDateString()}
            value={date}
            onChange={(event) => {
              setDate(event.target.value)
              clearMessages()
            }}
          />
        </label>

        <LanguageField
          options={options}
          value={language}
          otherValue={otherLanguage}
          onChange={(value) => {
            setLanguage(value)
            clearMessages()
          }}
          onOtherChange={(value) => {
            setOtherLanguage(value)
            clearMessages()
          }}
        />

        <label className="field">
          <span>內容</span>
          <textarea
            rows={12}
            value={content}
            onChange={(event) => {
              setContent(event.target.value)
              clearMessages()
            }}
            placeholder="用你正在學的外語寫下今天的事…"
          />
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {/* Always rendered so screen readers announce text changes in this
            live region; only its content changes. */}
        <p className="success" role="status">
          {notice}
        </p>

        <div className="actions">
          <button type="submit" className="button" disabled={busy}>
            儲存
          </button>
          {isEdit && (
            <button
              type="button"
              className="button button-danger"
              onClick={handleDelete}
              disabled={busy}
            >
              刪除
            </button>
          )}
          <Link to="/">{isEdit ? '返回列表' : '取消'}</Link>
        </div>
      </form>
      {/* Only saved entries can be reviewed; /entry/new has no panel. */}
      {isEdit && (
        <AiReviewPanel
          entry={saved}
          hasUnsavedChanges={unsaved}
          onAnalyzed={handleAnalyzed}
        />
      )}
    </>
  )
}
