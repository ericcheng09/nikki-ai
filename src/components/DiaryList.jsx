import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDayTitle } from '../lib/calendar.js'
import { filterActiveEntries, getLocalDateString, sortEntries } from '../lib/diary.js'
import { groupEntries } from '../lib/listGroups.js'

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

// `labelledBy`: id of the group heading naming this list, if any.
function EntryItems({ entries, labelledBy }) {
  return (
    <ul className="entries" aria-labelledby={labelledBy}>
      {entries.map((entry) => (
        <li key={entry.id}>
          <Link className="entry-item" to={`/entry/${entry.id}`}>
            <time dateTime={entry.date}>{entry.date}</time>
            <p className="entry-preview">{preview(entry.content)}</p>
          </Link>
        </li>
      ))}
    </ul>
  )
}

// Presentational list; HomePage loads the entries once and shares them
// with the calendar. `status`: 'loading' | 'ready' | 'error'. `entries` is
// the raw stored list (tombstones included); only active ones are shown.
// With `selectedDate` only that day's entries are listed (same order),
// under 「M月D日 的日記」 with a 「顯示全部」 button calling `onShowAll`.
// Without it the list is split into 今天 / 昨天 / month groups.
export default function DiaryList({ status, entries, selectedDate = null, onShowAll }) {
  // Decided once when the home page opens (decisions.md: no update when
  // the page stays open past midnight). Local timezone, like the editor.
  const [today] = useState(() => getLocalDateString())
  const groupIdPrefix = useId()
  const shown = useMemo(() => {
    if (status !== 'ready') return []
    const active = sortEntries(filterActiveEntries(entries ?? []))
    return selectedDate ? active.filter((entry) => entry.date === selectedDate) : active
  }, [status, entries, selectedDate])
  // A selected day is shown as one plain list, exactly as before.
  const groups = useMemo(
    () => (selectedDate ? null : groupEntries(shown, today)),
    [shown, selectedDate, today],
  )
  const dayTitle = selectedDate ? formatDayTitle(selectedDate) : ''
  const headingRef = useRef(null)
  // Set by 顯示全部 until the parent has cleared the selection.
  const focusAfterClearRef = useRef(false)

  // 顯示全部 removes itself; focus moves to the list heading so keyboard and
  // screen reader users are not dropped to the page start. The parent clears
  // the selection through the URL, i.e. in a later render, so the focus is
  // moved only once selectedDate is null and the heading already reads
  // 我的日記 (focusing earlier would announce the old day title).
  useEffect(() => {
    if (!focusAfterClearRef.current) return
    // Any selection change ends the request; only a cleared one focuses.
    focusAfterClearRef.current = false
    if (!selectedDate) headingRef.current?.focus()
  }, [selectedDate])

  function showAll() {
    focusAfterClearRef.current = true
    onShowAll?.()
  }

  return (
    <section className="diary-list">
      <div className="toolbar">
        <div className="toolbar-title">
          {/* tabIndex -1: focusable from script only, not a tab stop. */}
          <h2 ref={headingRef} tabIndex={-1}>
            {dayTitle ? `${dayTitle} 的日記` : '我的日記'}
          </h2>
          {dayTitle && (
            <button type="button" className="button button-secondary" onClick={showAll}>
              顯示全部
            </button>
          )}
        </div>
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
      {status === 'ready' && shown.length > 0 && !groups && <EntryItems entries={shown} />}
      {status === 'ready' && shown.length > 0 && groups && (
        <div className="entry-groups">
          {groups.map((group, index) => {
            // Index-based ids: group keys can hold arbitrary text from a
            // malformed date, which would make an invalid id.
            const titleId = `${groupIdPrefix}-group-${index}`
            return (
              // The h3 names the group's list rather than a <section>
              // landmark: a month landmark would share its name with the
              // calendar region (「2026 年 10 月」). Headings still let
              // screen reader users jump between groups.
              <div key={group.key} className="entry-group">
                <h3 id={titleId} className="entry-group-title">
                  {group.title}
                </h3>
                <EntryItems entries={group.entries} labelledBy={titleId} />
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
