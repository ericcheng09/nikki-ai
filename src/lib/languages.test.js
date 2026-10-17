import {
  AUTO_LANGUAGE,
  BUILT_IN_LANGUAGES,
  OTHER_OPTION_VALUE,
  activeLanguageNames,
  addLanguage,
  isCustomLanguage,
  languageOptions,
  removeLanguage,
  resolveLanguageInput,
} from './languages.js'

const T0 = '2026-10-01T00:00:00.000Z'
const NOW = new Date('2026-10-18T12:34:56.789Z')
const NOW_ISO = NOW.toISOString()

function active(name, updatedAt = T0) {
  return { name, updatedAt, deleted: false, deletedAt: null }
}

function deleted(name, at = T0) {
  return { name, updatedAt: at, deleted: true, deletedAt: at }
}

// Deep-frozen input proves the functions never mutate their arguments.
function frozen(list) {
  return Object.freeze(list.map((item) => Object.freeze({ ...item })))
}

describe('constants', () => {
  it('exposes auto and the two built-in languages', () => {
    expect(AUTO_LANGUAGE).toBe('auto')
    expect(BUILT_IN_LANGUAGES).toEqual(['日文', '英文'])
  })

  it('uses an 其他 option value that can never be a language', () => {
    // Blank text is never a valid language, so it cannot clash.
    expect(resolveLanguageInput(OTHER_OPTION_VALUE)).toBeNull()
  })
})

describe('resolveLanguageInput', () => {
  it('returns the trimmed text as a custom language', () => {
    expect(resolveLanguageInput('  韓文 \n')).toEqual({ language: '韓文', isCustom: true })
  })

  it('treats blank input as invalid', () => {
    expect(resolveLanguageInput('')).toBeNull()
    expect(resolveLanguageInput(' \t　\n')).toBeNull()
    expect(resolveLanguageInput(undefined)).toBeNull()
    expect(resolveLanguageInput(null)).toBeNull()
    expect(resolveLanguageInput(42)).toBeNull()
  })

  it('maps exactly 日文 / 英文 to the built-in option', () => {
    expect(resolveLanguageInput(' 日文 ')).toEqual({ language: '日文', isCustom: false })
    expect(resolveLanguageInput('英文')).toEqual({ language: '英文', isCustom: false })
  })

  it('maps auto and 自動判斷 to AUTO', () => {
    expect(resolveLanguageInput('auto')).toEqual({ language: 'auto', isCustom: false })
    expect(resolveLanguageInput(' 自動判斷 ')).toEqual({ language: 'auto', isCustom: false })
  })

  it('is case-sensitive and exact for the reserved words', () => {
    expect(resolveLanguageInput('Auto')).toEqual({ language: 'Auto', isCustom: true })
    expect(resolveLanguageInput('日文 2')).toEqual({ language: '日文 2', isCustom: true })
  })
})

describe('isCustomLanguage', () => {
  it('is true for any non-reserved, non-blank name', () => {
    expect(isCustomLanguage('韓文')).toBe(true)
    expect(isCustomLanguage(' French ')).toBe(true)
  })

  it('is false for auto, built-ins, blank and non-strings', () => {
    for (const value of ['auto', '自動判斷', '日文', ' 英文 ', '', '  ', null, undefined, 1]) {
      expect(isCustomLanguage(value)).toBe(false)
    }
  })
})

describe('addLanguage', () => {
  it('appends a new language with timestamps from now', () => {
    const list = frozen([active('韓文')])
    expect(addLanguage(list, ' 法文 ', { now: NOW })).toEqual([
      active('韓文'),
      { name: '法文', updatedAt: NOW_ISO, deleted: false, deletedAt: null },
    ])
  })

  it('creates the list from an empty one', () => {
    expect(addLanguage([], 'Deutsch', { now: NOW })).toEqual([active('Deutsch', NOW_ISO)])
  })

  it('leaves an already active language untouched', () => {
    const list = frozen([active('韓文'), active('法文')])
    expect(addLanguage(list, ' 韓文', { now: NOW })).toEqual([active('韓文'), active('法文')])
  })

  it('revives a deleted language in place instead of adding a second one', () => {
    const list = frozen([deleted('韓文'), active('法文')])
    expect(addLanguage(list, '韓文', { now: NOW })).toEqual([
      { name: '韓文', updatedAt: NOW_ISO, deleted: false, deletedAt: null },
      active('法文'),
    ])
  })

  it('treats names case-sensitively', () => {
    const list = frozen([active('French')])
    expect(addLanguage(list, 'french', { now: NOW })).toEqual([
      active('French'),
      active('french', NOW_ISO),
    ])
  })

  it('never adds auto, 自動判斷, built-ins or blank names', () => {
    const list = frozen([active('韓文')])
    for (const name of ['auto', '自動判斷', '日文', ' 英文 ', '', '   ', null]) {
      expect(addLanguage(list, name, { now: NOW })).toEqual([active('韓文')])
    }
  })

  it('returns a new array and does not mutate the input', () => {
    const list = frozen([deleted('韓文')])
    const result = addLanguage(list, '韓文', { now: NOW })
    expect(result).not.toBe(list)
    expect(list[0]).toEqual(deleted('韓文'))
  })

  it('uses the current time by default', () => {
    const before = new Date().toISOString()
    const [item] = addLanguage([], '韓文')
    expect(item.updatedAt >= before).toBe(true)
    expect(item.updatedAt.endsWith('Z')).toBe(true)
  })
})

describe('removeLanguage', () => {
  it('soft-deletes the language with timestamps from now', () => {
    const list = frozen([active('韓文'), active('法文')])
    expect(removeLanguage(list, '法文', { now: NOW })).toEqual([
      active('韓文'),
      { name: '法文', updatedAt: NOW_ISO, deleted: true, deletedAt: NOW_ISO },
    ])
  })

  it('matches the name after trimming', () => {
    const list = frozen([active('韓文')])
    expect(removeLanguage(list, ' 韓文 ', { now: NOW })[0].deleted).toBe(true)
  })

  it('leaves the list unchanged for a missing or already deleted language', () => {
    const list = frozen([active('韓文'), deleted('法文')])
    expect(removeLanguage(list, '德文', { now: NOW })).toEqual([active('韓文'), deleted('法文')])
    expect(removeLanguage(list, '法文', { now: NOW })).toEqual([active('韓文'), deleted('法文')])
    expect(removeLanguage(list, '', { now: NOW })).toEqual([active('韓文'), deleted('法文')])
  })

  it('is case-sensitive', () => {
    const list = frozen([active('French')])
    expect(removeLanguage(list, 'french', { now: NOW })).toEqual([active('French')])
  })

  it('can be revived again by addLanguage, keeping one record', () => {
    const removed = removeLanguage([active('韓文')], '韓文', { now: new Date(T0) })
    const revived = addLanguage(removed, '韓文', { now: NOW })
    expect(revived).toEqual([active('韓文', NOW_ISO)])
  })
})

describe('activeLanguageNames', () => {
  it('returns non-deleted names in list order', () => {
    const list = frozen([active('韓文'), deleted('法文'), active('Deutsch')])
    expect(activeLanguageNames(list)).toEqual(['韓文', 'Deutsch'])
  })

  it('returns an empty array for an empty list', () => {
    expect(activeLanguageNames([])).toEqual([])
  })
})

function labels(options) {
  return options.map((option) => option.label)
}

describe('malformed input', () => {
  const bad = [
    null,
    'x',
    42,
    {},
    { name: '' },
    { name: '   ' },
    { name: 7 },
    active('韓文'),
  ]

  it('treats a non-array list as empty', () => {
    for (const value of [undefined, null, 'x', 42, {}]) {
      expect(activeLanguageNames(value)).toEqual([])
      expect(addLanguage(value, '韓文', { now: NOW })).toEqual([active('韓文', NOW_ISO)])
      expect(removeLanguage(value, '韓文', { now: NOW })).toEqual([])
      expect(languageOptions(value, 'auto').map((o) => o.label)).toEqual([
        '自動判斷',
        '日文',
        '英文',
        '其他',
      ])
    }
  })

  it('skips bad items without throwing', () => {
    expect(activeLanguageNames(bad)).toEqual(['韓文'])
    expect(addLanguage(bad, '法文', { now: NOW })).toEqual([
      active('韓文'),
      active('法文', NOW_ISO),
    ])
    expect(removeLanguage(bad, '韓文', { now: NOW })).toEqual([
      { name: '韓文', updatedAt: NOW_ISO, deleted: true, deletedAt: NOW_ISO },
    ])
  })

  it('drops stored records whose name is reserved', () => {
    const list = frozen([active('auto'), active(' 自動判斷 '), active('日文'), active('英文'), active('韓文')])
    expect(activeLanguageNames(list)).toEqual(['韓文'])
    expect(addLanguage(list, '法文', { now: NOW })).toEqual([
      active('韓文'),
      active('法文', NOW_ISO),
    ])
    expect(labels(languageOptions(list, 'auto'))).toEqual([
      '自動判斷',
      '日文',
      '英文',
      '韓文',
      '其他',
    ])
  })

  it('returns stored records with their name trimmed', () => {
    const list = frozen([active(' 韓文 '), deleted('\t法文\n')])
    expect(addLanguage(list, 'Deutsch', { now: NOW })).toEqual([
      active('韓文'),
      deleted('法文'),
      active('Deutsch', NOW_ISO),
    ])
    expect(addLanguage(list, '法文', { now: NOW })[1]).toEqual(active('法文', NOW_ISO))
    expect(removeLanguage(list, '韓文', { now: NOW })[0]).toEqual({
      name: '韓文',
      updatedAt: NOW_ISO,
      deleted: true,
      deletedAt: NOW_ISO,
    })
    expect(languageOptions(list, 'auto')[3]).toEqual({
      value: '韓文',
      label: '韓文',
      kind: 'custom',
    })
    // Inputs stay untouched.
    expect(list[0].name).toBe(' 韓文 ')
  })

  it('keeps only the first record when a name appears twice', () => {
    const list = [active('韓文', T0), deleted('韓文', NOW_ISO)]
    expect(activeLanguageNames(list)).toEqual(['韓文'])
    expect(addLanguage(list, '韓文', { now: NOW })).toEqual([active('韓文', T0)])
  })
})

describe('languageOptions', () => {
  it('lists auto, built-ins, active custom languages, then 其他', () => {
    const list = frozen([active('韓文'), deleted('法文'), active('Deutsch')])
    expect(languageOptions(list, 'auto')).toEqual([
      { value: 'auto', label: '自動判斷', kind: 'auto' },
      { value: '日文', label: '日文', kind: 'builtIn' },
      { value: '英文', label: '英文', kind: 'builtIn' },
      { value: '韓文', label: '韓文', kind: 'custom' },
      { value: 'Deutsch', label: 'Deutsch', kind: 'custom' },
      { value: OTHER_OPTION_VALUE, label: '其他', kind: 'other' },
    ])
  })

  it('keeps showing the current language after it was deleted from the list', () => {
    const list = frozen([active('韓文'), deleted('法文')])
    expect(labels(languageOptions(list, '法文'))).toEqual([
      '自動判斷',
      '日文',
      '英文',
      '韓文',
      '法文',
      '其他',
    ])
    expect(languageOptions(list, '法文')[4]).toEqual({
      value: '法文',
      label: '法文',
      kind: 'custom',
    })
  })

  it('shows a current custom language that was never listed', () => {
    expect(labels(languageOptions([], '泰文'))).toEqual(['自動判斷', '日文', '英文', '泰文', '其他'])
  })

  it('does not duplicate a current language that is active or built-in', () => {
    const list = frozen([active('韓文')])
    expect(labels(languageOptions(list, '韓文'))).toEqual(['自動判斷', '日文', '英文', '韓文', '其他'])
    expect(labels(languageOptions(list, '日文'))).toEqual(['自動判斷', '日文', '英文', '韓文', '其他'])
  })

  it('ignores a missing or blank current language', () => {
    for (const current of [undefined, null, '', '  ']) {
      expect(labels(languageOptions([], current))).toEqual(['自動判斷', '日文', '英文', '其他'])
    }
  })
})
