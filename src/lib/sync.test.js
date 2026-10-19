import {
  PURGE_AFTER_MS,
  SYNC_FORMAT,
  SYNC_VERSION,
  buildSyncFile,
  canonicalJson,
  mergeSync,
  parseSyncFile,
  purgeExpiredTombstones,
} from './sync.js'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-19T00:00:00.000Z')
const T1 = '2026-10-01T00:00:00.000Z'
const T2 = '2026-10-02T00:00:00.000Z'
const T3 = '2026-10-03T00:00:00.000Z'

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

function tombstone(id, at = T1) {
  return { id, updatedAt: at, deleted: true, deletedAt: at }
}

function lang(name, updatedAt = T1) {
  return { name, updatedAt, deleted: false, deletedAt: null }
}

function deletedLang(name, at = T1) {
  return { name, updatedAt: at, deleted: true, deletedAt: at }
}

function setting(value, updatedAt = T1) {
  return { value, updatedAt }
}

function snapshot({ entries = [], customLanguages = [], settings = {} } = {}) {
  return { entries, customLanguages, settings }
}

// Recursively frozen copy: any mutation attempt throws in strict mode.
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

// Order-insensitive view of the merged data, used to compare results.
function byKey(data) {
  return {
    entries: Object.fromEntries(data.entries.map((e) => [e.id, e])),
    customLanguages: Object.fromEntries(data.customLanguages.map((l) => [l.name, l])),
    settings: data.settings,
  }
}

function merge(local, remote) {
  return mergeSync(local, remote, { now: NOW })
}

describe('constants', () => {
  it('uses the agreed file format, version 1 and a 90-day window', () => {
    expect(SYNC_FORMAT).toBe('nikki-ai-sync')
    expect(SYNC_VERSION).toBe(1)
    expect(PURGE_AFTER_MS).toBe(90 * DAY)
  })
})

describe('canonicalJson', () => {
  it('ignores object key order', () => {
    expect(canonicalJson({ a: 1, b: { c: 2, d: 3 } })).toBe(
      canonicalJson({ b: { d: 3, c: 2 }, a: 1 }),
    )
  })

  it('keeps array order and drops undefined like JSON.stringify', () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]))
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}')
  })
})

describe('buildSyncFile', () => {
  it('wraps the local snapshot in the versioned file format', () => {
    const local = snapshot({
      entries: [entry('a')],
      customLanguages: [lang('韓文')],
      settings: { geminiApiKey: setting('key'), geminiModel: setting('models/x') },
    })
    expect(buildSyncFile(local)).toEqual({
      format: 'nikki-ai-sync',
      version: 1,
      entries: [entry('a')],
      customLanguages: [lang('韓文')],
      settings: { geminiApiKey: setting('key'), geminiModel: setting('models/x') },
    })
  })

  it('round-trips through JSON and parseSyncFile', () => {
    const local = snapshot({
      entries: [entry('a'), tombstone('b')],
      customLanguages: [lang('韓文'), deletedLang('法文')],
      settings: { geminiApiKey: setting('') },
    })
    const result = parseSyncFile(JSON.stringify(buildSyncFile(local)))
    expect(result).toEqual({ ok: true, data: local })
  })

  it('drops malformed records, reserved languages and unknown settings', () => {
    const local = snapshot({
      entries: [entry('a'), { id: '', updatedAt: T1 }, { id: 'x', updatedAt: 'nope' }, null],
      customLanguages: [lang(' 韓文 '), lang('日文'), lang('auto'), lang('自動判斷'), { name: '法文' }],
      settings: { geminiApiKey: setting('key'), welcomeSeen: setting('true'), geminiModel: 5 },
    })
    const file = buildSyncFile(local)
    expect(file.entries).toEqual([entry('a')])
    expect(file.customLanguages).toEqual([lang('韓文')])
    expect(file.settings).toEqual({ geminiApiKey: setting('key') })
  })

  it('treats a missing or broken snapshot as empty', () => {
    expect(buildSyncFile(undefined)).toEqual({
      format: 'nikki-ai-sync',
      version: 1,
      entries: [],
      customLanguages: [],
      settings: {},
    })
    expect(buildSyncFile({ entries: 'x', customLanguages: {}, settings: [] }).entries).toEqual([])
  })

  it('does not mutate its input', () => {
    const local = deepFreeze(snapshot({ entries: [entry('a')], customLanguages: [lang(' 韓文 ')] }))
    expect(() => buildSyncFile(local)).not.toThrow()
    expect(local.customLanguages[0].name).toBe(' 韓文 ')
  })
})

describe('parseSyncFile', () => {
  const valid = () => buildSyncFile(snapshot({ entries: [entry('a')] }))

  it('accepts a JSON string or an already parsed object', () => {
    expect(parseSyncFile(JSON.stringify(valid())).ok).toBe(true)
    expect(parseSyncFile(valid())).toEqual({
      ok: true,
      data: snapshot({ entries: [entry('a')] }),
    })
  })

  it.each([
    ['invalid JSON', '{not json'],
    ['empty string', ''],
    ['null', 'null'],
    ['an array', '[]'],
    ['a number', 42],
    ['undefined', undefined],
    ['missing format', { version: 1, entries: [], customLanguages: [], settings: {} }],
    ['missing version', { format: 'nikki-ai-sync', entries: [], customLanguages: [], settings: {} }],
    ['entries not an array', { ...valid(), entries: {} }],
    ['customLanguages missing', { ...valid(), customLanguages: undefined }],
    ['settings not an object', { ...valid(), settings: [] }],
  ])('rejects %s as a format error', (_label, input) => {
    expect(parseSyncFile(input)).toEqual({ ok: false, error: 'format' })
  })

  it.each([
    ['another format', { ...valid(), format: 'other-app' }],
    ['a newer version', { ...valid(), version: 2 }],
    ['an older version', { ...valid(), version: 0 }],
  ])('rejects %s as unsupportedVersion', (_label, input) => {
    expect(parseSyncFile(input)).toEqual({ ok: false, error: 'unsupportedVersion' })
  })

  it('skips malformed records but keeps the valid ones', () => {
    const file = {
      ...valid(),
      entries: [entry('a'), { id: 7, updatedAt: T1 }, { id: 'b' }, 'x', tombstone('c')],
      customLanguages: [lang('韓文'), { name: '', updatedAt: T1 }, { name: '法文', updatedAt: 'bad' }],
      settings: { geminiApiKey: { value: 3, updatedAt: T1 }, geminiModel: setting('m', 'bad') },
    }
    expect(parseSyncFile(file)).toEqual({
      ok: true,
      data: snapshot({
        entries: [entry('a'), tombstone('c')],
        customLanguages: [lang('韓文')],
        settings: {},
      }),
    })
  })

  it('keeps unknown extra fields of valid records', () => {
    const file = {
      ...valid(),
      entries: [entry('a', T1, { mood: 'happy' })],
      customLanguages: [{ ...lang('韓文'), color: 'red' }],
    }
    const { data } = parseSyncFile(file)
    expect(data.entries[0].mood).toBe('happy')
    expect(data.customLanguages[0].color).toBe('red')
  })

  it('returns copies, not the objects it was given', () => {
    const file = valid()
    const { data } = parseSyncFile(file)
    expect(data.entries[0]).not.toBe(file.entries[0])
  })
})

describe('purgeExpiredTombstones', () => {
  it('keeps a tombstone deleted exactly 90 days ago', () => {
    const at = new Date(NOW.getTime() - 90 * DAY).toISOString()
    expect(purgeExpiredTombstones([tombstone('a', at)], NOW)).toEqual([tombstone('a', at)])
  })

  it('removes a tombstone deleted 90 days + 1 ms ago', () => {
    const at = new Date(NOW.getTime() - 90 * DAY - 1).toISOString()
    expect(purgeExpiredTombstones([tombstone('a', at)], NOW)).toEqual([])
  })

  it('works for language tombstones too', () => {
    const old = new Date(NOW.getTime() - 100 * DAY).toISOString()
    expect(purgeExpiredTombstones([deletedLang('韓文', old), lang('法文', old)], NOW)).toEqual([
      lang('法文', old),
    ])
  })

  it('never removes live records, however old', () => {
    const old = '2000-01-01T00:00:00.000Z'
    expect(purgeExpiredTombstones([entry('a', old)], NOW)).toEqual([entry('a', old)])
  })

  it('keeps tombstones whose deletedAt cannot be parsed', () => {
    const list = [
      { id: 'a', updatedAt: T1, deleted: true, deletedAt: 'garbage' },
      { id: 'b', updatedAt: T1, deleted: true, deletedAt: null },
      { id: 'c', updatedAt: T1, deleted: true },
    ]
    expect(purgeExpiredTombstones(list, NOW)).toEqual(list)
  })

  it('purges nothing when now is an Invalid Date', () => {
    const list = [tombstone('a', '2000-01-01T00:00:00.000Z'), entry('b')]
    expect(purgeExpiredTombstones(list, new Date('nope'))).toEqual(list)
  })

  it('does not mutate its input', () => {
    const list = deepFreeze([tombstone('a', '2000-01-01T00:00:00.000Z'), entry('b')])
    expect(purgeExpiredTombstones(list, NOW)).toEqual([entry('b')])
    expect(list).toHaveLength(2)
  })
})

describe('mergeSync: entries', () => {
  it('keeps every entry from both sides', () => {
    const { merged } = merge(
      snapshot({ entries: [entry('a'), entry('b')] }),
      snapshot({ entries: [entry('c')] }),
    )
    expect(merged.entries.map((e) => e.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('takes the newer remote version of the same entry', () => {
    const newer = entry('a', T2, { content: 'remote' })
    const { merged } = merge(snapshot({ entries: [entry('a', T1)] }), snapshot({ entries: [newer] }))
    expect(merged.entries).toEqual([newer])
  })

  it('keeps the newer local version of the same entry', () => {
    const newer = entry('a', T2, { content: 'local' })
    const { merged } = merge(snapshot({ entries: [newer] }), snapshot({ entries: [entry('a', T1)] }))
    expect(merged.entries).toEqual([newer])
  })

  it('compares times as instants, not as strings', () => {
    // 08:00+08:00 is 00:00Z: larger as a string, but 30 minutes earlier.
    const offset = entry('a', '2026-10-01T08:00:00.000+08:00', { content: 'offset' })
    const plain = entry('a', '2026-10-01T00:30:00.000Z', { content: 'plain' })
    expect(merge(snapshot({ entries: [offset] }), snapshot({ entries: [plain] })).merged.entries)
      .toEqual([plain])
  })

  it('propagates a newer deletion', () => {
    const { merged } = merge(
      snapshot({ entries: [entry('a', T1)] }),
      snapshot({ entries: [tombstone('a', T2)] }),
    )
    expect(merged.entries).toEqual([tombstone('a', T2)])
  })

  it('does not resurrect a deleted entry from an older copy', () => {
    const { merged } = merge(
      snapshot({ entries: [tombstone('a', T2)] }),
      snapshot({ entries: [entry('a', T1)] }),
    )
    expect(merged.entries).toEqual([tombstone('a', T2)])
  })

  it('lets an edit made after the deletion win (last action wins)', () => {
    const edited = entry('a', T3)
    const { merged } = merge(snapshot({ entries: [tombstone('a', T2)] }), snapshot({ entries: [edited] }))
    expect(merged.entries).toEqual([edited])
  })

  it('prefers the deletion on a tie, from either side', () => {
    const live = entry('a', T2)
    const dead = tombstone('a', T2)
    expect(merge(snapshot({ entries: [live] }), snapshot({ entries: [dead] })).merged.entries)
      .toEqual([dead])
    expect(merge(snapshot({ entries: [dead] }), snapshot({ entries: [live] })).merged.entries)
      .toEqual([dead])
  })

  it('breaks other ties by the larger canonical JSON, from either side', () => {
    const x = entry('a', T2, { content: 'aaa' })
    const y = entry('a', T2, { content: 'zzz' })
    expect(merge(snapshot({ entries: [x] }), snapshot({ entries: [y] })).merged.entries).toEqual([y])
    expect(merge(snapshot({ entries: [y] }), snapshot({ entries: [x] })).merged.entries).toEqual([y])
  })

  it('skips a tombstone with an unparseable updatedAt, so the live copy wins', () => {
    const broken = { id: 'a', updatedAt: 'garbage', deleted: true, deletedAt: T3 }
    const { merged } = merge(snapshot({ entries: [entry('a', T1)] }), snapshot({ entries: [broken] }))
    expect(merged.entries).toEqual([entry('a', T1)])
  })

  it('resolves duplicate ids within one side with the same rules', () => {
    const { merged } = merge(
      snapshot({ entries: [entry('a', T2, { content: 'new' }), entry('a', T1)] }),
      snapshot(),
    )
    expect(merged.entries).toEqual([entry('a', T2, { content: 'new' })])
  })

  it('keeps unknown extra fields on the winning record', () => {
    const remote = entry('a', T2, { mood: 'happy' })
    const { merged } = merge(snapshot({ entries: [entry('a', T1)] }), snapshot({ entries: [remote] }))
    expect(merged.entries[0].mood).toBe('happy')
  })

  it('keeps local entries first, then remote-only ones', () => {
    const { merged } = merge(
      snapshot({ entries: [entry('b'), entry('a')] }),
      snapshot({ entries: [entry('c'), entry('a')] }),
    )
    expect(merged.entries.map((e) => e.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('mergeSync: languages', () => {
  it('keeps every language from both sides', () => {
    const { merged } = merge(
      snapshot({ customLanguages: [lang('韓文')] }),
      snapshot({ customLanguages: [lang('法文')] }),
    )
    expect(merged.customLanguages).toEqual([lang('韓文'), lang('法文')])
  })

  it('matches names after trimming', () => {
    const { merged } = merge(
      snapshot({ customLanguages: [lang(' 韓文 ', T1)] }),
      snapshot({ customLanguages: [deletedLang('韓文', T2)] }),
    )
    expect(merged.customLanguages).toEqual([deletedLang('韓文', T2)])
  })

  it('treats names as case-sensitive', () => {
    const { merged } = merge(
      snapshot({ customLanguages: [lang('Thai')] }),
      snapshot({ customLanguages: [lang('thai')] }),
    )
    expect(merged.customLanguages).toHaveLength(2)
  })

  it('propagates a deletion and does not resurrect it from an older copy', () => {
    const local = snapshot({ customLanguages: [deletedLang('韓文', T2)] })
    const remote = snapshot({ customLanguages: [lang('韓文', T1)] })
    expect(merge(local, remote).merged.customLanguages).toEqual([deletedLang('韓文', T2)])
    expect(merge(remote, local).merged.customLanguages).toEqual([deletedLang('韓文', T2)])
  })

  it('keeps a language re-added after its deletion (last action wins)', () => {
    const local = snapshot({ customLanguages: [deletedLang('韓文', T2)] })
    const remote = snapshot({ customLanguages: [lang('韓文', T3)] })
    expect(merge(local, remote).merged.customLanguages).toEqual([lang('韓文', T3)])
  })

  it('prefers the deletion on a tie', () => {
    const local = snapshot({ customLanguages: [lang('韓文', T2)] })
    const remote = snapshot({ customLanguages: [deletedLang('韓文', T2)] })
    expect(merge(local, remote).merged.customLanguages).toEqual([deletedLang('韓文', T2)])
  })

  it('never syncs reserved names', () => {
    const { merged } = merge(
      snapshot({ customLanguages: [lang('日文')] }),
      snapshot({ customLanguages: [lang('英文'), lang('auto'), lang('自動判斷')] }),
    )
    expect(merged.customLanguages).toEqual([])
  })
})

describe('mergeSync: settings', () => {
  it('takes the newer value per field', () => {
    const { merged } = merge(
      snapshot({ settings: { geminiApiKey: setting('local', T2), geminiModel: setting('m-local', T1) } }),
      snapshot({ settings: { geminiApiKey: setting('remote', T1), geminiModel: setting('m-remote', T2) } }),
    )
    expect(merged.settings).toEqual({
      geminiApiKey: setting('local', T2),
      geminiModel: setting('m-remote', T2),
    })
  })

  it('propagates a newer key deletion (empty value)', () => {
    const { merged } = merge(
      snapshot({ settings: { geminiApiKey: setting('secret', T1) } }),
      snapshot({ settings: { geminiApiKey: setting('', T2) } }),
    )
    expect(merged.settings.geminiApiKey).toEqual(setting('', T2))
  })

  it('treats a missing field as the oldest', () => {
    const { merged } = merge(
      snapshot({ settings: {} }),
      snapshot({ settings: { geminiModel: setting('m', '1970-01-01T00:00:00.000Z') } }),
    )
    expect(merged.settings).toEqual({ geminiModel: setting('m', '1970-01-01T00:00:00.000Z') })
  })

  it('treats an invalid field as missing', () => {
    const { merged } = merge(
      snapshot({ settings: { geminiApiKey: { value: 'x', updatedAt: 'bad' } } }),
      snapshot({ settings: { geminiApiKey: setting('remote', T1) } }),
    )
    expect(merged.settings.geminiApiKey).toEqual(setting('remote', T1))
  })

  it('leaves a field out when neither side has it', () => {
    expect(merge(snapshot(), snapshot()).merged.settings).toEqual({})
  })

  it('prefers the cleared value on a tie, from either side', () => {
    const a = snapshot({ settings: { geminiApiKey: setting('zzz', T2) } })
    const b = snapshot({ settings: { geminiApiKey: setting('', T2) } })
    expect(merge(a, b).merged.settings.geminiApiKey).toEqual(setting('', T2))
    expect(merge(b, a).merged.settings.geminiApiKey).toEqual(setting('', T2))
  })

  it('breaks other ties by the larger canonical JSON', () => {
    const a = snapshot({ settings: { geminiModel: setting('models/a', T2) } })
    const b = snapshot({ settings: { geminiModel: setting('models/b', T2) } })
    expect(merge(a, b).merged.settings.geminiModel).toEqual(setting('models/b', T2))
    expect(merge(b, a).merged.settings.geminiModel).toEqual(setting('models/b', T2))
  })
})

describe('mergeSync: purge', () => {
  it('drops expired tombstones from the merged data on both sides', () => {
    const old = new Date(NOW.getTime() - 91 * DAY).toISOString()
    const { merged, localChanged, remoteChanged } = merge(
      snapshot({ entries: [tombstone('a', old)], customLanguages: [deletedLang('韓文', old)] }),
      snapshot({ entries: [tombstone('a', old)], customLanguages: [deletedLang('韓文', old)] }),
    )
    expect(merged.entries).toEqual([])
    expect(merged.customLanguages).toEqual([])
    expect(localChanged).toBe(true)
    expect(remoteChanged).toBe(true)
  })

  it('keeps tombstones that are still within 90 days', () => {
    const recent = new Date(NOW.getTime() - 90 * DAY).toISOString()
    const { merged } = merge(snapshot({ entries: [tombstone('a', recent)] }), snapshot())
    expect(merged.entries).toEqual([tombstone('a', recent)])
  })

  it('purges nothing when now is an Invalid Date', () => {
    const old = '2000-01-01T00:00:00.000Z'
    const { merged } = mergeSync(snapshot({ entries: [tombstone('a', old)] }), snapshot(), {
      now: new Date(NaN),
    })
    expect(merged.entries).toEqual([tombstone('a', old)])
  })

  it('uses the current time when now is not given', () => {
    const { merged } = mergeSync(
      snapshot({ entries: [tombstone('a', '2000-01-01T00:00:00.000Z')] }),
      snapshot(),
    )
    expect(merged.entries).toEqual([])
  })
})

describe('mergeSync: change flags', () => {
  it('reports no changes when both sides are equal', () => {
    const data = snapshot({
      entries: [entry('a')],
      customLanguages: [lang('韓文')],
      settings: { geminiApiKey: setting('k') },
    })
    expect(merge(data, data)).toMatchObject({ localChanged: false, remoteChanged: false })
  })

  it('ignores record order and key order when comparing', () => {
    const local = snapshot({ entries: [entry('a'), entry('b')] })
    const reordered = { ...entry('b') }
    const remote = snapshot({
      entries: [Object.fromEntries(Object.entries(reordered).reverse()), entry('a')],
    })
    expect(merge(local, remote)).toMatchObject({ localChanged: false, remoteChanged: false })
  })

  it('flags only the remote when local has something new', () => {
    const result = merge(snapshot({ entries: [entry('a'), entry('b')] }), snapshot({ entries: [entry('a')] }))
    expect(result).toMatchObject({ localChanged: false, remoteChanged: true })
  })

  it('flags only local when the remote has something new', () => {
    const result = merge(
      snapshot({ settings: { geminiModel: setting('m', T1) } }),
      snapshot({ settings: { geminiModel: setting('n', T2) } }),
    )
    expect(result).toMatchObject({ localChanged: true, remoteChanged: false })
  })

  it('flags both when each side has something new', () => {
    const result = merge(snapshot({ entries: [entry('a')] }), snapshot({ entries: [entry('b')] }))
    expect(result).toMatchObject({ localChanged: true, remoteChanged: true })
  })

  it('treats a missing remote file as needing an upload', () => {
    const result = merge(snapshot({ entries: [entry('a')] }), null)
    expect(result).toMatchObject({ localChanged: false, remoteChanged: true })
    expect(result.merged.entries).toEqual([entry('a')])
  })

  it('needs an upload even when local is empty and there is no remote file', () => {
    expect(merge(snapshot(), null)).toMatchObject({ localChanged: false, remoteChanged: true })
  })
})

describe('mergeSync: algebraic properties', () => {
  const old = new Date(NOW.getTime() - 120 * DAY).toISOString()
  const a = snapshot({
    entries: [entry('1', T1), entry('2', T3, { content: 'a' }), tombstone('3', T2), tombstone('4', old), entry('5', T2, { content: 'x' })],
    customLanguages: [lang('韓文', T1), deletedLang('法文', T3), lang('泰文', T2)],
    settings: { geminiApiKey: setting('ka', T2), geminiModel: setting('ma', T1) },
  })
  const b = snapshot({
    entries: [entry('1', T2, { content: 'b' }), entry('2', T1), entry('3', T1), entry('6'), tombstone('5', T2)],
    customLanguages: [deletedLang('韓文', T2), lang('法文', T1), lang('德文')],
    settings: { geminiApiKey: setting('kb', T1), geminiModel: setting('', T1) },
  })

  it('is commutative on the merged data', () => {
    expect(byKey(merge(a, b).merged)).toEqual(byKey(merge(b, a).merged))
  })

  it('is idempotent: merging the result with the same remote changes nothing', () => {
    const once = merge(a, b).merged
    const twice = merge(once, b)
    expect(twice.merged).toEqual(once)
    expect(twice.localChanged).toBe(false)
  })

  it('reports nothing to do on the next sync once both sides hold the result', () => {
    const once = merge(a, b).merged
    expect(merge(once, once)).toMatchObject({ localChanged: false, remoteChanged: false })
  })

  it('does not mutate either input', () => {
    const frozenA = deepFreeze(structuredClone(a))
    const frozenB = deepFreeze(structuredClone(b))
    expect(() => merge(frozenA, frozenB)).not.toThrow()
    expect(frozenA).toEqual(a)
    expect(frozenB).toEqual(b)
  })

  it('returns records that are not shared with the inputs', () => {
    const local = snapshot({ entries: [entry('a', T1, { analysis: { translation: 't' } })] })
    const { merged } = merge(local, snapshot())
    expect(merged.entries[0]).not.toBe(local.entries[0])
    expect(merged.entries[0].analysis).not.toBe(local.entries[0].analysis)
  })
})

describe('mergeSync: scenarios requested in testing', () => {
  it('keeps a language re-added locally after a remote deletion and uploads it', () => {
    const result = merge(
      snapshot({ customLanguages: [lang('韓文', T3)] }),
      snapshot({ customLanguages: [deletedLang('韓文', T2)] }),
    )
    expect(result.merged.customLanguages).toEqual([lang('韓文', T3)])
    expect(result).toMatchObject({ localChanged: false, remoteChanged: true })
  })

  it('uploads a newer local API key clear', () => {
    const result = merge(
      snapshot({ settings: { geminiApiKey: setting('', T2) } }),
      snapshot({ settings: { geminiApiKey: setting('secret', T1) } }),
    )
    expect(result.merged.settings.geminiApiKey).toEqual(setting('', T2))
    expect(result).toMatchObject({ localChanged: false, remoteChanged: true })
  })

  it('restores a key set after an older clear', () => {
    const result = merge(
      snapshot({ settings: { geminiApiKey: setting('', T1) } }),
      snapshot({ settings: { geminiApiKey: setting('secret', T2) } }),
    )
    expect(result.merged.settings.geminiApiKey).toEqual(setting('secret', T2))
    expect(result).toMatchObject({ localChanged: true, remoteChanged: false })
  })

  describe('purge through mergeSync', () => {
    const expired = new Date(NOW.getTime() - 90 * DAY - 1).toISOString()
    const boundary = new Date(NOW.getTime() - 90 * DAY).toISOString()

    it('removes an expired tombstone held only locally', () => {
      const result = merge(snapshot({ entries: [tombstone('a', expired)] }), snapshot())
      expect(result.merged.entries).toEqual([])
      expect(result).toMatchObject({ localChanged: true, remoteChanged: false })
    })

    it('removes an expired tombstone held only on Drive', () => {
      const result = merge(snapshot(), snapshot({ customLanguages: [deletedLang('韓文', expired)] }))
      expect(result.merged.customLanguages).toEqual([])
      expect(result).toMatchObject({ localChanged: false, remoteChanged: true })
    })

    it('keeps an exactly-90-day tombstone coming from Drive', () => {
      const result = merge(snapshot(), snapshot({ entries: [tombstone('a', boundary)] }))
      expect(result.merged.entries).toEqual([tombstone('a', boundary)])
      expect(result).toMatchObject({ localChanged: true, remoteChanged: false })
    })

    it('removes an expired tombstone when there is no Drive file', () => {
      const result = merge(snapshot({ entries: [tombstone('a', expired)] }), null)
      expect(result.merged.entries).toEqual([])
      expect(result).toMatchObject({ localChanged: true, remoteChanged: true })
    })
  })

  it('flags only local when a deletion comes from Drive', () => {
    const result = merge(
      snapshot({ entries: [entry('a', T1)] }),
      snapshot({ entries: [tombstone('a', T2)] }),
    )
    expect(result).toMatchObject({ localChanged: true, remoteChanged: false })
  })

  it('flags only Drive when the deletion was made locally', () => {
    const result = merge(
      snapshot({ entries: [tombstone('a', T2)] }),
      snapshot({ entries: [entry('a', T1)] }),
    )
    expect(result).toMatchObject({ localChanged: false, remoteChanged: true })
  })
})
