import { Link, matchPath, useLocation, useNavigate } from 'react-router-dom'
import WelcomeStartButton from './WelcomeStartButton.jsx'
import { canGoBackInApp } from '../lib/navigation.js'

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

// Whether 「←」 is shown on the current route. Settings and entry pages
// (including /entry/new) go back to the in-app page they were opened
// from, or home when there is none (decisions.md 畫面, Phase 3 change).
function hasBackButton(pathname) {
  return Boolean(matchPath('/settings', pathname) || matchPath('/entry/:id', pathname))
}

export default function TopBar() {
  const location = useLocation()
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
