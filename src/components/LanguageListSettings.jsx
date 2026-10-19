import { useEffect, useRef, useState } from 'react'
import { activeLanguageNames } from '../lib/languages.js'
import { deleteCustomLanguage, loadSettings } from '../storage/connection.js'
import useSyncReplacedData from '../lib/useSyncReplacedData.js'

// 語言清單 section of the settings page (spec 3.6). Lists the custom
// languages the user has typed in the editor and lets them be deleted.
// Deletion is soft (synced later) and never changes diary entries, which
// keep their language (decisions.md Phase 2 日記語言). New languages are
// only added from the diary editor.
export default function LanguageListSettings() {
  // status: 'loading' | 'ready' | 'error'
  const [status, setStatus] = useState('loading')
  const [names, setNames] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  // Synchronous lock against double clicks before React re-renders.
  const busyRef = useRef(false)

  useEffect(() => {
    let active = true
    loadSettings()
      .then((settings) => {
        if (!active) return
        setNames(activeLanguageNames(settings.customLanguages))
        setStatus('ready')
      })
      .catch(() => {
        // Not logged on purpose: never write settings to the console.
        if (active) setStatus('error')
      })
    return () => {
      active = false
    }
  }, [])

  // A sync changed the list on another device: show the new one.
  useSyncReplacedData(() => {
    loadSettings()
      .then((settings) => {
        setNames(activeLanguageNames(settings.customLanguages))
        setStatus('ready')
      })
      .catch(() => {})
  })

  async function handleDelete(name) {
    // No confirmation dialog (decisions.md Phase 2 設定頁).
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      // The storage layer works on the stored list and returns what is
      // active afterwards, which also picks up changes from other tabs.
      setNames(await deleteCustomLanguage(name))
      setNotice(`已刪除「${name}」`)
    } catch {
      setError('無法儲存設定，請重新整理頁面後再試一次。')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <section className="settings-section" aria-labelledby="settings-languages">
      <h3 id="settings-languages">語言清單</h3>

      {status === 'loading' && <p className="muted">載入中…</p>}

      {status === 'error' && (
        <p className="error" role="alert">
          無法讀取設定，請重新整理頁面。
        </p>
      )}

      {status === 'ready' && (
        <>
          {names.length === 0 ? (
            <p className="muted">
              尚未加入任何語言。在日記的語言選單選「其他」並輸入語言名稱，就會加入這裡。
            </p>
          ) : (
            <ul className="language-list">
              {names.map((name) => (
                <li key={name}>
                  <span className="language-name">{name}</span>
                  <button
                    type="button"
                    className="button button-secondary"
                    aria-label={`刪除 ${name}`}
                    onClick={() => handleDelete(name)}
                    disabled={busy}
                  >
                    刪除
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {/* Always rendered so screen readers announce changes. */}
          <p className="success" role="status">
            {notice}
          </p>
        </>
      )}
    </section>
  )
}
