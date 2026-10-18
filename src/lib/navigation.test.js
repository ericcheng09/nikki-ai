import { canGoBackInApp } from './navigation.js'

afterEach(() => {
  window.history.replaceState(null, '')
})

describe('canGoBackInApp', () => {
  it('is false for the first location of the session', () => {
    expect(canGoBackInApp({ key: 'default' })).toBe(false)
    // Even if history.state claims otherwise.
    window.history.replaceState({ idx: 3 }, '')
    expect(canGoBackInApp({ key: 'default' })).toBe(false)
  })

  it('falls back to the key when history.state has no index (MemoryRouter)', () => {
    expect(canGoBackInApp({ key: 'abc' })).toBe(true)
  })

  it('uses history.state.idx when present', () => {
    window.history.replaceState({ idx: 0 }, '')
    expect(canGoBackInApp({ key: 'abc' })).toBe(false)
    window.history.replaceState({ idx: 2 }, '')
    expect(canGoBackInApp({ key: 'abc' })).toBe(true)
  })
})
