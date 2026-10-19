// Change notifications for sync (decisions.md Phase 4). In their own
// module, without IndexedDB, so UI code can subscribe without pulling in
// (or, in tests, mocking) the storage layer. connection.js emits them.
// Two separate signals so sync never triggers itself:
// - syncedDataChange: the user changed synced data on this device (entry
//   save/edit/delete, analysis, language add/remove, API key or model).
//   The sync scheduler listens to this one.
// - syncReplacedData: a sync wrote data from another device. Pages listen
//   to this one to reload; it never schedules another sync.
// Both fire only after the write has been committed.

// A small listener set; one failing listener must not break the write that
// triggered it or the other listeners, so errors are swallowed on purpose
// (and never logged: listeners may receive nothing, but stay safe anyway).
function createSignal() {
  const listeners = new Set()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit() {
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch {
          // Ignored, see above.
        }
      }
    },
  }
}

// Emitted by connection.js only.
export const syncedDataChange = createSignal()
export const syncReplacedData = createSignal()

// Subscribes to local changes of synced data; returns an unsubscribe.
export function onSyncedDataChange(listener) {
  return syncedDataChange.subscribe(listener)
}

// Subscribes to "a sync wrote new data locally"; returns an unsubscribe.
export function onSyncReplacedData(listener) {
  return syncReplacedData.subscribe(listener)
}
