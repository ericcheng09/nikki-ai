// Home page selection kept in the URL (decisions.md Phase 3 日曆):
// `/?month=YYYY-MM&date=YYYY-MM-DD`. Pure helpers so the fixing rules are
// testable without a router.
import { monthOfDate, parseDateParam, parseMonthParam } from './calendar.js'

// The month/date the home page should show for the raw URL values.
//
// - An invalid `month` is dropped (the caller then shows the current month).
// - An invalid `date` is dropped. Once the entries are known (`markedDates`
//   is a Set), a valid date without any non-deleted entry is dropped too;
//   while they are still loading (`markedDates` null) it is kept for now.
// - A kept date decides the month, so the selected day is always visible.
//
// Returns { month, date }, each a valid string or null.
export function resolveHomeQuery({ month, date }, markedDates = null) {
  let selected = parseDateParam(date)
  if (selected && markedDates && !markedDates.has(selected)) selected = null
  return {
    month: selected ? monthOfDate(selected) : parseMonthParam(month),
    date: selected,
  }
}

// URLSearchParams for a resolved selection. Other parameters are kept as
// they are; month/date appear only when set.
export function homeSearchParams(current, { month, date }) {
  const next = new URLSearchParams(current)
  next.delete('month')
  next.delete('date')
  if (month) next.set('month', month)
  if (date) next.set('date', date)
  return next
}
