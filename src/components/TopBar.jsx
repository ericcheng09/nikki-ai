import { Link, matchPath, useLocation, useNavigate } from 'react-router-dom'
import WelcomeStartButton from './WelcomeStartButton.jsx'
import { canGoBackInApp } from '../lib/navigation.js'
import useSyncStatus from '../lib/useSyncStatus.js'
import syncEngine from '../lib/syncEngine.js'
import { syncLook, syncStateLabel } from '../lib/syncStatus.js'

// Fixed bar at the top of every page (decisions.md 畫面, spec 3.5):
// back button (some pages only) | app name | 設定 + 使用說明, or only
// 開始使用 on the welcome page. Icons are inline SVGs hidden from
// assistive tech; the links carry the accessible names.

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M19.14 12.94a7.07 7.07 0 0 0 .05-.94 7.07 7.07 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2.4h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.67 8.88a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.39.3.6.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.04.24.25.42.49.42h3.84c.24 0 .45-.18.49-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.08.48 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z"
      />
    </svg>
  )
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M9.2 9.3a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.4-2.8 4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17.6" r="1.2" fill="currentColor" />
    </svg>
  )
}

const CLOUD_PATH =
  'M7 19a5 5 0 0 1-.9-9.92A6 6 0 0 1 17.7 8.1 4.5 4.5 0 0 1 17.5 19Z'

// Cloud with a mark inside; the look differs in shape (arrows / check /
// exclamation) as well as colour (CSS), so it does not rely on colour.
function CloudIcon({ look }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path d={CLOUD_PATH} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      {look === 'syncing' && (
        <path
          d="M9.2 14.2a2.9 2.9 0 0 1 5.2-1.6m.4 1.6a2.9 2.9 0 0 1-5.2 1.6M14.6 11.4v1.4h-1.4M9.4 17.2v-1.4h1.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {look === 'synced' && (
        <path
          d="M9.3 14.3l1.9 1.9 3.6-3.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {look === 'error' && (
        <>
          <path d="M12 11.3v3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="16.6" r="1" fill="currentColor" />
        </>
      )}
    </svg>
  )
}

// Whether 「←」 is shown on the current route. Settings and entry pages
// (including /entry/new) go back to the in-app page they were opened
// from, or home when there is none (decisions.md 畫面, Phase 3 change).
function hasBackButton(pathname) {
  return Boolean(matchPath('/settings', pathname) || matchPath('/entry/:id', pathname))
}

export default function TopBar({ engine = syncEngine }) {
  const location = useLocation()
  // Shown only while signed in (decisions.md Phase 4); leads to settings.
  const look = syncLook(useSyncStatus(engine))
  const navigate = useNavigate()
  const back = hasBackButton(location.pathname)
  const isWelcome = Boolean(matchPath('/welcome', location.pathname))
  const isSettings = Boolean(matchPath('/settings', location.pathname))

  function handleBack() {
    if (canGoBackInApp(location)) {
      navigate(-1)
    } else {
      navigate('/')
    }
  }

  return (
    <header className="app-bar">
      <div className="app-bar-inner">
        <div className="app-bar-side">
          {back && (
            <button
              type="button"
              className="icon-button"
              aria-label="返回"
              title="返回"
              onClick={handleBack}
            >
              <span aria-hidden="true">←</span>
            </button>
          )}
        </div>
        <h1 className="app-bar-title">
          <Link to="/">外語學習日記</Link>
        </h1>
        <div className="app-bar-side app-bar-actions">
          {isWelcome ? (
            <WelcomeStartButton />
          ) : (
            <>
              {look && (
                <Link
                  to="/settings"
                  className={`icon-button sync-icon sync-icon-${look}`}
                  aria-label={syncStateLabel(look)}
                  title={syncStateLabel(look)}
                  data-sync-state={look}
                >
                  <CloudIcon look={look} />
                </Link>
              )}
              {!isSettings && (
                <Link to="/settings" className="icon-button" aria-label="設定" title="設定">
                  <GearIcon />
                </Link>
              )}
              {/* A plain link: opening the guide never touches welcomeSeen. */}
              <Link to="/welcome" className="icon-button" aria-label="使用說明" title="使用說明">
                <HelpIcon />
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
