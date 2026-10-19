import { renderHook } from '@testing-library/react'
import useSyncReplacedData from './useSyncReplacedData.js'
import { syncReplacedData } from '../storage/syncSignals.js'

describe('useSyncReplacedData', () => {
  it('calls the latest handler on every signal', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ handler }) => useSyncReplacedData(handler), {
      initialProps: { handler: first },
    })
    syncReplacedData.emit()
    expect(first).toHaveBeenCalledTimes(1)
    rerender({ handler: second })
    syncReplacedData.emit()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes on unmount', () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() => useSyncReplacedData(handler))
    unmount()
    syncReplacedData.emit()
    expect(handler).not.toHaveBeenCalled()
  })
})
