import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import DiaryList from './DiaryList.jsx'
import {
  isWelcomeSeenThisSession,
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

  return (
    <>
      <p className="home-links">
        <Link to="/welcome">使用說明</Link>
      </p>
      <DiaryList />
    </>
  )
}
