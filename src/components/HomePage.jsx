import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import Calendar from './Calendar.jsx'
import DiaryList from './DiaryList.jsx'
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
function HomeContent() {
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

  return (
    // Calendar first in the DOM (and reading/tab order); index.css puts it
    // above the list on narrow screens and to its left from 768px.
    <div className="home-layout">
      <Calendar entries={entries} />
      <DiaryList status={status} entries={entries} />
    </div>
  )
}
