import { act, renderHook } from '@testing-library/react'
import useMediaQuery from './useMediaQuery.js'

// Minimal MediaQueryList stand-in whose state the test can flip.
function installMatchMedia(initial) {
  const listeners = new Set()
  const list = {
    matches: initial,
    addEventListener: vi.fn((type, fn) => listeners.add(fn)),
    removeEventListener: vi.fn((type, fn) => listeners.delete(fn)),
  }
  window.matchMedia = vi.fn(() => list)
  return {
    list,
    set(value) {
      list.matches = value
      listeners.forEach((fn) => fn())
    },
    listenerCount: () => listeners.size,
  }
}

afterEach(() => {
  delete window.matchMedia
})

describe('useMediaQuery', () => {
  it('returns the current match and follows changes', () => {
    const media = installMatchMedia(true)
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'))
    expect(result.current).toBe(true)
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 768px)')

    act(() => media.set(false))
    expect(result.current).toBe(false)
  })

  it('stops listening on unmount', () => {
    const media = installMatchMedia(false)
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 768px)'))
    expect(media.listenerCount()).toBe(1)
    unmount()
    expect(media.listenerCount()).toBe(0)
  })

  it('returns false when matchMedia is unavailable', () => {
    delete window.matchMedia
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'))
    expect(result.current).toBe(false)
  })
})
