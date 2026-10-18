import { renderHook } from '@testing-library/react'
import useAutoGrow, { fitTextareaHeight } from './useAutoGrow.js'

// jsdom does no layout, so scrollHeight is stubbed per textarea.
function makeTextarea(scrollHeight) {
  const el = document.createElement('textarea')
  el.style.borderTop = '1px solid black'
  el.style.borderBottom = '1px solid black'
  el.style.boxSizing = 'border-box'
  let height = scrollHeight
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => height })
  document.body.appendChild(el)
  return {
    el,
    setScrollHeight(value) {
      height = value
    },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  delete globalThis.ResizeObserver
  vi.restoreAllMocks()
})

describe('fitTextareaHeight', () => {
  it('sets the height to the content height plus borders (border-box)', () => {
    const { el } = makeTextarea(400)
    fitTextareaHeight(el)
    expect(el.style.height).toBe('402px')
  })

  it('measures from height auto so the box can shrink again', () => {
    const { el } = makeTextarea(900)
    fitTextareaHeight(el)
    expect(el.style.height).toBe('902px')
    // The old explicit height must be cleared before measuring, otherwise
    // scrollHeight would never drop below it.
    const seen = []
    Object.defineProperty(el, 'scrollHeight', {
      configurable: true,
      get: () => {
        seen.push(el.style.height)
        return 300
      },
    })
    fitTextareaHeight(el)
    expect(seen).toEqual(['auto'])
    expect(el.style.height).toBe('302px')
  })

  it('subtracts padding for content-box sizing', () => {
    const { el } = makeTextarea(400)
    el.style.boxSizing = 'content-box'
    el.style.padding = '8px'
    fitTextareaHeight(el)
    expect(el.style.height).toBe('384px')
  })

  it('does nothing without an element', () => {
    expect(() => fitTextareaHeight(null)).not.toThrow()
  })
})

describe('useAutoGrow', () => {
  it('fits on mount and again whenever the value changes', () => {
    const { el, setScrollHeight } = makeTextarea(300)
    const ref = { current: el }
    const { rerender } = renderHook(({ value }) => useAutoGrow(ref, value), {
      initialProps: { value: 'a' },
    })
    expect(el.style.height).toBe('302px')

    setScrollHeight(700)
    rerender({ value: 'a\n'.repeat(40) })
    expect(el.style.height).toBe('702px')
  })

  // ResizeObserver callback + a hand-driven requestAnimationFrame queue.
  function installObserver() {
    const observer = { callback: null, observe: vi.fn(), disconnect: vi.fn() }
    globalThis.ResizeObserver = vi.fn(function ResizeObserver(cb) {
      observer.callback = cb
      this.observe = observer.observe
      this.disconnect = observer.disconnect
    })
    const frames = new Map()
    let nextId = 1
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => {
      const id = nextId++
      frames.set(id, fn)
      return id
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => frames.delete(id))
    const runFrames = () => {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach((fn) => fn())
    }
    return { observer, frames, runFrames }
  }

  it('refits on width changes only, in the next animation frame', () => {
    const { observer, frames, runFrames } = installObserver()
    const { el, setScrollHeight } = makeTextarea(300)
    let width = 500
    el.getBoundingClientRect = () => ({ width })
    const ref = { current: el }
    const { unmount } = renderHook(() => useAutoGrow(ref, 'text'))
    expect(observer.observe).toHaveBeenCalledWith(el)

    // A height-only change (our own resize) must not refit.
    setScrollHeight(800)
    observer.callback()
    expect(frames.size).toBe(0)
    expect(el.style.height).toBe('302px')

    // A narrower box wraps more lines; the height is not touched inside
    // the observer callback, only in the scheduled frame.
    width = 300
    observer.callback()
    expect(el.style.height).toBe('302px')
    runFrames()
    expect(el.style.height).toBe('802px')

    unmount()
    expect(observer.disconnect).toHaveBeenCalled()
  })

  it('coalesces several width changes into one frame', () => {
    const { observer, frames, runFrames } = installObserver()
    const { el, setScrollHeight } = makeTextarea(300)
    let width = 500
    el.getBoundingClientRect = () => ({ width })
    renderHook(() => useAutoGrow({ current: el }, 'text'))

    width = 400
    observer.callback()
    width = 300
    observer.callback()
    expect(frames.size).toBe(1)
    setScrollHeight(600)
    runFrames()
    expect(el.style.height).toBe('602px')
  })

  it('cancels a pending frame on unmount', () => {
    const { observer, frames } = installObserver()
    const { el } = makeTextarea(300)
    let width = 500
    el.getBoundingClientRect = () => ({ width })
    const { unmount } = renderHook(() => useAutoGrow({ current: el }, 'text'))
    width = 300
    observer.callback()
    expect(frames.size).toBe(1)
    unmount()
    expect(window.cancelAnimationFrame).toHaveBeenCalled()
    expect(frames.size).toBe(0)
  })

  it('keeps the content-change refit synchronous', () => {
    installObserver()
    const { el, setScrollHeight } = makeTextarea(300)
    el.getBoundingClientRect = () => ({ width: 500 })
    const { rerender } = renderHook(({ value }) => useAutoGrow({ current: el }, value), {
      initialProps: { value: 'a' },
    })
    expect(el.style.height).toBe('302px')
    setScrollHeight(700)
    rerender({ value: 'long' })
    expect(el.style.height).toBe('702px')
    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('falls back to window resize without ResizeObserver', () => {
    const { el, setScrollHeight } = makeTextarea(300)
    const ref = { current: el }
    const { unmount } = renderHook(() => useAutoGrow(ref, 'text'))
    setScrollHeight(500)
    window.dispatchEvent(new Event('resize'))
    expect(el.style.height).toBe('502px')

    unmount()
    setScrollHeight(900)
    window.dispatchEvent(new Event('resize'))
    expect(el.style.height).toBe('502px')
  })

  it('tolerates an empty ref', () => {
    const ref = { current: null }
    expect(() => renderHook(() => useAutoGrow(ref, ''))).not.toThrow()
  })
})
