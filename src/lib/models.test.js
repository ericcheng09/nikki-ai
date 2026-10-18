import { isMainTextModel, modelChoices, shownModels } from './models.js'

const model = (id, displayName = '') => ({ name: `models/${id}`, displayName })

describe('isMainTextModel', () => {
  it.each([
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'gemini-2.0-flash-lite-001',
    'gemini-1.5-pro-002',
    'gemini-3-pro',
    'gemini-3.0-flash',
    'gemini-10.25-flash',
  ])('accepts the stable main text model %s', (id) => {
    expect(isMainTextModel(`models/${id}`)).toBe(true)
  })

  it.each([
    'gemini-2.5-flash-preview-05-20',
    'gemini-2.5-pro-preview-06-05',
    'gemini-2.5-flash-lite-preview-06-17',
    'gemini-3-pro-preview',
    'gemini-2.0-flash-exp',
    'gemini-exp-1206',
    'gemini-2.0-flash-thinking-exp-01-21',
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
    'gemini-pro-latest',
    'gemini-1.5-flash-latest',
    'gemini-2.5-flash-image',
    'gemini-2.5-flash-image-preview',
    'gemini-2.0-flash-preview-image-generation',
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-pro-preview-tts',
    'gemini-2.5-flash-native-audio-dialog',
    'gemini-2.0-flash-live-001',
    'gemini-live-2.5-flash-preview',
    'gemini-1.5-flash-8b',
    'gemini-1.5-flash-8b-001',
    'gemini-2.5-computer-use-preview-10-2025',
    'gemini-robotics-er-1.5-preview',
    'gemini-embedding-001',
    'gemini-2.0-flash-01',
    'gemini-2.0-flash-0001',
    'gemini-pro',
    'gemini-2.5-ultra',
    'gemma-3-27b-it',
    'learnlm-2.0-flash-experimental',
  ])('rejects %s', (id) => {
    expect(isMainTextModel(`models/${id}`)).toBe(false)
  })

  it('needs the models/ prefix and exact case', () => {
    expect(isMainTextModel('gemini-2.5-flash')).toBe(false)
    expect(isMainTextModel('models/Gemini-2.5-Flash')).toBe(false)
    expect(isMainTextModel('models/gemini-2.5-flash ')).toBe(false)
  })

  it.each([undefined, null, 42, {}])('rejects the non-string %j', (value) => {
    expect(isMainTextModel(value)).toBe(false)
  })
})

describe('shownModels', () => {
  it('keeps only the main text models, in API order', () => {
    const list = [
      model('gemini-2.5-pro-preview-06-05'),
      model('gemini-2.5-pro'),
      model('gemini-flash-latest'),
      model('gemini-2.5-flash'),
      model('gemini-2.5-flash-lite'),
    ]
    expect(shownModels(list)).toEqual([
      model('gemini-2.5-pro'),
      model('gemini-2.5-flash'),
      model('gemini-2.5-flash-lite'),
    ])
  })

  it('falls back to the whole list when no main text model is left', () => {
    const list = [model('gemini-2.5-flash-preview-05-20'), model('gemini-exp-1206')]
    expect(shownModels(list)).toEqual(list)
  })

  it('returns an empty list for an empty or invalid input', () => {
    expect(shownModels([])).toEqual([])
    expect(shownModels(undefined)).toEqual([])
  })
})

describe('modelChoices', () => {
  const all = [
    model('gemini-2.5-pro'),
    model('gemini-2.5-flash-preview-05-20', 'Gemini 2.5 Flash Preview'),
    model('gemini-2.5-flash'),
  ]

  it('offers the shown models and marks a listed saved model as usable', () => {
    expect(modelChoices(all, 'models/gemini-2.5-flash')).toEqual({
      options: [model('gemini-2.5-pro'), model('gemini-2.5-flash')],
      savedUsable: true,
    })
  })

  it('keeps a saved model that is only in the full list, as an extra option at the end', () => {
    expect(modelChoices(all, 'models/gemini-2.5-flash-preview-05-20')).toEqual({
      options: [
        model('gemini-2.5-pro'),
        model('gemini-2.5-flash'),
        model('gemini-2.5-flash-preview-05-20', 'Gemini 2.5 Flash Preview'),
      ],
      savedUsable: true,
    })
  })

  it('reports a saved model missing from the full list as not usable', () => {
    expect(modelChoices(all, 'models/gemini-1.0-pro')).toEqual({
      options: [model('gemini-2.5-pro'), model('gemini-2.5-flash')],
      savedUsable: false,
    })
  })

  it('treats no saved model as nothing to report', () => {
    expect(modelChoices(all, '')).toEqual({
      options: [model('gemini-2.5-pro'), model('gemini-2.5-flash')],
      savedUsable: false,
    })
  })

  it('does not duplicate the saved model in the fallback list', () => {
    const previews = [model('gemini-2.5-flash-preview-05-20'), model('gemini-exp-1206')]
    expect(modelChoices(previews, 'models/gemini-exp-1206')).toEqual({
      options: previews,
      savedUsable: true,
    })
  })
})
