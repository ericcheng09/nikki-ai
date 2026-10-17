import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { deleteSampleEntry } from '../storage/connection.js'

// Read-only view of the sample entry: it cannot be edited, only deleted.
// The stored analysis is not shown until the Phase 2 result view exists.
export default function SampleEntryView({ entry }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Synchronous lock against double clicks before React re-renders.
  const busyRef = useRef(false)
  const navigate = useNavigate()

  async function handleDelete() {
    if (busyRef.current) return
    if (!window.confirm('確定要刪除這篇範例日記嗎？刪除後不會再出現。')) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      await deleteSampleEntry(entry)
      navigate('/')
    } catch {
      setError('無法刪除日記，請重新整理頁面後再試一次。')
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <section className="sample-view">
      <h2>
        範例日記 <span className="badge">範例</span>
      </h2>
      <p className="muted">這是一篇範例，只能閱讀或刪除，無法編輯。</p>
      <p>
        日期：<time dateTime={entry.date}>{entry.date}</time>
      </p>
      <p className="sample-content">{entry.content}</p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        <button
          type="button"
          className="button button-danger"
          onClick={handleDelete}
          disabled={busy}
        >
          刪除
        </button>
        <Link to="/">返回列表</Link>
      </div>
    </section>
  )
}
