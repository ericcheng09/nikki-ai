import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createEntry, getLocalDateString, isBlank } from '../lib/diary.js'
import { saveEntry } from '../storage/connection.js'

export default function DiaryEditor() {
  // Computed once on mount so the default is "today" in the user's timezone.
  const [date, setDate] = useState(() => getLocalDateString())
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(event) {
    event.preventDefault()
    if (saving) return
    // The native date input can be cleared, which yields ''.
    if (!date) {
      setError('請選擇日期')
      return
    }
    if (isBlank(content)) {
      setError('內容不能空白')
      return
    }
    setError('')
    setSaving(true)
    try {
      // Content is stored exactly as typed; language stays 'auto' until
      // language selection arrives in Phase 2.
      await saveEntry(createEntry({ date, content }))
      navigate('/')
    } catch {
      // Not logged on purpose: never write diary content to the console.
      setError('無法儲存日記，請重新整理頁面後再試一次。')
      setSaving(false)
    }
  }

  return (
    <form className="diary-editor" onSubmit={handleSubmit} noValidate>
      <h2>新增日記</h2>

      <label className="field">
        <span>日期</span>
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>

      <label className="field">
        <span>內容</span>
        <textarea
          rows={12}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="用你正在學的外語寫下今天的事…"
        />
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        <button type="submit" className="button" disabled={saving}>
          {saving ? '儲存中…' : '儲存'}
        </button>
        <Link to="/">取消</Link>
      </div>
    </form>
  )
}
