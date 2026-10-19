// Test stand-in for the syncEngine default instance (unit tests only).
export function fakeSyncEngine(initial = {}) {
  const listeners = new Set()
  let status = Object.freeze({
    signedIn: false,
    state: 'idle',
    code: null,
    lastSyncedAt: '',
    ...initial,
  })
  return {
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    syncNow: vi.fn(async () => undefined),
    // Replaces the status (as the engine does: always a new object).
    set(patch) {
      status = Object.freeze({ ...status, ...patch })
      listeners.forEach((listener) => listener(status))
    },
  }
}
