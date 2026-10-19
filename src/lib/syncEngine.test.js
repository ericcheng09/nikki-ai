import { CHANGE_DEBOUNCE_MS, SYNC_LOCK_NAME, createSyncEngine } from './syncEngine.js'
import { DriveError } from './drive.js'
import { SYNC_FORMAT, SYNC_VERSION, buildSyncFile } from './sync.js'

const NOW = new Date('2026-10-19T08:30:00.000Z')
const T1 = '2026-10-01T00:00:00.000Z'
const T2 = '2026-10-02T00:00:00.000Z'
const TOKEN = 'ya29.engine-token'

function entry(id, updatedAt = T1, extra = {}) {
  return {
    id,
    date: '2026-10-01',
    content: `content ${id}`,
    language: 'auto',
    createdAt: T1,
    updatedAt,
    deleted: false,
    deletedAt: null,
    analysis: null,
    ...extra,
  }
}

function snapshot({ entries = [], customLanguages = [], settings = {} } = {}) {
  return { entries, customLanguages, settings }
}

function fileText(data) {
  return JSON.stringify(buildSyncFile(data))
}

// In-memory Drive: files { id, createdTime, text }.
function fakeDrive(files = []) {
  const state = { files: files.map((f) => ({ ...f })), nextId: 1 }
  const drive = {
    state,
    listSyncFiles: vi.fn(async () =>
      state.files.map(({ id, createdTime }) => ({ id, createdTime, modifiedTime: createdTime })),
    ),
    downloadSyncFile: vi.fn(async (_token, id) => {
      const file = state.files.find((f) => f.id === id)
      if (!file) throw new DriveError('notFound')
      return file.text
    }),
    createSyncFile: vi.fn(async (_token, text) => {
      const id = `new${state.nextId++}`
      state.files.push({ id, createdTime: NOW.toISOString(), text })
      return id
    }),
    updateSyncFile: vi.fn(async (_token, id, text) => {
      const file = state.files.find((f) => f.id === id)
      if (!file) throw new DriveError('notFound')
      file.text = text
    }),
    deleteSyncFile: vi.fn(async (_token, id) => {
      const index = state.files.findIndex((f) => f.id === id)
      if (index < 0) throw new DriveError('notFound')
      state.files.splice(index, 1)
    }),
  }
  return drive
}

function fakeStore(local = snapshot()) {
  const listeners = new Set()
  const store = {
    local,
    lastSyncedAt: '',
    readSyncSnapshot: vi.fn(async () => store.local),
    applySyncResult: vi.fn(async (merged) => {
      store.local = merged
      return true
    }),
    invalidateGoogleToken: vi.fn(async () => true),
    loadLastSyncedAt: vi.fn(async () => store.lastSyncedAt),
    storeLastSyncedAt: vi.fn(async (value) => {
      store.lastSyncedAt = value
    }),
    onSyncedDataChange: vi.fn((listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    emitChange: () => listeners.forEach((l) => l()),
  }
  return store
}

function fakeAuth(initial = 'signedIn') {
  const listeners = new Set()
  const auth = {
    status: initial,
    getStatus: vi.fn(async () => auth.status),
    getAccessToken: vi.fn(async () => {
      if (auth.status === 'signedOut') return { status: 'signedOut' }
      if (auth.status === 'needsLogin') return { status: 'needsLogin' }
      return { status: 'ok', accessToken: TOKEN }
    }),
    onStatusChange: vi.fn((listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    emit(next) {
      auth.status = next
      listeners.forEach((l) => l(next))
    },
  }
  return auth
}

function fakeWindow() {
  const target = new EventTarget()
  return target
}

function setup({ auth = fakeAuth(), drive = fakeDrive(), store = fakeStore(), online = true, locks, win = fakeWindow() } = {}) {
  const env = { online }
  const engine = createSyncEngine({
    auth,
    drive,
    store,
    now: () => NOW,
    isOnline: () => env.online,
    getLocks: () => locks,
    getWindow: () => win,
  })
  return { engine, auth, drive, store, env, win }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('syncNow', () => {
  it('merges local and Drive data, writes both sides and reports synced', async () => {
    const drive = fakeDrive([
      { id: 'f1', createdTime: T1, text: fileText(snapshot({ entries: [entry('remote')] })) },
    ])
    const store = fakeStore(snapshot({ entries: [entry('local')] }))
    const { engine } = setup({ drive, store })

    await engine.syncNow()

    expect(drive.listSyncFiles).toHaveBeenCalledWith(TOKEN)
    expect(drive.downloadSyncFile).toHaveBeenCalledWith(TOKEN, 'f1')
    expect(store.applySyncResult).toHaveBeenCalledTimes(1)
    expect(store.local.entries.map((e) => e.id).sort()).toEqual(['local', 'remote'])
    expect(drive.updateSyncFile).toHaveBeenCalledTimes(1)
    expect(drive.updateSyncFile.mock.calls[0][1]).toBe('f1')
    const uploaded = JSON.parse(drive.state.files[0].text)
    expect(uploaded.format).toBe(SYNC_FORMAT)
    expect(uploaded.version).toBe(SYNC_VERSION)
    expect(uploaded.entries.map((e) => e.id).sort()).toEqual(['local', 'remote'])
    expect(drive.createSyncFile).not.toHaveBeenCalled()
    expect(engine.getStatus()).toEqual({
      signedIn: true,
      state: 'synced',
      code: null,
      lastSyncedAt: NOW.toISOString(),
    })
    expect(store.storeLastSyncedAt).toHaveBeenCalledWith(NOW.toISOString())
  })

  it('uploads nothing and writes nothing locally when both sides are equal', async () => {
    const data = snapshot({ entries: [entry('a')] })
    const drive = fakeDrive([{ id: 'f1', createdTime: T1, text: fileText(data) }])
    const { engine, store } = setup({ drive, store: fakeStore(data) })
    await engine.syncNow()
    expect(drive.updateSyncFile).not.toHaveBeenCalled()
    expect(drive.createSyncFile).not.toHaveBeenCalled()
    expect(store.applySyncResult).not.toHaveBeenCalled()
    expect(engine.getStatus().state).toBe('synced')
  })

  it('creates the file when Drive has none, without touching local data', async () => {
    const drive = fakeDrive()
    const { engine, store } = setup({ drive, store: fakeStore(snapshot({ entries: [entry('a')] })) })
    await engine.syncNow()
    expect(drive.createSyncFile).toHaveBeenCalledTimes(1)
    expect(drive.createSyncFile.mock.calls[0][0]).toBe(TOKEN)
    expect(JSON.parse(drive.createSyncFile.mock.calls[0][1]).entries[0].id).toBe('a')
    expect(store.applySyncResult).not.toHaveBeenCalled()
    expect(engine.getStatus().state).toBe('synced')
  })

  it('merges every duplicate file into the oldest one and deletes the others', async () => {
    const drive = fakeDrive([
      { id: 'old', createdTime: T1, text: fileText(snapshot({ entries: [entry('x', T1)] })) },
      {
        id: 'dup',
        createdTime: T2,
        text: fileText(snapshot({ entries: [entry('x', T2, { content: 'newer' }), entry('y')] })),
      },
    ])
    const { engine, store } = setup({ drive, store: fakeStore(snapshot({ entries: [entry('z')] })) })
    await engine.syncNow()

    expect(drive.updateSyncFile.mock.calls.map((c) => c[1])).toEqual(['old'])
    expect(drive.deleteSyncFile.mock.calls.map((c) => c[1])).toEqual(['dup'])
    expect(drive.state.files.map((f) => f.id)).toEqual(['old'])
    const uploaded = JSON.parse(drive.state.files[0].text)
    expect(uploaded.entries.map((e) => e.id).sort()).toEqual(['x', 'y', 'z'])
    expect(uploaded.entries.find((e) => e.id === 'x').content).toBe('newer')
    expect(store.local.entries.map((e) => e.id).sort()).toEqual(['x', 'y', 'z'])
    expect(engine.getStatus().state).toBe('synced')
  })

  it('still cleans up duplicates when the content already matches', async () => {
    const data = snapshot({ entries: [entry('a')] })
    const drive = fakeDrive([
      { id: 'old', createdTime: T1, text: fileText(data) },
      { id: 'dup', createdTime: T2, text: fileText(data) },
    ])
    const { engine } = setup({ drive, store: fakeStore(data) })
    await engine.syncNow()
    expect(drive.updateSyncFile).toHaveBeenCalledTimes(1)
    expect(drive.state.files.map((f) => f.id)).toEqual(['old'])
  })

  it('treats a duplicate already deleted by another device as done', async () => {
    const data = snapshot()
    const drive = fakeDrive([
      { id: 'old', createdTime: T1, text: fileText(data) },
      { id: 'dup', createdTime: T2, text: fileText(data) },
    ])
    drive.deleteSyncFile.mockRejectedValueOnce(new DriveError('notFound'))
    const { engine } = setup({ drive })
    await engine.syncNow()
    expect(engine.getStatus().state).toBe('synced')
  })

  it('skips a file deleted between listing and downloading', async () => {
    const drive = fakeDrive([{ id: 'f1', createdTime: T1, text: fileText(snapshot()) }])
    drive.listSyncFiles.mockResolvedValueOnce([
      { id: 'f1', createdTime: T1 },
      { id: 'gone', createdTime: T2 },
    ])
    const { engine } = setup({ drive })
    await engine.syncNow()
    expect(drive.deleteSyncFile).not.toHaveBeenCalled()
    expect(engine.getStatus().state).toBe('synced')
  })

  for (const [label, text, code] of [
    ['not JSON', '{oops', 'format'],
    ['another format', JSON.stringify({ format: 'x', version: 1 }), 'unsupportedVersion'],
    ['a newer version', JSON.stringify({ format: SYNC_FORMAT, version: 2 }), 'unsupportedVersion'],
  ]) {
    it(`stops without uploading or writing when a file is ${label}`, async () => {
      const drive = fakeDrive([
        { id: 'good', createdTime: T1, text: fileText(snapshot()) },
        { id: 'bad', createdTime: T2, text },
      ])
      const { engine, store } = setup({ drive, store: fakeStore(snapshot({ entries: [entry('a')] })) })
      await engine.syncNow()
      expect(drive.updateSyncFile).not.toHaveBeenCalled()
      expect(drive.createSyncFile).not.toHaveBeenCalled()
      expect(drive.deleteSyncFile).not.toHaveBeenCalled()
      expect(store.applySyncResult).not.toHaveBeenCalled()
      expect(engine.getStatus()).toMatchObject({ state: 'error', code })
      expect(store.storeLastSyncedAt).not.toHaveBeenCalled()
    })
  }

  it('maps Drive errors to their codes', async () => {
    for (const code of ['quota', 'network', 'notFound', 'other']) {
      const drive = fakeDrive()
      drive.listSyncFiles.mockRejectedValueOnce(new DriveError(code))
      const { engine } = setup({ drive })
      await engine.syncNow()
      expect(engine.getStatus()).toMatchObject({ state: 'error', code })
    }
  })

  it('maps a storage failure to other', async () => {
    const store = fakeStore()
    store.readSyncSnapshot.mockRejectedValueOnce(new Error('idb'))
    const { engine } = setup({ store })
    await engine.syncNow()
    expect(engine.getStatus()).toMatchObject({ state: 'error', code: 'other' })
  })

  it('keeps the old last-sync time after a failure', async () => {
    const drive = fakeDrive()
    const { engine } = setup({ drive })
    await engine.syncNow()
    const first = engine.getStatus().lastSyncedAt
    drive.listSyncFiles.mockRejectedValueOnce(new DriveError('network'))
    await engine.syncNow()
    expect(engine.getStatus()).toMatchObject({ state: 'error', lastSyncedAt: first })
  })

  it('reports synced even if the last-sync time cannot be stored', async () => {
    const store = fakeStore()
    store.storeLastSyncedAt.mockRejectedValueOnce(new Error('idb'))
    const { engine } = setup({ store })
    await engine.syncNow()
    expect(engine.getStatus().state).toBe('synced')
  })

  it('shows syncing while it runs', async () => {
    const drive = fakeDrive()
    let release
    drive.listSyncFiles.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([]))),
    )
    const { engine } = setup({ drive })
    const seen = []
    engine.subscribe((s) => seen.push(s.state))
    const done = engine.syncNow()
    await vi.waitFor(() => expect(engine.getStatus().state).toBe('syncing'))
    release()
    await done
    expect(seen).toEqual(['syncing', 'synced'])
  })

  it('passes interactive to getAccessToken', async () => {
    const { engine, auth } = setup()
    await engine.syncNow({ interactive: true })
    expect(auth.getAccessToken).toHaveBeenCalledWith({ interactive: true })
    await engine.syncNow()
    expect(auth.getAccessToken).toHaveBeenLastCalledWith({ interactive: false })
  })
})

describe('auth', () => {
  it('does nothing when signed out', async () => {
    const { engine, auth, drive, store } = setup({ auth: fakeAuth('signedOut') })
    await engine.syncNow()
    expect(auth.getAccessToken).not.toHaveBeenCalled()
    expect(drive.listSyncFiles).not.toHaveBeenCalled()
    expect(store.readSyncSnapshot).not.toHaveBeenCalled()
    expect(engine.getStatus()).toMatchObject({ signedIn: false, state: 'idle', code: null })
  })

  it('reports needsLogin when no token can be obtained', async () => {
    const auth = fakeAuth('signedIn')
    auth.getAccessToken.mockResolvedValueOnce({ status: 'needsLogin' })
    const { engine, drive } = setup({ auth })
    await engine.syncNow()
    expect(drive.listSyncFiles).not.toHaveBeenCalled()
    expect(engine.getStatus()).toMatchObject({ signedIn: true, state: 'error', code: 'needsLogin' })
  })

  it('becomes idle when getAccessToken says signed out', async () => {
    const auth = fakeAuth('signedIn')
    auth.getAccessToken.mockResolvedValueOnce({ status: 'signedOut' })
    const { engine } = setup({ auth })
    await engine.syncNow()
    expect(engine.getStatus()).toMatchObject({ signedIn: false, state: 'idle' })
  })

  it('drops a rejected token, renews it once and finishes the sync', async () => {
    const drive = fakeDrive()
    drive.listSyncFiles.mockRejectedValueOnce(new DriveError('auth'))
    const { engine, auth, store } = setup({ drive })
    await engine.syncNow()
    expect(store.invalidateGoogleToken).toHaveBeenCalledWith({ token: TOKEN, needsLogin: false })
    expect(auth.getAccessToken).toHaveBeenCalledTimes(2)
    expect(drive.listSyncFiles).toHaveBeenCalledTimes(2)
    expect(engine.getStatus().state).toBe('synced')
  })

  it('marks needsLogin when Drive rejects the renewed token too', async () => {
    const drive = fakeDrive()
    drive.listSyncFiles.mockRejectedValue(new DriveError('auth'))
    const { engine, store, auth } = setup({ drive })
    await engine.syncNow()
    expect(store.invalidateGoogleToken).toHaveBeenLastCalledWith({ token: TOKEN, needsLogin: true })
    expect(store.invalidateGoogleToken).toHaveBeenCalledTimes(2)
    expect(engine.getStatus()).toMatchObject({ state: 'error', code: 'needsLogin' })
    expect(drive.updateSyncFile).not.toHaveBeenCalled()

    expect(auth.getAccessToken).toHaveBeenCalledTimes(2)
  })

  it('after a needsLogin set by Drive rejections, 重新登入 counts as a sign-in', async () => {
    const drive = fakeDrive()
    drive.listSyncFiles.mockRejectedValue(new DriveError('auth'))
    const { engine, auth } = setup({ drive })
    await engine.start()
    await vi.waitFor(() => expect(engine.getStatus().code).toBe('needsLogin'))
    drive.listSyncFiles.mockResolvedValue([])
    // Still 'signedIn' as far as googleAuth knows; its 重新登入 emits it again.
    auth.emit('signedIn')
    await vi.waitFor(() => expect(engine.getStatus().state).toBe('synced'))
    engine.stop()
  })

  it('does not report needsLogin when a newer token was stored meanwhile', async () => {
    const drive = fakeDrive()
    drive.listSyncFiles.mockRejectedValue(new DriveError('auth'))
    const store = fakeStore()
    store.invalidateGoogleToken.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const { engine } = setup({ drive, store })
    await engine.syncNow()
    expect(engine.getStatus()).toMatchObject({ state: 'error', code: 'other' })
  })

  describe('sign-out while a sync runs writes nothing more', () => {
    // Pauses the sync after Drive was read and the local snapshot taken,
    // i.e. right before the writes.
    function pausedBeforeWrites({ files, local }) {
      const drive = fakeDrive(files)
      const store = fakeStore(local)
      let release
      const paused = new Promise((resolve) => {
        store.readSyncSnapshot.mockImplementationOnce(async () => {
          await new Promise((r) => {
            release = r
            resolve()
          })
          return store.local
        })
      })
      return { drive, store, paused, release: () => release() }
    }

    const files = [
      { id: 'old', createdTime: T1, text: fileText(snapshot({ entries: [entry('remote')] })) },
      { id: 'dup', createdTime: T2, text: fileText(snapshot()) },
    ]

    it('in this tab: no local write, no upload, no delete; idle', async () => {
      const ctx = pausedBeforeWrites({ files, local: snapshot({ entries: [entry('local')] }) })
      const { engine, auth } = setup({ drive: ctx.drive, store: ctx.store })
      await engine.start()
      await ctx.paused
      auth.emit('signedOut')
      ctx.release()
      await engine.syncNow()
      expect(ctx.store.applySyncResult).not.toHaveBeenCalled()
      expect(ctx.drive.updateSyncFile).not.toHaveBeenCalled()
      expect(ctx.drive.createSyncFile).not.toHaveBeenCalled()
      expect(ctx.drive.deleteSyncFile).not.toHaveBeenCalled()
      expect(ctx.store.storeLastSyncedAt).not.toHaveBeenCalled()
      expect(engine.getStatus()).toMatchObject({ signedIn: false, state: 'idle', code: null })
      engine.stop()
    })

    it('in another tab (only visible in storage): same', async () => {
      const ctx = pausedBeforeWrites({ files: [], local: snapshot({ entries: [entry('local')] }) })
      const { engine, auth } = setup({ drive: ctx.drive, store: ctx.store })
      const done = engine.syncNow()
      await ctx.paused
      auth.status = 'signedOut' // no event in this tab
      ctx.release()
      await done
      expect(ctx.drive.createSyncFile).not.toHaveBeenCalled()
      expect(engine.getStatus()).toMatchObject({ signedIn: false, state: 'idle' })
    })

    it('between the upload and deleting duplicates: no delete', async () => {
      const drive = fakeDrive(files)
      const { engine, auth } = setup({ drive })
      drive.updateSyncFile.mockImplementationOnce(async () => {
        auth.status = 'signedOut'
      })
      await engine.syncNow()
      expect(drive.updateSyncFile).toHaveBeenCalledTimes(1)
      expect(drive.deleteSyncFile).not.toHaveBeenCalled()
      expect(engine.getStatus()).toMatchObject({ signedIn: false, state: 'idle' })
    })
  })

  it('a sign-out during a sync leaves the status signed out', async () => {
    const drive = fakeDrive()
    let release
    drive.listSyncFiles.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([]))),
    )
    const { engine, auth } = setup({ drive })
    await engine.start()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    auth.emit('signedOut')
    release()
    await engine.syncNow()
    expect(drive.createSyncFile).not.toHaveBeenCalled()
    expect(engine.getStatus()).toMatchObject({ signedIn: false, state: 'idle' })
    engine.stop()
  })
})

describe('offline', () => {
  it('makes no request and reports offline', async () => {
    const { engine, auth, drive } = setup({ online: false })
    await engine.syncNow()
    expect(auth.getAccessToken).not.toHaveBeenCalled()
    expect(drive.listSyncFiles).not.toHaveBeenCalled()
    expect(engine.getStatus()).toMatchObject({ signedIn: true, state: 'error', code: 'offline' })
  })

  it('syncs when the browser comes back online', async () => {
    const { engine, drive, env, win } = setup({ online: false })
    await engine.start()
    await vi.waitFor(() => expect(engine.getStatus().code).toBe('offline'))
    env.online = true
    win.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(engine.getStatus().state).toBe('synced'))
    expect(drive.listSyncFiles).toHaveBeenCalledTimes(1)
    engine.stop()
  })

  it('ignores online while signed out', async () => {
    const { engine, auth, win } = setup({ auth: fakeAuth('signedOut') })
    await engine.start()
    win.dispatchEvent(new Event('online'))
    await Promise.resolve()
    expect(auth.getAccessToken).not.toHaveBeenCalled()
    engine.stop()
  })
})

describe('serialisation', () => {
  it('runs one sync at a time and one follow-up for requests made meanwhile', async () => {
    const drive = fakeDrive()
    let release
    drive.listSyncFiles.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([]))),
    )
    const { engine } = setup({ drive })
    const first = engine.syncNow()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const second = engine.syncNow()
    const third = engine.syncNow({ interactive: true })
    expect(drive.listSyncFiles).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([first, second, third])
    expect(drive.listSyncFiles).toHaveBeenCalledTimes(2)
  })

  it('carries interactive into the follow-up sync', async () => {
    const drive = fakeDrive()
    let release
    drive.listSyncFiles.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([]))),
    )
    const { engine, auth } = setup({ drive })
    const first = engine.syncNow()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const second = engine.syncNow({ interactive: true })
    release()
    await Promise.all([first, second])
    expect(auth.getAccessToken.mock.calls.map((c) => c[0])).toEqual([
      { interactive: false },
      { interactive: true },
    ])
  })

  it('a new request after a sync finished starts a new sync', async () => {
    const { engine, drive } = setup()
    await engine.syncNow()
    await engine.syncNow()
    expect(drive.listSyncFiles).toHaveBeenCalledTimes(2)
  })

  it('holds the cross-tab lock while syncing when navigator.locks exists', async () => {
    let held = false
    const order = []
    const locks = {
      request: vi.fn(async (name, callback) => {
        held = true
        order.push(`lock:${name}`)
        try {
          return await callback()
        } finally {
          held = false
        }
      }),
    }
    const drive = fakeDrive()
    drive.listSyncFiles.mockImplementation(async () => {
      order.push(`list:${held}`)
      return []
    })
    const { engine } = setup({ drive, locks })
    await engine.syncNow()
    expect(locks.request).toHaveBeenCalledWith(SYNC_LOCK_NAME, expect.any(Function))
    expect(order).toEqual(['lock:nikki-ai-sync', 'list:true'])
    expect(engine.getStatus().state).toBe('synced')
  })

  it('reports other when the lock request fails', async () => {
    const locks = { request: vi.fn().mockRejectedValue(new Error('lock')) }
    const { engine } = setup({ locks })
    await engine.syncNow()
    expect(engine.getStatus()).toMatchObject({ state: 'error', code: 'other' })
  })
})

describe('triggers', () => {
  it('syncs on start when signed in and loads the last sync time', async () => {
    const store = fakeStore()
    store.lastSyncedAt = T1
    const { engine, drive } = setup({ store })
    drive.listSyncFiles.mockImplementationOnce(() => new Promise(() => {}))
    await engine.start()
    expect(engine.getStatus().lastSyncedAt).toBe(T1)
    expect(engine.getStatus().signedIn).toBe(true)
    await vi.waitFor(() => expect(drive.listSyncFiles).toHaveBeenCalledTimes(1))
    engine.stop()
  })

  it('makes no request on start when signed out', async () => {
    const { engine, auth, drive } = setup({ auth: fakeAuth('signedOut') })
    await engine.start()
    await Promise.resolve()
    expect(auth.getAccessToken).not.toHaveBeenCalled()
    expect(drive.listSyncFiles).not.toHaveBeenCalled()
    expect(engine.getStatus()).toMatchObject({ signedIn: false, state: 'idle' })
    engine.stop()
  })

  it('start is idempotent', async () => {
    const { engine, auth } = setup({ auth: fakeAuth('signedOut') })
    await Promise.all([engine.start(), engine.start()])
    expect(auth.onStatusChange).toHaveBeenCalledTimes(1)
    engine.stop()
  })

  it('syncs right after a sign-in, but not after a silent token renewal', async () => {
    const auth = fakeAuth('signedOut')
    const { engine, drive } = setup({ auth })
    await engine.start()
    auth.emit('signedIn')
    await vi.waitFor(() => expect(engine.getStatus().state).toBe('synced'))
    expect(drive.listSyncFiles).toHaveBeenCalledTimes(1)
    auth.emit('signedIn')
    await Promise.resolve()
    await engine.syncNow() // flush
    expect(drive.listSyncFiles).toHaveBeenCalledTimes(2)
    engine.stop()
  })

  it('syncs after 重新登入 (needsLogin -> signedIn)', async () => {
    const auth = fakeAuth('needsLogin')
    const { engine } = setup({ auth })
    await engine.start()
    await vi.waitFor(() => expect(engine.getStatus().code).toBe('needsLogin'))
    auth.emit('signedIn')
    await vi.waitFor(() => expect(engine.getStatus().state).toBe('synced'))
    engine.stop()
  })

  it('a sign-out goes idle and stops pending change syncs', async () => {
    vi.useFakeTimers()
    const { engine, auth, store, drive } = setup()
    await engine.start()
    await vi.waitFor(() => expect(engine.getStatus().state).toBe('synced'))
    store.emitChange()
    auth.emit('signedOut')
    expect(engine.getStatus()).toMatchObject({ signedIn: false, state: 'idle', code: null })
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS * 2)
    expect(drive.listSyncFiles).toHaveBeenCalledTimes(1)
    engine.stop()
  })

  it('debounces data changes into one sync about 2 s after the last one', async () => {
    vi.useFakeTimers()
    const { engine, store, drive } = setup()
    await engine.start()
    await vi.waitFor(() => expect(engine.getStatus().state).toBe('synced'))
    expect(drive.listSyncFiles).toHaveBeenCalledTimes(1)

    store.emitChange()
    await vi.advanceTimersByTimeAsync(1500)
    store.emitChange()
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS - 1)
    expect(drive.listSyncFiles).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(drive.listSyncFiles).toHaveBeenCalledTimes(2)
    engine.stop()
  })

  it('ignores data changes while signed out', async () => {
    vi.useFakeTimers()
    const { engine, store, auth } = setup({ auth: fakeAuth('signedOut') })
    await engine.start()
    store.emitChange()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS)
    expect(auth.getAccessToken).not.toHaveBeenCalled()
    engine.stop()
  })

  it('a change during a sync leads to one more sync after it', async () => {
    vi.useFakeTimers()
    const drive = fakeDrive()
    const { engine, store } = setup({ drive })
    let release
    drive.listSyncFiles.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([]))),
    )
    await engine.start()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    store.emitChange()
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS)
    release()
    await vi.waitFor(() => expect(drive.listSyncFiles).toHaveBeenCalledTimes(2))
    engine.stop()
  })

  it('stop removes every listener', async () => {
    vi.useFakeTimers()
    const { engine, store, win, drive, auth } = setup()
    await engine.start()
    await vi.waitFor(() => expect(engine.getStatus().state).toBe('synced'))
    engine.stop()
    store.emitChange()
    win.dispatchEvent(new Event('online'))
    auth.emit('signedOut')
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS)
    expect(drive.listSyncFiles).toHaveBeenCalledTimes(1)
    expect(engine.getStatus().signedIn).toBe(true)
  })
})

describe('status store', () => {
  it('starts idle and signed out', () => {
    const { engine } = setup()
    expect(engine.getStatus()).toEqual({ signedIn: false, state: 'idle', code: null, lastSyncedAt: '' })
  })

  it('notifies subscribers with a new frozen object and supports unsubscribe', async () => {
    const { engine } = setup()
    const listener = vi.fn()
    const unsubscribe = engine.subscribe(listener)
    const before = engine.getStatus()
    await engine.syncNow()
    expect(listener).toHaveBeenCalled()
    const after = engine.getStatus()
    expect(after).not.toBe(before)
    expect(Object.isFrozen(after)).toBe(true)
    unsubscribe()
    listener.mockClear()
    await engine.syncNow()
    expect(listener).not.toHaveBeenCalled()
  })

  it('a throwing subscriber does not break the sync', async () => {
    const { engine } = setup()
    engine.subscribe(() => {
      throw new Error('boom')
    })
    await engine.syncNow()
    expect(engine.getStatus().state).toBe('synced')
  })
})

describe('privacy', () => {
  it('never logs and never puts the token or data in the status', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((n) => vi.spyOn(console, n))
    const secret = snapshot({ settings: { geminiApiKey: { value: 'AIza-secret', updatedAt: T1 } } })
    const drive = fakeDrive([{ id: 'bad', createdTime: T1, text: '{bad' }])
    const { engine } = setup({ drive, store: fakeStore(secret) })
    await engine.syncNow()
    const { engine: other } = setup({ store: fakeStore(secret) })
    await other.syncNow()
    for (const status of [engine.getStatus(), other.getStatus()]) {
      const text = JSON.stringify(status)
      expect(text).not.toContain(TOKEN)
      expect(text).not.toContain('AIza-secret')
    }
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    }
  })
})
