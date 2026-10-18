import { useCallback, useLayoutEffect } from 'react'

// Sets a textarea's height so all of its content fits without an inner
// scrollbar (decisions.md Phase 2 畫面). The minimum comes from the
// element's own `rows`: with `height: auto` the box is `rows` lines tall
// and scrollHeight is never smaller than that, so it never shrinks below.
export function fitTextareaHeight(el) {
  if (!el) return
  // Collapsing the box to `auto` can briefly shorten the page; if the
  // page is scrolled near its bottom the browser clamps the scroll
  // position and would not restore it, so remember and restore it.
  const scroller = typeof document !== 'undefined' ? document.scrollingElement : null
  const scrollTop = scroller ? scroller.scrollTop : 0
  el.style.height = 'auto'
  const style = window.getComputedStyle(el)
  // scrollHeight covers content + padding; the app uses border-box
  // sizing, so the borders have to be added on top.
  const borders =
    style.boxSizing === 'border-box'
      ? (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
      : -((parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0))
  el.style.height = `${el.scrollHeight + borders}px`
  if (scroller && scroller.scrollTop !== scrollTop) scroller.scrollTop = scrollTop
}

// Keeps the textarea in `ref` fitted to its content: after every value
// change (initial load, typing, pasting, programmatic updates) and when
// its width changes, since the width decides where lines wrap.
export default function useAutoGrow(ref, value) {
  // Runs before paint, so a long entry never flashes at 12 rows.
  useLayoutEffect(() => {
    fitTextareaHeight(ref.current)
  }, [ref, value])

  const refit = useCallback(() => fitTextareaHeight(ref.current), [ref])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    let cancelled = false
    // Web fonts finishing to load can change the line wrap.
    document.fonts?.ready?.then(() => {
      if (!cancelled) refit()
    })
    if (typeof ResizeObserver === 'function') {
      // Only width changes matter; our own height changes also trigger the
      // observer and are ignored to avoid a resize loop.
      let lastWidth = el.getBoundingClientRect().width
      let frame = 0
      const observer = new ResizeObserver(() => {
        const width = el.getBoundingClientRect().width
        if (width === lastWidth) return
        lastWidth = width
        // Changing the height while notifications are being delivered makes
        // the browser report "ResizeObserver loop completed with undelivered
        // notifications", so refit in the next frame instead. Several
        // callbacks before that frame share one refit.
        if (frame) return
        frame = window.requestAnimationFrame(() => {
          frame = 0
          refit()
        })
      })
      observer.observe(el)
      return () => {
        cancelled = true
        observer.disconnect()
        if (frame) window.cancelAnimationFrame(frame)
      }
    }
    // Fallback without ResizeObserver: the column width follows the window.
    window.addEventListener('resize', refit)
    return () => {
      cancelled = true
      window.removeEventListener('resize', refit)
    }
  }, [ref, refit])
}
