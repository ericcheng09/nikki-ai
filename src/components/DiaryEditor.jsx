import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  createEntry,
  getLocalDateString,
  isBlank,
  updateEntry,
} from '../lib/diary.js'
import { deleteEntry, saveEntry } from '../storage/connection.js'

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
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  // Synchronous lock: state updates are async, so two quick clicks could
  // both see busy === false. The ref blocks the second one immediately.
  const busyRef = useRef(false)
  const navigate = useNavigate()

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
    // Blank content is never saved; in edit mode the stored text stays.
    if (isBlank(content)) {
      setNotice('')
      setError('內容不能空白')
      return
    }
    if (!lock()) return
    clearMessages()
    try {
      if (isEdit) {
        const updated = updateEntry(saved, { date, content })
        await saveEntry(updated)
        setSaved(updated)
        setNotice('已儲存')
        unlock()
      } else {
        // Content is stored exactly as typed; language stays 'auto' until
        // language selection arrives in Phase 2.
        const created = createEntry({ date, content })
        await saveEntry(created)
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
    <form className="diary-editor" onSubmit={handleSubmit} noValidate>
      <h2>{isEdit ? '編輯日記' : '新增日記'}</h2>

      <label className="field">
        <span>日期</span>
        <input
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value)
            clearMessages()
          }}
        />
      </label>

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
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}

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
  )
}
