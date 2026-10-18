import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { modelChoices, pickDefaultModel, shownModels } from '../lib/models.js'
import { loadSettings, updateSettings } from '../storage/connection.js'

const SAVE_ERROR = '無法儲存設定，請重新整理頁面後再試一次。'

// Gemini model section of the settings page (spec 3.6, decisions.md
// Phase 2 「Gemini 模型」). It does not query Gemini itself: `query` is the
// page's shared models.list request (see useModelQuery), and the parent
// renders this section only while that request is loading or succeeded,
// remounting it for every new request. Errors and retrying belong to the
// API key section, so a failed request never reaches this component and
// never changes the saved model.
export default function ModelSettings({ query }) {
  // settings: 'loading' | 'ready' | 'error' (reading the saved model)
  const [settingsStatus, setSettingsStatus] = useState('loading')
  // The successful list once the saved model is known and the automatic
  // choice (if any) is done; null until then, so the select never shows
  // 請選擇模型 just before the automatic choice lands.
  const [models, setModels] = useState(null)
  const [savedModel, setSavedModel] = useState('')
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  // Mirrors savedModel so async callbacks never read a stale closure.
  const savedModelRef = useRef('')
  const busyRef = useRef(false)
  const selectId = useId()

  const rememberModel = useCallback((name) => {
    savedModelRef.current = name
    setSavedModel(name)
  }, [])

  useEffect(() => {
    let active = true
    loadSettings()
      .then((settings) => {
        if (!active) return
        rememberModel(settings.geminiModel ?? '')
        setSettingsStatus('ready')
      })
      .catch(() => {
        if (active) setSettingsStatus('error')
      })
    return () => {
      active = false
    }
  }, [rememberModel])

  const list = query.status === 'success' ? query.models : null

  // Once both the list and the saved model are known: nothing chosen yet
  // means pick the newest Flash model of the shown list (never a
  // filtered-out one; see pickDefaultModel) and save it before showing
  // the select.
  useEffect(() => {
    if (!list || settingsStatus !== 'ready') return undefined
    let active = true
    async function prepare() {
      if (!savedModelRef.current) {
        const flash = pickDefaultModel(shownModels(list))
        if (flash) {
          try {
            await updateSettings({ geminiModel: flash.name })
            if (!active) return
            rememberModel(flash.name)
          } catch {
            if (!active) return
            // Still show the list so the user can pick (and retry saving).
            setSaveError(SAVE_ERROR)
          }
        }
      }
      if (active) setModels(list)
    }
    prepare()
    return () => {
      active = false
    }
  }, [list, settingsStatus, rememberModel])

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

  // A saved model hidden by the filter but still available is offered as
  // an extra option (see modelChoices). One missing from the full list
  // stays stored (decisions.md) but is not shown as selected, so the user
  // is prompted to pick another one.
  const { options, savedUsable } = modelChoices(models ?? [], savedModel)
  const selectValue = savedUsable ? savedModel : ''
  const ready = settingsStatus === 'ready' && models !== null

  return (
    <section className="settings-section" aria-labelledby="settings-model">
      <h3 id="settings-model">Gemini 模型</h3>

      {settingsStatus === 'error' && (
        <p className="error" role="alert">
          無法讀取設定，請重新整理頁面。
        </p>
      )}

      {settingsStatus !== 'error' && !ready && <p className="muted">正在取得模型清單…</p>}

      {ready && (
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
              {options.map((model) => (
                <option key={model.name} value={model.name}>
                  {model.displayName || model.name}
                </option>
              ))}
            </select>
          </div>

          {options.length === 0 && <p className="muted">找不到可用的模型。</p>}
          {savedModel && !savedUsable && (
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
