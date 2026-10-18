import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { markWelcomeSeen } from '../storage/connection.js'

// 「開始使用」 on the welcome page (spec 3.5), shown in the top bar. Records
// welcomeSeen, then goes home. Only rendered on /welcome, so leaving that
// page unmounts it.
export default function WelcomeStartButton() {
  const [busy, setBusy] = useState(false)
  // Synchronous lock against double clicks before React re-renders.
  const busyRef = useRef(false)
  // Set on mount, cleared on unmount (StrictMode-safe), so a save that
  // finishes after the user left does not navigate again.
  const mountedRef = useRef(false)
  const navigate = useNavigate()

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function handleStart() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await markWelcomeSeen()
    } catch {
      // Never block the user: markWelcomeSeen() already remembered the
      // press for this page load, so home will not redirect back here.
      // Not logged on purpose.
    }
    if (mountedRef.current) navigate('/', { replace: true })
  }

  return (
    <button type="button" className="button" onClick={handleStart} disabled={busy}>
      開始使用
    </button>
  )
}
