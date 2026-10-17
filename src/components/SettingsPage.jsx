import { Link } from 'react-router-dom'

// Settings page (spec 3.6). Only the skeleton for now; API key, model and
// language list sections are added by later tasks. Not guarded by
// welcomeSeen, so opening /settings directly never redirects.
export default function SettingsPage() {
  return (
    <section className="settings">
      <div className="toolbar">
        <h2>設定</h2>
        <Link to="/">回主畫面</Link>
      </div>
    </section>
  )
}
