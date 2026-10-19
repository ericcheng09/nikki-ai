import { useSyncExternalStore } from 'react'
import syncEngine from './syncEngine.js'

// Current sync status (see syncEngine.js), re-rendering on every change.
export default function useSyncStatus(engine = syncEngine) {
  return useSyncExternalStore(engine.subscribe, engine.getStatus)
}
