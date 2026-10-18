import { useEffect, useState } from 'react'

// Breakpoint of the side-by-side entry layout; keep in sync with the
// `@media (min-width: 768px)` rule in index.css.
export const WIDE_LAYOUT_QUERY = '(min-width: 768px)'

function currentMatch(query) {
  // matchMedia is missing in some environments (e.g. jsdom): treat the
  // query as not matching, i.e. the narrow, stacked layout.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(query).matches
}

// Whether `query` currently matches; updates when the viewport changes.
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => currentMatch(query))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    // The query may have changed since the initial state was computed.
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])

  return matches
}
