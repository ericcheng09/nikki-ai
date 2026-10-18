import {
  ANALYSIS_RESPONSE_SCHEMA,
  parseAnalysisResponse,
  validateAnalysis,
} from './analysis.js'
import { WELCOME_SAMPLE_ANALYSIS } from './welcomeSample.js'

const NOW = new Date('2026-10-18T09:00:00.000Z')

function valid(overrides = {}) {
  return {
    detectedLanguage: '日文',
    grammarErrors: [{ original: 'を行きました', corrected: 'に行きました', explanation: '說明' }],
    unclearSentences: [{ original: '文', suggestion: '建議', explanation: '說明' }],
    naturalExpressions: [
      { original: '早く起きる', alternatives: ['早起きする'], explanation: '說明' },
    ],
    correctedText: '今日は**に**行きました。',
    translation: '今天去了。',
    ...overrides,
  }
}

describe('ANALYSIS_RESPONSE_SCHEMA', () => {
  const ALLOWED_KEYS = new Set([
    'type',
    'properties',
    'required',
    'items',
    'minItems',
    'maxItems',
    'propertyOrdering',
  ])

  // Walks the schema and collects every node.
  function nodes(schema, out = []) {
    out.push(schema)
    if (schema.items) nodes(schema.items, out)
    for (const child of Object.values(schema.properties ?? {})) nodes(child, out)
    return out
  }

  it('describes every analysis field except analyzedAt, all required', () => {
    expect(ANALYSIS_RESPONSE_SCHEMA.type).toBe('OBJECT')
    const fields = [
      'detectedLanguage',
      'grammarErrors',
      'unclearSentences',
      'naturalExpressions',
      'correctedText',
      'translation',
    ]
    expect(Object.keys(ANALYSIS_RESPONSE_SCHEMA.properties)).toEqual(fields)
    expect(ANALYSIS_RESPONSE_SCHEMA.required).toEqual(fields)
    expect(ANALYSIS_RESPONSE_SCHEMA.properties).not.toHaveProperty('analyzedAt')
  })

  it.each([
    ['grammarErrors', ['original', 'corrected', 'explanation']],
    ['unclearSentences', ['original', 'suggestion', 'explanation']],
    ['naturalExpressions', ['original', 'alternatives', 'explanation']],
  ])('defines %s as an array of objects with all fields required', (field, keys) => {
    const list = ANALYSIS_RESPONSE_SCHEMA.properties[field]
    expect(list.type).toBe('ARRAY')
    expect(list.items.type).toBe('OBJECT')
    expect(Object.keys(list.items.properties)).toEqual(keys)
    expect(list.items.required).toEqual(keys)
  })

  it('orders every object schema in spec 4.2 field order', () => {
    const objects = nodes(ANALYSIS_RESPONSE_SCHEMA).filter((node) => node.type === 'OBJECT')
    expect(objects).toHaveLength(4)
    for (const node of objects) {
      expect(node.propertyOrdering).toEqual(Object.keys(node.properties))
    }
    expect(ANALYSIS_RESPONSE_SCHEMA.propertyOrdering).toEqual([
      'detectedLanguage',
      'grammarErrors',
      'unclearSentences',
      'naturalExpressions',
      'correctedText',
      'translation',
    ])
    const items = (field) => ANALYSIS_RESPONSE_SCHEMA.properties[field].items.propertyOrdering
    expect(items('grammarErrors')).toEqual(['original', 'corrected', 'explanation'])
    expect(items('unclearSentences')).toEqual(['original', 'suggestion', 'explanation'])
    expect(items('naturalExpressions')).toEqual(['original', 'alternatives', 'explanation'])
  })

  it('limits alternatives to 1-2 strings', () => {
    const alternatives =
      ANALYSIS_RESPONSE_SCHEMA.properties.naturalExpressions.items.properties.alternatives
    expect(alternatives).toEqual({
      type: 'ARRAY',
      items: { type: 'STRING' },
      minItems: 1,
      maxItems: 2,
    })
  })

  it('uses only the supported schema keywords and types', () => {
    for (const node of nodes(ANALYSIS_RESPONSE_SCHEMA)) {
      for (const key of Object.keys(node)) expect(ALLOWED_KEYS.has(key)).toBe(true)
      expect(['OBJECT', 'ARRAY', 'STRING']).toContain(node.type)
    }
  })

  it('is frozen so callers cannot change it', () => {
    expect(Object.isFrozen(ANALYSIS_RESPONSE_SCHEMA)).toBe(true)
    expect(Object.isFrozen(ANALYSIS_RESPONSE_SCHEMA.properties.grammarErrors.items)).toBe(true)
  })
})

describe('validateAnalysis', () => {
  it('returns a clean copy of a valid analysis', () => {
    const input = valid()
    const result = validateAnalysis(input)
    expect(result).toEqual(input)
    expect(result).not.toBe(input)
    expect(result.grammarErrors).not.toBe(input.grammarErrors)
    expect(result.grammarErrors[0]).not.toBe(input.grammarErrors[0])
    expect(result.naturalExpressions[0].alternatives).not.toBe(
      input.naturalExpressions[0].alternatives,
    )
  })

  it('accepts the welcome page sample (Phase 1 review condition)', () => {
    expect(validateAnalysis(WELCOME_SAMPLE_ANALYSIS)).toEqual(WELCOME_SAMPLE_ANALYSIS)
  })

  it('accepts empty lists', () => {
    const input = valid({ grammarErrors: [], unclearSentences: [], naturalExpressions: [] })
    expect(validateAnalysis(input)).toEqual(input)
  })

  it('drops unknown fields at every level', () => {
    const input = valid({
      extra: 'x',
      grammarErrors: [{ original: 'a', corrected: 'b', explanation: 'c', html: '<b>' }],
      naturalExpressions: [{ original: 'a', alternatives: ['b'], explanation: 'c', score: 1 }],
    })
    const result = validateAnalysis(input)
    expect(result).not.toHaveProperty('extra')
    expect(result.grammarErrors[0]).toEqual({ original: 'a', corrected: 'b', explanation: 'c' })
    expect(result.naturalExpressions[0]).toEqual({
      original: 'a',
      alternatives: ['b'],
      explanation: 'c',
    })
  })

  it('keeps a string analyzedAt and omits a missing one', () => {
    expect(validateAnalysis(valid({ analyzedAt: '2026-10-18T09:00:00.000Z' })).analyzedAt).toBe(
      '2026-10-18T09:00:00.000Z',
    )
    expect(validateAnalysis(valid())).not.toHaveProperty('analyzedAt')
  })

  it('allows blank strings in item fields other than original', () => {
    const input = valid({
      grammarErrors: [{ original: 'a', corrected: '', explanation: '' }],
      unclearSentences: [{ original: 'a', suggestion: '', explanation: ' ' }],
    })
    expect(validateAnalysis(input)).toEqual(input)
  })

  it('keeps text exactly as returned (no trimming, markup untouched)', () => {
    const input = valid({ correctedText: '  <b>x</b> **y**\n', translation: ' t ' })
    expect(validateAnalysis(input)).toEqual(input)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '{}'],
    ['a number', 1],
    ['an array', [valid()]],
    ['a Date', new Date()],
    ['a class instance', new (class Analysis {})()],
  ])('rejects %s as the top-level value', (_label, value) => {
    expect(validateAnalysis(value)).toBeNull()
  })

  it('accepts an object without a prototype', () => {
    const input = Object.assign(Object.create(null), valid())
    expect(validateAnalysis(input)).toEqual(valid())
  })

  it.each(['detectedLanguage', 'correctedText', 'translation'])(
    'rejects a missing, blank or non-string %s',
    (field) => {
      for (const bad of [undefined, null, '', '   ', 1, ['x'], { a: 1 }]) {
        expect(validateAnalysis(valid({ [field]: bad }))).toBeNull()
      }
      const missing = valid()
      delete missing[field]
      expect(validateAnalysis(missing)).toBeNull()
    },
  )

  it.each(['grammarErrors', 'unclearSentences', 'naturalExpressions'])(
    'rejects %s when it is not an array (arrays guaranteed)',
    (field) => {
      for (const bad of [undefined, null, '', 'x', {}, { 0: 'a', length: 1 }, 3]) {
        expect(validateAnalysis(valid({ [field]: bad }))).toBeNull()
      }
    },
  )

  it.each([
    ['grammarErrors', { original: 'a', corrected: 'b', explanation: 'c' }],
    ['unclearSentences', { original: 'a', suggestion: 'b', explanation: 'c' }],
    ['naturalExpressions', { original: 'a', alternatives: ['b'], explanation: 'c' }],
  ])('rejects bad %s items (items are objects, fields are strings)', (field, good) => {
    expect(validateAnalysis(valid({ [field]: [good] }))).not.toBeNull()
    // Items must be plain objects.
    for (const item of [null, 'text', 1, [good]]) {
      expect(validateAnalysis(valid({ [field]: [good, item] }))).toBeNull()
    }
    for (const key of Object.keys(good)) {
      const missing = { ...good }
      delete missing[key]
      expect(validateAnalysis(valid({ [field]: [missing] }))).toBeNull()
      if (key === 'alternatives') continue
      for (const bad of [null, 1, true, ['x'], { a: 1 }]) {
        expect(validateAnalysis(valid({ [field]: [{ ...good, [key]: bad }] }))).toBeNull()
      }
    }
    // original must not be blank.
    for (const blank of ['', '  \n']) {
      expect(validateAnalysis(valid({ [field]: [{ ...good, original: blank }] }))).toBeNull()
    }
  })

  it('requires 1-2 non-blank string alternatives', () => {
    const withAlternatives = (alternatives) =>
      valid({ naturalExpressions: [{ original: 'a', alternatives, explanation: 'c' }] })
    expect(validateAnalysis(withAlternatives(['b']))).not.toBeNull()
    expect(validateAnalysis(withAlternatives(['b', 'c']))).not.toBeNull()
    for (const bad of [[], ['b', 'c', 'd'], [''], ['b', ' '], [1], ['b', null], 'b', null, {}]) {
      expect(validateAnalysis(withAlternatives(bad))).toBeNull()
    }
  })

  it('rejects a non-string analyzedAt', () => {
    for (const bad of [null, 1, {}, new Date()]) {
      expect(validateAnalysis(valid({ analyzedAt: bad }))).toBeNull()
    }
  })

  it('does not mutate the input', () => {
    const input = Object.freeze(valid({ extra: 1 }))
    expect(() => validateAnalysis(input)).not.toThrow()
    expect(input.extra).toBe(1)
  })
})

describe('parseAnalysisResponse', () => {
  function codeOf(text) {
    try {
      parseAnalysisResponse(text, { now: NOW })
    } catch (error) {
      // The response text must never end up in the error message.
      if (typeof text === 'string' && text.length > 0) {
        expect(error.message).not.toContain(text)
      }
      return error.code
    }
    throw new Error('expected parseAnalysisResponse to throw')
  }

  it('parses, validates and stamps analyzedAt with now', () => {
    expect(parseAnalysisResponse(JSON.stringify(valid()), { now: NOW })).toEqual({
      ...valid(),
      analyzedAt: '2026-10-18T09:00:00.000Z',
    })
  })

  it('overrides an analyzedAt sent by the model', () => {
    const text = JSON.stringify(valid({ analyzedAt: '1999-01-01T00:00:00.000Z' }))
    expect(parseAnalysisResponse(text, { now: NOW }).analyzedAt).toBe(NOW.toISOString())
  })

  it('uses the current time by default', () => {
    const before = new Date().toISOString()
    const { analyzedAt } = parseAnalysisResponse(JSON.stringify(valid()))
    expect(analyzedAt >= before).toBe(true)
  })

  it.each([
    ['```json\n%s\n```'],
    ['```\n%s\n```'],
    ['  ```JSON\n%s\n```  \n'],
    ['```json %s ```'],
    ['\n\n%s\n'],
  ])('tolerates surrounding whitespace and one code fence: %j', (wrapper) => {
    const text = wrapper.replace('%s', JSON.stringify(valid(), null, 2))
    expect(parseAnalysisResponse(text, { now: NOW })).toEqual({
      ...valid(),
      analyzedAt: NOW.toISOString(),
    })
  })

  it.each([
    ['not JSON', 'Here is your analysis!'],
    ['truncated JSON', JSON.stringify(valid()).slice(0, 40)],
    ['empty text', ''],
    ['JSON null', 'null'],
    ['a JSON array', JSON.stringify([valid()])],
    ['an invalid analysis', JSON.stringify(valid({ grammarErrors: null }))],
    // Valid analyses inside, so only the extra text can cause the error.
    [
      'two fences',
      `\`\`\`json\n${JSON.stringify(valid())}\n\`\`\`\n\`\`\`json\n${JSON.stringify(valid())}\n\`\`\``,
    ],
    ['text before a fence', `Sure:\n\`\`\`json\n${JSON.stringify(valid())}\n\`\`\``],
    ['text after a fence', `\`\`\`json\n${JSON.stringify(valid())}\n\`\`\`\nHope this helps!`],
    ['text after plain JSON', `${JSON.stringify(valid())}\nHope this helps!`],
  ])('throws a format error for %s', (_label, text) => {
    expect(codeOf(text)).toBe('format')
  })

  it.each([[undefined], [null], [42], [{}]])('throws a format error for non-text %j', (value) => {
    expect(codeOf(value)).toBe('format')
  })

  it('does not log anything', () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((n) => vi.spyOn(console, n))
    codeOf('secret diary text that is not JSON')
    parseAnalysisResponse(JSON.stringify(valid()), { now: NOW })
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    }
  })
})
