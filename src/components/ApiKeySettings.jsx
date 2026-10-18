import { useEffect, useId, useRef, useState } from 'react'
import { loadSettings, updateSettings } from '../storage/connection.js'

const AI_STUDIO_URL = 'https://aistudio.google.com/apikey'

// Status line for a saved key, from the shared models.list request
// (decisions.md Phase 2 設定頁). `retry`: offer 重新確認, i.e. the key may
// be fine and only the check failed.
function keyCheckLine(keyCheck) {
  switch (keyCheck?.status) {
    case 'success':
      return { text: 'API key 可以使用', className: 'success', retry: false }
    case 'error':
      if (keyCheck.errorCode === 'invalidKey') {
        return { text: 'API key 無效，請確認後重新儲存。', className: 'error', retry: false }
      }
      if (keyCheck.errorCode === 'network') {
        return {
          text: '無法確認 API key，請檢查網路後再試一次。',
          className: 'error',
          retry: true,
        }
      }
      // Quota, server errors, malformed responses, ...
      return { text: '無法確認 API key，請稍後再試。', className: 'error', retry: true }
    default:
      // loading, or the request has not started yet
      return { text: '正在確認 API key…', className: 'muted', retry: false }
  }
}

// Gemini API key section of the settings page (spec 3.6, 5.1).
// The key is only kept in IndexedDB; it never appears in messages and is
// never logged (spec 5.4), so every catch below stays silent.
// `onKeyChange(key)` is called with the stored key once it is loaded and
// after every successful save or delete ('' = no key), so the page can
// (re)check it. `keyCheck` is that check's state (see useModelQuery) and
// `onRetry()` runs it again.
export default function ApiKeySettings({ onKeyChange, keyCheck, onRetry }) {
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
  // True from a 重新確認 click until that check ends. Meanwhile the button
  // stays rendered (but inert) so keyboard focus is not dropped to <body>.
  const [retrying, setRetrying] = useState(false)
  const checkLineRef = useRef(null)
  const inputId = useId()
  const inputRef = useRef(null)
  // Kept in a ref so the load effect does not re-run when the parent
  // passes a new callback on every render.
  const onKeyChangeRef = useRef(onKeyChange)
  useEffect(() => {
    onKeyChangeRef.current = onKeyChange
  })

  const checkStatus = keyCheck?.status
  const checkRetryable = keyCheckLine(keyCheck).retry
  // Set once the retried check is seen loading, so the old result still
  // on screen right after the click does not count as its outcome.
  const retryStartedRef = useRef(false)
  useEffect(() => {
    if (!retrying) return
    if (checkStatus === 'loading') {
      retryStartedRef.current = true
      return
    }
    if (!retryStartedRef.current) return
    retryStartedRef.current = false
    setRetrying(false)
    // Failed again with 重新確認 offered: the button stays, focus with it.
    // Otherwise the button goes away; hand focus to the result line.
    if (!checkRetryable) checkLineRef.current?.focus()
  }, [retrying, checkStatus, checkRetryable])

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
    // A save starts its own check; focus stays on the form, not the line.
    setRetrying(false)
    retryStartedRef.current = false
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
    if (await save('')) {
      setNotice('已刪除')
      // 刪除 disappears once no key is saved; keep focus in the section.
      inputRef.current?.focus()
    }
  }

  if (status === 'loading') return <p className="muted">載入中…</p>

  const checkLine = keyCheckLine(keyCheck)
  const retryPending = retrying
  const showRetry = checkLine.retry || retryPending

  function handleRetry() {
    if (retryPending) return
    setRetrying(true)
    onRetry?.()
  }

  return (
    <section className="settings-section" aria-labelledby="settings-api-key">
      <h3 id="settings-api-key">Gemini API key</h3>

      {status === 'error' ? (
        <p className="error" role="alert">
          無法讀取設定，請重新整理頁面。
        </p>
      ) : (
        <>
          {savedKey ? (
            <div className="key-check">
              {/* A live region so the result of the check is announced. */}
              {/* tabIndex -1: focus target once the 重新確認 button is gone. */}
              <p className={checkLine.className} role="status" tabIndex={-1} ref={checkLineRef}>
                {checkLine.text}
              </p>
              {showRetry && (
                // aria-disabled instead of disabled: a disabled button may
                // lose focus, which is what keeping it rendered avoids.
                <button
                  type="button"
                  className="button button-secondary"
                  aria-disabled={retryPending}
                  onClick={handleRetry}
                >
                  重新確認
                </button>
              )}
            </div>
          ) : (
            <p className="muted">尚未設定 API key</p>
          )}

          <form className="settings-form" onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor={inputId}>API key</label>
              <div className="input-row">
                <input
                  id={inputId}
                  ref={inputRef}
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
              {/* aria-disabled, not disabled, while saving: a disabled
                  button can drop keyboard focus to <body>. Clicks and
                  Enter are ignored meanwhile by the busyRef guard. */}
              <button type="submit" className="button" aria-disabled={busy}>
                儲存
              </button>
              {savedKey && (
                <button
                  type="button"
                  className="button button-danger"
                  onClick={handleDelete}
                  aria-disabled={busy}
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
