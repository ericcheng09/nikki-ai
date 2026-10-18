import { act, renderHook } from '@testing-library/react'
import useModelQuery from './useModelQuery.js'
import { listModels } from './gemini.js'

vi.mock('./gemini.js', () => ({ listModels: vi.fn() }))

const FLASH = { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' }

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.mocked(listModels).mockReset()
})

describe('useModelQuery', () => {
  it('starts idle and sends nothing', () => {
    const { result } = renderHook(() => useModelQuery())
    expect(result.current.state.status).toBe('idle')
    expect(listModels).not.toHaveBeenCalled()
  })

  it('loads, then reports the list with a new requestId', async () => {
    const pending = deferred()
    vi.mocked(listModels).mockReturnValue(pending.promise)
    const { result } = renderHook(() => useModelQuery())
    act(() => {
      result.current.start('key-1')
    })
    expect(result.current.state.status).toBe('loading')
    const { requestId } = result.current.state
    await act(async () => pending.resolve([FLASH]))
    expect(result.current.state).toEqual({
      status: 'success',
      models: [FLASH],
      errorCode: '',
      requestId,
    })
    expect(listModels).toHaveBeenCalledTimes(1)
    expect(listModels).toHaveBeenCalledWith('key-1')
  })

  it.each([
    ['invalidKey', 'invalidKey'],
    ['network', 'network'],
    ['quota', 'quota'],
    [undefined, 'other'],
  ])('reports the error code %s', async (code, expected) => {
    vi.mocked(listModels).mockRejectedValue(Object.assign(new Error('x'), { code }))
    const { result } = renderHook(() => useModelQuery())
    await act(async () => result.current.start('key-1'))
    expect(result.current.state.status).toBe('error')
    expect(result.current.state.errorCode).toBe(expected)
  })

  it('retries exactly once with the last key', async () => {
    vi.mocked(listModels)
      .mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'network' }))
      .mockResolvedValueOnce([FLASH])
    const { result } = renderHook(() => useModelQuery())
    await act(async () => result.current.start('key-1'))
    await act(async () => result.current.retry())
    expect(listModels).toHaveBeenCalledTimes(2)
    expect(listModels).toHaveBeenLastCalledWith('key-1')
    expect(result.current.state.status).toBe('success')
  })

  it('does nothing on retry without a key', async () => {
    const { result } = renderHook(() => useModelQuery())
    await act(async () => result.current.retry())
    expect(listModels).not.toHaveBeenCalled()
  })

  it('ignores a slower response for a replaced key', async () => {
    const first = deferred()
    vi.mocked(listModels).mockReturnValueOnce(first.promise).mockResolvedValueOnce([FLASH])
    const { result } = renderHook(() => useModelQuery())
    act(() => {
      result.current.start('old-key')
    })
    await act(async () => result.current.start('new-key'))
    await act(async () => first.reject(Object.assign(new Error('x'), { code: 'invalidKey' })))
    expect(result.current.state.status).toBe('success')
    expect(result.current.state.models).toEqual([FLASH])
  })

  it('drops a request in flight on reset', async () => {
    const pending = deferred()
    vi.mocked(listModels).mockReturnValue(pending.promise)
    const { result } = renderHook(() => useModelQuery())
    act(() => {
      result.current.start('key-1')
    })
    act(() => result.current.reset())
    await act(async () => pending.resolve([FLASH]))
    expect(result.current.state.status).toBe('idle')
    // Without a key there is nothing to retry.
    await act(async () => result.current.retry())
    expect(listModels).toHaveBeenCalledTimes(1)
  })

  it('ignores a response after unmount', async () => {
    const pending = deferred()
    vi.mocked(listModels).mockReturnValue(pending.promise)
    const { result, unmount } = renderHook(() => useModelQuery())
    act(() => {
      result.current.start('key-1')
    })
    const before = result.current.state
    unmount()
    await act(async () => pending.resolve([FLASH]))
    expect(result.current.state).toBe(before)
  })
})
