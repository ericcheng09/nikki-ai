import { useEffect, useRef, useState } from 'react'
import googleAuth from '../lib/googleAuth.js'
import syncEngine from '../lib/syncEngine.js'
import useSyncStatus from '../lib/useSyncStatus.js'
import {
  NEEDS_LOGIN_MESSAGE,
  formatSyncTime,
  syncErrorMessage,
  syncStateLabel,
} from '../lib/syncStatus.js'

const SIGN_IN_ERROR = '無法登入 Google，請再試一次。'
const LOAD_ERROR = '無法讀取設定，請重新整理頁面。'

// 「Google Drive 同步」 section of the settings page (spec 3.6, 6;
// decisions.md Phase 4): sign in and out, the sync status, the last sync
// time and 立即同步. The Google account is never shown (decisions.md), and
// nothing here logs.
export default function GoogleSyncSettings({ auth = googleAuth, engine = syncEngine }) {
  // 'loading' | 'error' | 'signedOut' | 'signedIn' | 'needsLogin'
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Synchronous lock against double clicks before React re-renders.
  const busyRef = useRef(false)
  // Which button gets focus after the buttons changed ('signIn' |
  // 'signOut'), so keyboard focus is not dropped to <body>.
  const [focusTarget, setFocusTarget] = useState(null)
  const signInRef = useRef(null)
  const signOutRef = useRef(null)
  // True once 需要重新登入 arrived while the page was open (a background
  // renewal failed): then the message is announced, not just shown.
  const [announceExpiry, setAnnounceExpiry] = useState(false)

  const sync = useSyncStatus(engine)
  // The status object at mount: an error that is already there is part of
  // the page; one that arrives later (a new status object) is announced.
  const mountSyncRef = useRef(sync)
  const syncErrorIsLive = sync.state === 'error' && sync !== mountSyncRef.current
  const [syncBusy, setSyncBusy] = useState(false)
  const syncBusyRef = useRef(false)

  useEffect(() => {
    // Load GIS now, so a later click can open its popup synchronously
    // within the user gesture (popup blockers, notably Safari). Only this
    // page does it: a signed-out user who never opens the settings makes
    // no request to Google.
    auth.preload?.()
  }, [auth])

  useEffect(() => {
    let active = true
    auth
      .getStatus()
      .then((current) => {
        if (active) setStatus(current)
      })
      .catch(() => {
        if (active) setStatus('error')
      })
    // E.g. a background token renewal that failed while the page is open.
    const unsubscribe = auth.onStatusChange((next) => {
      if (!active) return
      setAnnounceExpiry(next === 'needsLogin')
      setStatus(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [auth])

  useEffect(() => {
    if (!focusTarget) return
    const target = focusTarget === 'signIn' ? signInRef.current : signOutRef.current
    target?.focus()
    setFocusTarget(null)
  }, [focusTarget, status])

  async function run(action) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function handleSignIn() {
    // Called straight from the click, so the GIS popup is not blocked.
    return run(async () => {
      let result
      try {
        result = await auth.signIn()
      } catch {
        result = { ok: false }
      }
      if (result.ok) {
        setStatus('signedIn')
        setFocusTarget('signOut')
      } else {
        // Closed popup, blocked popup, denied scope...: same message, and
        // the state stays as it was.
        setError(SIGN_IN_ERROR)
      }
    })
  }

  async function handleSyncNow() {
    if (syncBusyRef.current) return
    syncBusyRef.current = true
    setSyncBusy(true)
    try {
      // A click, so an expired login may show Google's popup.
      await engine.syncNow({ interactive: true })
    } catch {
      // The status line shows the outcome.
    } finally {
      syncBusyRef.current = false
      setSyncBusy(false)
    }
    // 立即同步 is gone when the login expired; keep focus in the section.
    const now = engine.getStatus()
    if (now.state === 'error' && now.code === 'needsLogin') setFocusTarget('signIn')
  }

  function handleSignOut() {
    return run(async () => {
      try {
        await auth.signOut()
        setStatus('signedOut')
        setFocusTarget('signIn')
      } catch {
        setError('無法登出，請重新整理頁面後再試一次。')
      }
    })
  }

  // Drive rejected the token twice: the engine marked the login as
  // expired in storage without a googleAuth status event.
  const syncNeedsLogin = sync.state === 'error' && sync.code === 'needsLogin'
  const lastSynced = formatSyncTime(sync.lastSyncedAt)

  const signInButton = (label) => (
    // aria-disabled, not disabled, while busy: a disabled button can drop
    // keyboard focus to <body>. Clicks are ignored by the busyRef guard.
    <button
      type="button"
      className="button"
      ref={signInRef}
      aria-disabled={busy}
      onClick={handleSignIn}
    >
      {label}
    </button>
  )

  const signOutButton = (
    <button
      type="button"
      className="button button-secondary"
      ref={signOutRef}
      aria-disabled={busy}
      onClick={handleSignOut}
    >
      登出
    </button>
  )

  return (
    <section className="settings-section" aria-labelledby="settings-google-sync">
      <h3 id="settings-google-sync">Google Drive 同步</h3>

      {status === 'loading' && <p className="muted">載入中…</p>}

      {status === 'error' && (
        <p className="error" role="alert">
          {LOAD_ERROR}
        </p>
      )}

      {status === 'signedOut' && (
        <>
          <p className="muted">
            登入 Google 後，日記、語言清單、API key 與模型會同步到你 Google Drive 中只有這個 App 看得到的資料夾。
          </p>
          <div className="actions">{signInButton('登入 Google')}</div>
        </>
      )}

      {status === 'signedIn' && !syncNeedsLogin && (
        <>
          <p>已登入</p>
          {syncStateLabel(sync.state) && <p>{syncStateLabel(sync.state)}</p>}
          {lastSynced && <p className="muted">上次同步：{lastSynced}</p>}
          {sync.state === 'error' && (
            <p className="error" role={syncErrorIsLive ? 'alert' : undefined}>
              {syncErrorMessage(sync.code)}
            </p>
          )}
          <div className="actions">
            {/* aria-disabled, not disabled, while syncing so focus stays
                on it; clicks are ignored by the syncBusyRef guard. */}
            <button
              type="button"
              className="button"
              aria-disabled={syncBusy}
              onClick={handleSyncNow}
            >
              立即同步
            </button>
            {signOutButton}
          </div>
        </>
      )}

      {(status === 'needsLogin' || syncNeedsLogin) && (
        <>
          <p>{syncStateLabel('error')}</p>
          {lastSynced && <p className="muted">上次同步：{lastSynced}</p>}
          {/* role="alert" only when it appears while the page is open; on
              page load it is part of the content, like the other states. */}
          <p className="error" role={announceExpiry || syncErrorIsLive ? 'alert' : undefined}>
            {NEEDS_LOGIN_MESSAGE}
          </p>
          <div className="actions">
            {signInButton('重新登入')}
            {signOutButton}
          </div>
        </>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
