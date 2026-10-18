import { useId, useMemo, useState } from 'react'
import {
  WEEKDAY_LABELS,
  addMonths,
  currentMonth,
  entryDates,
  formatDayTitle,
  formatMonthTitle,
  monthGrid,
  parseMonthParam,
} from '../lib/calendar.js'
import { getLocalDateString } from '../lib/diary.js'

// Full weekday names for screen readers; the column headers show the short
// labels from WEEKDAY_LABELS.
const WEEKDAY_NAMES = WEEKDAY_LABELS.map((label) => `星期${label}`)

// Month calendar on the home page (spec 3.3, decisions.md Phase 3 日曆).
//
// `month` / `onMonthChange` make the shown month controllable (T3 keeps
// it in the URL); without `month` the component keeps its own state,
// starting at the current month. Days with a non-deleted entry are buttons
// that call `onSelectDate(date)`; other days are plain text.
export default function Calendar({ entries, month, onMonthChange, onSelectDate }) {
  const [ownMonth, setOwnMonth] = useState(() => currentMonth())
  // monthGrid throws on an invalid month, so a controlled value is always
  // validated here and falls back to the current month.
  const shown = month === undefined ? ownMonth : parseMonthParam(month) ?? currentMonth()
  const titleId = useId()
  // Evaluated on every render so a page left open past midnight moves the
  // today outline with the next re-render.
  const today = getLocalDateString()
  const marked = useMemo(() => entryDates(entries), [entries])
  // addMonths returns null past 9999-12 / before 0001-01; those buttons
  // are disabled instead of producing an invalid month.
  const previous = addMonths(shown, -1)
  const following = addMonths(shown, 1)

  function changeMonth(next) {
    if (!next || next === shown) return
    if (month === undefined) setOwnMonth(next)
    onMonthChange?.(next)
  }

  return (
    <section className="calendar" aria-labelledby={titleId}>
      <div className="calendar-header">
        <button
          type="button"
          className="icon-button"
          aria-label="上個月"
          disabled={!previous}
          onClick={() => changeMonth(previous)}
        >
          ‹
        </button>
        {/* Polite live region: the new month is announced after ‹ / ›. */}
        <h2 id={titleId} className="calendar-title" aria-live="polite">
          {formatMonthTitle(shown)}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="下個月"
          disabled={!following}
          onClick={() => changeMonth(following)}
        >
          ›
        </button>
        <button
          type="button"
          className="button button-secondary calendar-today"
          onClick={() => changeMonth(currentMonth())}
        >
          今天
        </button>
      </div>

      <table className="calendar-grid" aria-labelledby={titleId}>
        <thead>
          <tr>
            {WEEKDAY_LABELS.map((label, i) => (
              <th key={label} scope="col" abbr={WEEKDAY_NAMES[i]}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(shown).map((week) => (
            // The first non-blank day identifies the week uniquely.
            <tr key={week.find(Boolean)}>
              {week.map((date, i) => (
                <td key={date ?? `blank-${i}`}>
                  {date && (
                    <Day
                      date={date}
                      hasEntry={marked.has(date)}
                      isToday={date === today}
                      onSelect={onSelectDate}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Day({ date, hasEntry, isToday, onSelect }) {
  const dayNumber = Number(date.slice(8))
  const className = ['calendar-day', hasEntry && 'has-entry', isToday && 'is-today']
    .filter(Boolean)
    .join(' ')
  const current = isToday ? 'date' : undefined

  // Days without an entry are not interactive at all (decisions.md): no
  // button, no focus stop, no click handler.
  if (!hasEntry) {
    return (
      <span className={className} aria-current={current}>
        {dayNumber}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={className}
      aria-label={`${formatDayTitle(date)}，有日記`}
      aria-current={current}
      onClick={() => onSelect?.(date)}
    >
      {dayNumber}
    </button>
  )
}
