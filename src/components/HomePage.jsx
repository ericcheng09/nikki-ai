import { useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import Calendar from './Calendar.jsx'
import DiaryList from './DiaryList.jsx'
import { currentMonth, entryDates, monthOfDate } from '../lib/calendar.js'
import { homeSearchParams, resolveHomeQuery } from '../lib/homeQuery.js'
import useSyncReplacedData from '../lib/useSyncReplacedData.js'
import {
  isWelcomeSeenThisSession,
  loadEntries,
  loadSettings,
} from '../storage/connection.js'

// Home screen. On first use (welcomeSeen still false) it sends the user to
// the welcome page instead (spec 3.5). Only the home route does this, so
// opening /entry/... directly never redirects.
export default function HomePage() {
  // status: 'checking' | 'welcome' | 'home'
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    let active = true
    loadSettings()
      .then((settings) => {
        if (!active) return
        // Also honour a 開始使用 press from this page load whose save failed.
        const seen = settings.welcomeSeen || isWelcomeSeenThisSession()
        setStatus(seen ? 'home' : 'welcome')
      })
      .catch(() => {
        // If settings cannot be read, show the diary rather than trapping
        // the user on the welcome page. Not logged on purpose.
        if (active) setStatus('home')
      })
    return () => {
      active = false
    }
  }, [])

  if (status === 'checking') return <p className="muted">載入中…</p>
  // replace: Back from the welcome page should not bounce to "/" again.
  if (status === 'welcome') return <Navigate to="/welcome" replace />

  return <HomeContent />
}

// Loads the entries once (after the welcome check, so a redirect never
// reads the diary) and shares them between the calendar and the list.
// The shown month and the selected day live in the URL (decisions.md
// Phase 3 日曆), so they survive a reload and returning from an entry.
function HomeContent() {
  // status: 'loading' | 'ready' | 'error'
  const [status, setStatus] = useState('loading')
  const [entries, setEntries] = useState([])
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    // Ignore results that arrive after unmount (also covers StrictMode's
    // mount -> unmount -> mount cycle in development).
    let active = true
    loadEntries()
      .then((all) => {
        if (!active) return
        setEntries(all)
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

  // A sync brought data from another device: show it. A failed reload
  // keeps what is on screen (the next one may succeed).
  useSyncReplacedData(() => {
    loadEntries()
      .then((all) => {
        setEntries(all)
        setStatus('ready')
      })
      .catch(() => {})
  })

  // Only once the entries are loaded can a date be checked for entries;
  // after a load error it cannot be checked, so it is left alone.
  const marked = useMemo(
    () => (status === 'ready' ? entryDates(entries) : null),
    [status, entries],
  )
  const rawMonth = searchParams.get('month')
  const rawDate = searchParams.get('date')
  const { month, date } = resolveHomeQuery({ month: rawMonth, date: rawDate }, marked)

  // Make the URL match what is shown (drop invalid or entry-less values,
  // add the month of a selected date). Only once the entries are loaded:
  // before that an unverified date decides the month, and writing that
  // would lose the given month if the date is dropped later (e.g.
  // ?month=2026-09&date=2026-10-06 without entries must end on 2026-09).
  // After a load error nothing can be verified, so the URL is left alone.
  // replace: fixing the URL must not add a history entry.
  useEffect(() => {
    if (status !== 'ready') return
    if (month === rawMonth && date === rawDate) return
    setSearchParams((current) => homeSearchParams(current, { month, date }), { replace: true })
  }, [status, month, date, rawMonth, rawDate, setSearchParams])

  // Every selection change replaces the URL too: browsing months or days
  // should not fill the back history (Planner decision).
  function select(next) {
    setSearchParams((current) => homeSearchParams(current, next), { replace: true })
  }

  const shownMonth = month ?? currentMonth()

  return (
    // Calendar first in the DOM (and reading/tab order); index.css puts it
    // above the list on narrow screens and to its left from 768px.
    <div className="home-layout">
      <Calendar
        entries={entries}
        month={shownMonth}
        // Changing the month clears the selected day (Planner decision).
        onMonthChange={(next) => select({ month: next, date: null })}
        selectedDate={date}
        // Clicking the selected day again shows the full list.
        onSelectDate={(day) =>
          select(day === date ? { month: shownMonth, date: null } : { month: monthOfDate(day), date: day })
        }
      />
      <DiaryList
        status={status}
        entries={entries}
        selectedDate={date}
        onShowAll={() => select({ month: shownMonth, date: null })}
      />
    </div>
  )
}
