import { useEffect, useId, useRef, useState } from 'react'
import { loadSettings, updateSettings } from '../storage/connection.js'

const AI_STUDIO_URL = 'https://aistudio.google.com/apikey'

// Gemini API key section of the settings page (spec 3.6, 5.1).
// The key is only kept in IndexedDB; it never appears in messages and is
// never logged (spec 5.4), so every catch below stays silent.
// `onKeyChange(key)` is called with the stored key once it is loaded and
// after every successful save or delete ('' = no key), so the page can
// show or refresh the model section.
export default function ApiKeySettings({ onKeyChange }) {
  // status: 'loading' | 'ready' | 'error'
  const [status, setStatus] = useState('loading')
  // The key currently stored; '' means not set.
  const [savedKey, setSavedKey] = useState('')
  const [value, setValue] = useState('')
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  // Synchronous lock against double clicks before React re-renders.
  const busyRef = useRef(false)
  const inputId = useId()
  // Kept in a ref so the load effect does not re-run when the parent
  // passes a new callback on every render.
  const onKeyChangeRef = useRef(onKeyChange)
  useEffect(() => {
    onKeyChangeRef.current = onKeyChange
  })

  useEffect(() => {
    let active = true
    loadSettings()
      .then((settings) => {
        if (!active) return
        const key = settings.geminiApiKey ?? ''
        setSavedKey(key)
        setValue(key)
        setStatus('ready')
        onKeyChangeRef.current?.(key)
      })
      .catch(() => {
        if (active) setStatus('error')
      })
    return () => {
      active = false
    }
  }, [])

  function clearMessages() {
    setError('')
    setNotice('')
  }

  // Runs one save; returns true on success. Shared by 儲存 and 刪除.
  async function save(key) {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    clearMessages()
    try {
      await updateSettings({ geminiApiKey: key })
      setSavedKey(key)
      setValue(key)
      onKeyChangeRef.current?.(key)
      return true
    } catch {
      setError('無法儲存設定，請重新整理頁面後再試一次。')
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (busyRef.current) return
    // Pasted keys often carry stray spaces or newlines around them.
    const key = value.trim()
    if (!key) {
      setNotice('')
      setError('請輸入 API key')
      return
    }
    if (await save(key)) setNotice('已儲存')
  }

  async function handleDelete() {
    // No confirmation dialog (decisions.md, Phase 2 設定頁).
    if (await save('')) setNotice('已刪除')
  }

  if (status === 'loading') return <p className="muted">載入中…</p>

  return (
    <section className="settings-section" aria-labelledby="settings-api-key">
      <h3 id="settings-api-key">Gemini API key</h3>

      {status === 'error' ? (
        <p className="error" role="alert">
          無法讀取設定，請重新整理頁面。
        </p>
      ) : (
        <>
          <p className="muted">
            {savedKey ? '目前已設定 API key' : '尚未設定 API key'}
          </p>

          <form className="settings-form" onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor={inputId}>API key</label>
              <div className="input-row">
                <input
                  id={inputId}
                  type={visible ? 'text' : 'password'}
                  value={value}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => {
                    setValue(event.target.value)
                    clearMessages()
                  }}
                />
                <button
                  type="button"
                  className="button button-secondary"
                  aria-controls={inputId}
                  onClick={() => setVisible((shown) => !shown)}
                >
                  {visible ? '隱藏' : '顯示'}
                </button>
              </div>
            </div>

            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {/* Always rendered so screen readers announce changes. */}
            <p className="success" role="status">
              {notice}
            </p>

            <div className="actions">
              <button type="submit" className="button" disabled={busy}>
                儲存
              </button>
              {savedKey && (
                <button
                  type="button"
                  className="button button-danger"
                  onClick={handleDelete}
                  disabled={busy}
                >
                  刪除
                </button>
              )}
            </div>
          </form>
        </>
      )}

      <h4>如何取得 API key</h4>
      <ol className="settings-steps">
        <li>
          前往 Google AI Studio 的{' '}
          <a href={AI_STUDIO_URL} target="_blank" rel="noopener noreferrer">
            API key 頁面
          </a>
          。
        </li>
        <li>用 Google 帳號登入，建立一個新的 API key。</li>
        <li>複製產生的 key，貼到上方欄位後按「儲存」。</li>
      </ol>
      <p className="muted">
        API key 只會存在這個瀏覽器，只用來呼叫 Gemini，不會傳送到其他地方。
      </p>
    </section>
  )
}
