// Shared rule for leaving a page "the way ← does" (decisions.md 畫面).

// True when an earlier page of this app session is behind the current one.
// key 'default' marks the first location of the session (opened directly).
// BrowserRouter also stores the entry's index in history.state.idx, which
// a replace keeps: /entry/new opened directly and then saved (replaced by
// /entry/:id) gets a new key but is still index 0, so navigate(-1) would
// leave the app. Routers without that state (MemoryRouter) use the key only.
export function canGoBackInApp(location) {
  if (location.key === 'default') return false
  const idx = window.history.state?.idx
  return typeof idx === 'number' ? idx > 0 : true
}
