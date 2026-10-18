import { useCallback, useEffect, useRef, useState } from 'react'
import { listModels } from './gemini.js'

const IDLE = Object.freeze({ status: 'idle', models: [], errorCode: '', requestId: 0 })

// The settings page's single models.list request (decisions.md Phase 2
// 設定頁 / Gemini 模型): its result tells both whether the saved API key
// works and which models can be chosen, so the key and model sections
// share it instead of each asking Gemini.
//
// state: { status: 'idle' | 'loading' | 'success' | 'error', models,
// errorCode, requestId }. requestId changes with every request, so
// consumers can tell one result from the next.
// - start(apiKey): new request with that key (page open, key saved)
// - retry(): same key again (「重新確認」)
// - reset(): no key; drops any request in flight
// Only the latest request may update the state; older responses, and
// responses after unmount, are ignored. Nothing is logged: errors may
// carry the key.
export default function useModelQuery() {
  const [state, setState] = useState(IDLE)
  const requestRef = useRef(0)
  const keyRef = useRef('')

  useEffect(
    () => () => {
      // Unmounted: invalidate whatever is still in flight.
      requestRef.current += 1
    },
    [],
  )

  const run = useCallback(async (apiKey) => {
    const id = ++requestRef.current
    keyRef.current = apiKey
    setState({ status: 'loading', models: [], errorCode: '', requestId: id })
    try {
      const models = await listModels(apiKey)
      if (id !== requestRef.current) return
      setState({ status: 'success', models, errorCode: '', requestId: id })
    } catch (error) {
      if (id !== requestRef.current) return
      const code = typeof error?.code === 'string' ? error.code : 'other'
      setState({ status: 'error', models: [], errorCode: code, requestId: id })
    }
  }, [])

  const start = useCallback((apiKey) => run(apiKey), [run])

  const retry = useCallback(() => {
    if (keyRef.current) return run(keyRef.current)
    return undefined
  }, [run])

  const reset = useCallback(() => {
    requestRef.current += 1
    keyRef.current = ''
    setState({ ...IDLE, requestId: requestRef.current })
  }, [])

  return { state, start, retry, reset }
}
