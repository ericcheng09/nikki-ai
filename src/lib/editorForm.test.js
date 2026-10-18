import { entryLanguage, formLanguage, hasUnsavedChanges } from './editorForm.js'
import { OTHER_OPTION_VALUE } from './languages.js'

const saved = { date: '2026-10-15', content: 'Hello', language: '英文' }
const form = (overrides = {}) => ({
  date: saved.date,
  content: saved.content,
  language: '英文',
  otherLanguage: '',
  ...overrides,
})

describe('entryLanguage', () => {
  it('returns the stored language', () => {
    expect(entryLanguage({ language: '韓文' })).toBe('韓文')
    expect(entryLanguage({ language: '日文' })).toBe('日文')
  })

  it.each([[undefined], [null], [42], [''], ['   ']])(
    'treats a missing or invalid language (%j) as auto',
    (language) => {
      expect(entryLanguage({ language })).toBe('auto')
    },
  )

  it('treats a missing entry as auto', () => {
    expect(entryLanguage(undefined)).toBe('auto')
  })
})

describe('formLanguage', () => {
  it('returns the select value unless 其他 is chosen', () => {
    expect(formLanguage('日文', 'ignored')).toBe('日文')
    expect(formLanguage('auto', '')).toBe('auto')
  })

  it('resolves the typed name for 其他', () => {
    expect(formLanguage(OTHER_OPTION_VALUE, '  韓文 ')).toBe('韓文')
    expect(formLanguage(OTHER_OPTION_VALUE, '英文')).toBe('英文')
    expect(formLanguage(OTHER_OPTION_VALUE, '自動判斷')).toBe('auto')
  })

  it('returns null for a blank 其他', () => {
    expect(formLanguage(OTHER_OPTION_VALUE, '')).toBeNull()
    expect(formLanguage(OTHER_OPTION_VALUE, '  \n')).toBeNull()
  })
})

describe('hasUnsavedChanges', () => {
  it('is false when the form matches the saved version', () => {
    expect(hasUnsavedChanges(saved, form())).toBe(false)
  })

  it.each([
    ['date', { date: '2026-10-16' }],
    ['content', { content: 'Hello!' }],
    ['language', { language: '日文' }],
    ['blank 其他', { language: OTHER_OPTION_VALUE, otherLanguage: ' ' }],
    ['other name in 其他', { language: OTHER_OPTION_VALUE, otherLanguage: '韓文' }],
  ])('is true after a %s change', (_label, overrides) => {
    expect(hasUnsavedChanges(saved, form(overrides))).toBe(true)
  })

  it('treats typing the saved language into 其他 as unchanged', () => {
    expect(
      hasUnsavedChanges(saved, form({ language: OTHER_OPTION_VALUE, otherLanguage: ' 英文 ' })),
    ).toBe(false)
  })

  it('compares an invalid stored language as auto', () => {
    expect(hasUnsavedChanges({ ...saved, language: undefined }, form({ language: 'auto' }))).toBe(
      false,
    )
  })

  it('is false without a saved version (new entry)', () => {
    expect(hasUnsavedChanges(undefined, form({ content: 'anything' }))).toBe(false)
  })
})
