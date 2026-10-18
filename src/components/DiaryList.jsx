import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { filterActiveEntries, sortEntries } from '../lib/diary.js'

const PREVIEW_LENGTH = 80

// Single-line preview; full text is shown on the entry page.
// Array.from splits by code point, so a surrogate pair such as an emoji is
// never cut in half (String#slice counts UTF-16 code units).
function preview(content) {
  const chars = Array.from(content.replace(/\s+/g, ' ').trim())
  return chars.length > PREVIEW_LENGTH
    ? `${chars.slice(0, PREVIEW_LENGTH).join('')}…`
    : chars.join('')
}

// Presentational list; HomePage loads the entries once and shares them
// with the calendar. `status`: 'loading' | 'ready' | 'error'. `entries` is
// the raw stored list (tombstones included); only active ones are shown.
export default function DiaryList({ status, entries }) {
  const shown = useMemo(
    () => (status === 'ready' ? sortEntries(filterActiveEntries(entries ?? [])) : []),
    [status, entries],
  )

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
      {status === 'ready' && shown.length === 0 && (
        <p className="muted">還沒有日記，按「新增日記」開始寫第一篇吧。</p>
      )}
      {status === 'ready' && shown.length > 0 && (
        <ul className="entries">
          {shown.map((entry) => (
            <li key={entry.id}>
              <Link className="entry-item" to={`/entry/${entry.id}`}>
                <time dateTime={entry.date}>{entry.date}</time>
                <p className="entry-preview">{preview(entry.content)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
