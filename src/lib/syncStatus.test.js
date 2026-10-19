import {
  NEEDS_LOGIN_MESSAGE,
  formatSyncTime,
  syncErrorMessage,
  syncLook,
  syncStateLabel,
} from './syncStatus.js'

describe('syncErrorMessage', () => {
  it('maps every code to its Chinese message', () => {
    expect(syncErrorMessage('needsLogin')).toBe(NEEDS_LOGIN_MESSAGE)
    expect(NEEDS_LOGIN_MESSAGE).toBe('Google 登入已過期，請重新登入。')
    expect(syncErrorMessage('offline')).toBe('無法連線到 Google Drive，恢復網路後會自動同步。')
    expect(syncErrorMessage('network')).toBe('無法連線到 Google Drive，恢復網路後會自動同步。')
    expect(syncErrorMessage('quota')).toBe('Google Drive 暫時無法使用，請稍後再試。')
    const unreadable = 'Google Drive 上的同步資料無法讀取，為避免資料遺失已暫停同步。'
    expect(syncErrorMessage('format')).toBe(unreadable)
    expect(syncErrorMessage('unsupportedVersion')).toBe(unreadable)
    expect(syncErrorMessage('other')).toBe('同步失敗，請稍後再試。')
  })

  it('falls back to the generic message for unknown codes', () => {
    for (const code of ['notFound', 'toString', undefined, null]) {
      expect(syncErrorMessage(code)).toBe('同步失敗，請稍後再試。')
    }
  })
})

describe('syncLook', () => {
  it('follows the state while signed in', () => {
    for (const state of ['syncing', 'synced', 'error']) {
      expect(syncLook({ signedIn: true, state })).toBe(state)
    }
  })

  it('shows nothing when signed out, idle or unknown', () => {
    expect(syncLook({ signedIn: false, state: 'synced' })).toBeNull()
    expect(syncLook({ signedIn: true, state: 'idle' })).toBeNull()
    expect(syncLook({ signedIn: true, state: 'toString' })).toBeNull()
    expect(syncLook(undefined)).toBeNull()
  })
})

describe('syncStateLabel', () => {
  it('builds the 同步狀態 text', () => {
    expect(syncStateLabel('syncing')).toBe('同步狀態：同步中')
    expect(syncStateLabel('synced')).toBe('同步狀態：已同步')
    expect(syncStateLabel('error')).toBe('同步狀態：同步失敗')
  })

  it('is empty for idle or unknown states', () => {
    expect(syncStateLabel('idle')).toBe('')
    expect(syncStateLabel('constructor')).toBe('')
  })
})

describe('formatSyncTime', () => {
  it('formats in local time (tests run in Asia/Taipei)', () => {
    expect(formatSyncTime('2026-10-19T08:05:00.000Z')).toBe('2026-10-19 16:05')
    expect(formatSyncTime('2026-12-31T16:30:00.000Z')).toBe('2027-01-01 00:30')
  })

  it('is empty for a missing or invalid time', () => {
    expect(formatSyncTime('')).toBe('')
    expect(formatSyncTime('garbage')).toBe('')
    expect(formatSyncTime(undefined)).toBe('')
    expect(formatSyncTime(123)).toBe('')
  })
})
