import { useState } from 'react'
import ApiKeySettings from './ApiKeySettings.jsx'
import ModelSettings from './ModelSettings.jsx'
import LanguageListSettings from './LanguageListSettings.jsx'
import useModelQuery from '../lib/useModelQuery.js'

// Settings page (spec 3.6). Not guarded by welcomeSeen, so opening
// /settings directly never redirects.
export default function SettingsPage() {
  // The stored API key as reported by ApiKeySettings; '' = none (yet).
  const [apiKey, setApiKey] = useState('')
  // One models.list request serves both sections: the key section shows
  // whether the key works (and offers 重新確認), the model section lists
  // the models (decisions.md Phase 2 設定頁).
  const modelQuery = useModelQuery()
  const { status, requestId } = modelQuery.state

  // Called once the stored key is loaded and after every save or delete,
  // so a request runs on page open and after each save (even of the same
  // key), never more.
  function handleKeyChange(key) {
    setApiKey(key)
    if (key) {
      modelQuery.start(key)
    } else {
      modelQuery.reset()
    }
  }

  return (
    <section className="settings">
      {/* Back and home are in the top bar. */}
      <h2>設定</h2>
      <ApiKeySettings
        onKeyChange={handleKeyChange}
        keyCheck={modelQuery.state}
        onRetry={modelQuery.retry}
      />
      {/* Model choice needs a key that works: hidden (but kept in storage)
          without a key or when the request failed; the key section then
          shows the error and 重新確認. Remounted per request (requestId),
          so each result starts from a fresh section. */}
      {apiKey && (status === 'loading' || status === 'success') && (
        <ModelSettings key={requestId} query={modelQuery.state} />
      )}
      {/* Independent of the API key. */}
      <LanguageListSettings />
    </section>
  )
}
