import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

// Top-right menu on the home page (spec 3.5): 設定 and 使用說明.
// Implemented as a disclosure (button + list of links), not an ARIA menu,
// so there is no aria-haspopup / role="menu".
// Opening 使用說明 is a plain link to /welcome, so welcomeSeen is untouched.
export default function HomeMenu() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return undefined

    // Close when the user clicks or taps anywhere outside the menu.
    function handlePointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false)
      }
    }

    // Escape closes the menu and returns focus to the toggle button so
    // keyboard users do not lose their place.
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  function close() {
    setOpen(false)
  }

  // Close when keyboard focus moves to something outside the menu (e.g.
  // Tab past the last item). Focus is left where the user moved it.
  // A null relatedTarget is ignored on purpose: Safari does not focus links
  // or buttons on click, so a click on a menu item can blur with a null
  // target; closing then would swallow the click. Clicks outside are
  // already handled by the pointer listener above.
  function handleBlur(event) {
    const next = event.relatedTarget
    if (next && rootRef.current && !rootRef.current.contains(next)) {
      setOpen(false)
    }
  }

  return (
    <div className="home-menu" ref={rootRef} onBlur={handleBlur}>
      <button
        type="button"
        ref={buttonRef}
        className="home-menu-button"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        選單
      </button>
      {open && (
        <ul id={menuId} className="home-menu-list">
          <li>
            <Link to="/settings" onClick={close}>
              設定
            </Link>
          </li>
          <li>
            <Link to="/welcome" onClick={close}>
              使用說明
            </Link>
          </li>
        </ul>
      )}
    </div>
  )
}
