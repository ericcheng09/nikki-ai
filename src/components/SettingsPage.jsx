import { useState } from 'react'
import ApiKeySettings from './ApiKeySettings.jsx'
import ModelSettings from './ModelSettings.jsx'
import LanguageListSettings from './LanguageListSettings.jsx'

// Settings page (spec 3.6). Not guarded by welcomeSeen, so opening
// /settings directly never redirects.
export default function SettingsPage() {
  // The stored API key as reported by ApiKeySettings; '' = none (yet).
  const [apiKey, setApiKey] = useState('')
  // Bumped on every load/save so ModelSettings remounts and queries the
  // model list again, even when the same key is saved twice.
  const [keyVersion, setKeyVersion] = useState(0)

  function handleKeyChange(key) {
    setApiKey(key)
    setKeyVersion((version) => version + 1)
  }

  return (
    <section className="settings">
      {/* Back and home are in the top bar. */}
      <h2>設定</h2>
      <ApiKeySettings onKeyChange={handleKeyChange} />
      {/* Model choice needs a key to query with; hidden (but kept in
          storage) once the key is deleted. */}
      {apiKey && <ModelSettings key={keyVersion} apiKey={apiKey} />}
      {/* Independent of the API key. */}
      <LanguageListSettings />
    </section>
  )
}
