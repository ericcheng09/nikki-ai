// Texts and helpers for showing the sync status (decisions.md Phase 4).
// Pure functions; the status itself comes from syncEngine.js.

export const SYNC_STATE_TEXT = Object.freeze({
  syncing: '同步中',
  synced: '已同步',
  error: '同步失敗',
})

export const NEEDS_LOGIN_MESSAGE = 'Google 登入已過期，請重新登入。'

const ERROR_MESSAGES = Object.freeze({
  needsLogin: NEEDS_LOGIN_MESSAGE,
  offline: '無法連線到 Google Drive，恢復網路後會自動同步。',
  network: '無法連線到 Google Drive，恢復網路後會自動同步。',
  quota: 'Google Drive 暫時無法使用，請稍後再試。',
  format: 'Google Drive 上的同步資料無法讀取，為避免資料遺失已暫停同步。',
  unsupportedVersion: 'Google Drive 上的同步資料無法讀取，為避免資料遺失已暫停同步。',
  other: '同步失敗，請稍後再試。',
})

// Message for an error code; unknown codes (including inherited names
// such as "toString") get the generic one.
export function syncErrorMessage(code) {
  return Object.hasOwn(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : ERROR_MESSAGES.other
}

// Which look the top bar icon has: 'syncing' | 'synced' | 'error', or
// null for no icon (signed out, or no sync has started yet).
export function syncLook(status) {
  if (!status?.signedIn) return null
  return Object.hasOwn(SYNC_STATE_TEXT, status.state) ? status.state : null
}

// 「同步狀態：已同步」 etc., or '' when there is nothing to show.
export function syncStateLabel(state) {
  return Object.hasOwn(SYNC_STATE_TEXT, state) ? `同步狀態：${SYNC_STATE_TEXT[state]}` : ''
}

const pad = (n) => String(n).padStart(2, '0')

// ISO time -> "YYYY-MM-DD HH:mm" in the device's local time; '' when it
// is missing or unparsable.
export function formatSyncTime(iso) {
  const time = typeof iso === 'string' ? Date.parse(iso) : NaN
  if (Number.isNaN(time)) return ''
  const d = new Date(time)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
