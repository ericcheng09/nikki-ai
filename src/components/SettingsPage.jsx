import { Link } from 'react-router-dom'
import ApiKeySettings from './ApiKeySettings.jsx'

// Settings page (spec 3.6). Model and language list sections are added by
// later tasks. Not guarded by welcomeSeen, so opening /settings directly
// never redirects.
export default function SettingsPage() {
  return (
    <section className="settings">
      <div className="toolbar">
        <h2>設定</h2>
        <Link to="/">回主畫面</Link>
      </div>
      <ApiKeySettings />
    </section>
  )
}
