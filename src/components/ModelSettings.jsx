import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { listModels } from '../lib/gemini.js'
import { loadSettings, updateSettings } from '../storage/connection.js'

const QUERY_ERRORS = {
  invalidKey: 'API key 無效，請確認後重新儲存。',
  network: '無法連線到 Gemini，請檢查網路後再試一次。',
  other: '無法取得模型清單，請稍後再試。',
}
const SAVE_ERROR = '無法儲存設定，請重新整理頁面後再試一次。'

// First model whose name mentions "flash" (fast and cheap enough for
// diary feedback), or undefined when there is none (decisions.md).
function findFlashModel(models) {
  return models.find((model) => model.name.toLowerCase().includes('flash'))
}

// Gemini model section of the settings page (spec 3.6, decisions.md
// Phase 2 「Gemini 模型」). Rendered only while an API key is saved; the
// parent remounts it (via `key`) whenever the key is saved again, so every
// mount queries the model list once.
export default function ModelSettings({ apiKey }) {
  // status: 'loading' | 'ready' | 'queryError' | 'loadError'
  const [status, setStatus] = useState('loading')
  const [models, setModels] = useState([])
  const [errorCode, setErrorCode] = useState('other')
  const [savedModel, setSavedModel] = useState('')
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  // Mirrors savedModel so async callbacks never read a stale closure.
  const savedModelRef = useRef('')
  const busyRef = useRef(false)
  // Each query gets an id; only the latest one may update state. Bumped on
  // unmount too, so late responses are dropped (also covers StrictMode).
  const requestRef = useRef(0)
  const selectId = useId()

  const rememberModel = useCallback((name) => {
    savedModelRef.current = name
    setSavedModel(name)
  }, [])

  const query = useCallback(async () => {
    const id = ++requestRef.current
    setStatus('loading')
    setNotice('')
    setSaveError('')
    let list
    try {
      list = await listModels(apiKey)
    } catch (error) {
      if (id !== requestRef.current) return
      // The saved model is kept, so diary feedback keeps working.
      // Own-property check: `in` would also accept inherited names such
      // as toString from Object.prototype.
      setErrorCode(Object.hasOwn(QUERY_ERRORS, error?.code) ? error.code : 'other')
      setStatus('queryError')
      return
    }
    if (id !== requestRef.current) return

    // Nothing chosen yet: pick the first Flash model and save it before
    // showing the list, so the select never flashes 請選擇模型 first.
    if (!savedModelRef.current) {
      const flash = findFlashModel(list)
      if (flash) {
        try {
          await updateSettings({ geminiModel: flash.name })
          if (id !== requestRef.current) return
          rememberModel(flash.name)
        } catch {
          if (id !== requestRef.current) return
          // Still show the list so the user can pick (and retry saving).
          setSaveError(SAVE_ERROR)
        }
      }
    }
    setModels(list)
    setStatus('ready')
  }, [apiKey, rememberModel])

  useEffect(() => {
    const id = requestRef.current
    loadSettings()
      .then((settings) => {
        // Unmounted (or remounted) meanwhile: requestRef has moved on.
        if (id !== requestRef.current) return
        rememberModel(settings.geminiModel ?? '')
        query()
      })
      .catch(() => {
        if (id === requestRef.current) setStatus('loadError')
      })
    return () => {
      requestRef.current += 1
    }
  }, [query, rememberModel])

  async function handleChange(event) {
    const name = event.target.value
    if (!name || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setNotice('')
    setSaveError('')
    try {
      await updateSettings({ geminiModel: name })
      rememberModel(name)
      setNotice('已儲存')
    } catch {
      setSaveError(SAVE_ERROR)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const inList = models.some((model) => model.name === savedModel)
  // A saved model missing from the list stays stored (decisions.md) but is
  // not shown as selected, so the user is prompted to pick another one.
  const selectValue = inList ? savedModel : ''

  return (
    <section className="settings-section" aria-labelledby="settings-model">
      <h3 id="settings-model">Gemini 模型</h3>

      {status === 'loading' && <p className="muted">正在取得模型清單…</p>}

      {status === 'loadError' && (
        <p className="error" role="alert">
          無法讀取設定，請重新整理頁面。
        </p>
      )}

      {status === 'queryError' && (
        <div className="settings-form">
          <p className="error" role="alert">
            {QUERY_ERRORS[errorCode]}
          </p>
          <div className="actions">
            <button type="button" className="button button-secondary" onClick={query}>
              重新查詢
            </button>
          </div>
        </div>
      )}

      {status === 'ready' && (
        <div className="settings-form">
          <div className="field">
            <label htmlFor={selectId}>模型</label>
            <select
              id={selectId}
              value={selectValue}
              onChange={handleChange}
              disabled={busy}
            >
              {!selectValue && (
                <option value="" disabled>
                  請選擇模型
                </option>
              )}
              {models.map((model) => (
                <option key={model.name} value={model.name}>
                  {model.displayName || model.name}
                </option>
              ))}
            </select>
          </div>

          {models.length === 0 && <p className="muted">找不到可用的模型。</p>}
          {savedModel && !inList && (
            <p className="error" role="alert">
              目前選擇的模型已無法使用，請重新選擇。
            </p>
          )}
          {saveError && (
            <p className="error" role="alert">
              {saveError}
            </p>
          )}
          <p className="success" role="status">
            {notice}
          </p>
        </div>
      )}
    </section>
  )
}
