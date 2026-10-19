import { useEffect, useRef } from 'react'
import { onSyncReplacedData } from '../storage/syncSignals.js'

// Calls `handler` whenever a sync wrote data from another device, so a
// page can reload what it shows. The latest handler is used without
// re-subscribing on every render.
export default function useSyncReplacedData(handler) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => onSyncReplacedData(() => ref.current?.()), [])
}
