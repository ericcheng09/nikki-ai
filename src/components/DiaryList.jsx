import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { filterActiveEntries, sortEntries } from '../lib/diary.js'
import { loadEntries } from '../storage/connection.js'

const PREVIEW_LENGTH = 80

// Single-line preview; full text is shown on the entry page (T5).
function preview(content) {
  const oneLine = content.replace(/\s+/g, ' ').trim()
  return oneLine.length > PREVIEW_LENGTH
    ? `${oneLine.slice(0, PREVIEW_LENGTH)}…`
    : oneLine
}

export default function DiaryList() {
  // status: 'loading' | 'ready' | 'error'
  const [status, setStatus] = useState('loading')
  const [entries, setEntries] = useState([])

  useEffect(() => {
    // Ignore results that arrive after unmount (also covers StrictMode's
    // mount -> unmount -> mount cycle in development).
    let active = true
    loadEntries()
      .then((all) => {
        if (!active) return
        setEntries(sortEntries(filterActiveEntries(all)))
        setStatus('ready')
      })
      .catch(() => {
        // Deliberately not logging: the error could carry diary data.
        if (active) setStatus('error')
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <section className="diary-list">
      <div className="toolbar">
        <h2>我的日記</h2>
        <Link className="button" to="/entry/new">
          新增日記
        </Link>
      </div>

      {status === 'loading' && <p className="muted">載入中…</p>}
      {status === 'error' && (
        <p className="error" role="alert">
          無法存取本機資料，請重新整理頁面。
        </p>
      )}
      {status === 'ready' && entries.length === 0 && (
        <p className="muted">還沒有日記，按「新增日記」開始寫第一篇吧。</p>
      )}
      {status === 'ready' && entries.length > 0 && (
        <ul className="entries">
          {entries.map((entry) => (
            <li key={entry.id} className="entry-item">
              <time dateTime={entry.date}>{entry.date}</time>
              <p className="entry-preview">{preview(entry.content)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
