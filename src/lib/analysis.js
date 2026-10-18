// AI analysis result: Gemini response schema, validation and parsing
// (spec 4.2, 5.2). Pure functions; the API call lives in gemini.js.
// Validation happens before anything is stored or shown, and the result
// is plain text only: it is rendered as text nodes, never as HTML
// (spec 5.4).
import { GeminiError } from './geminiError.js'

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

const STRING = { type: 'STRING' }

function objectOf(fields) {
  const properties = {}
  for (const [name, schema] of fields) properties[name] = schema
  const names = fields.map(([name]) => name)
  // propertyOrdering makes Gemini emit fields in spec 4.2 order.
  return { type: 'OBJECT', properties, required: names, propertyOrdering: names }
}

// Gemini responseSchema (OpenAPI subset). analyzedAt is not asked for:
// the app stamps it itself when the response arrives.
export const ANALYSIS_RESPONSE_SCHEMA = deepFreeze(
  objectOf([
    ['detectedLanguage', STRING],
    [
      'grammarErrors',
      {
        type: 'ARRAY',
        items: objectOf([
          ['original', STRING],
          ['corrected', STRING],
          ['explanation', STRING],
        ]),
      },
    ],
    [
      'unclearSentences',
      {
        type: 'ARRAY',
        items: objectOf([
          ['original', STRING],
          ['suggestion', STRING],
          ['explanation', STRING],
        ]),
      },
    ],
    [
      'naturalExpressions',
      {
        type: 'ARRAY',
        items: objectOf([
          ['original', STRING],
          ['alternatives', { type: 'ARRAY', items: STRING, minItems: 1, maxItems: 2 }],
          ['explanation', STRING],
        ]),
      },
    ],
    ['correctedText', STRING],
    ['translation', STRING],
  ]),
)

// Plain objects only (JSON.parse output, object literals or
// Object.create(null)); arrays, Dates and class instances are rejected.
function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function isNonBlankString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

// Returns a copy of `item` with exactly `fields`, or null. Every field
// must be a string and `original` must not be blank; `alternatives` (when
// listed) must be 1-2 non-blank strings.
function cleanItem(item, fields) {
  if (!isPlainObject(item)) return null
  const clean = {}
  for (const field of fields) {
    const value = item[field]
    if (field === 'alternatives') {
      if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null
      if (!value.every(isNonBlankString)) return null
      clean.alternatives = [...value]
    } else {
      if (typeof value !== 'string') return null
      if (field === 'original' && !isNonBlankString(value)) return null
      clean[field] = value
    }
  }
  return clean
}

// All items must be valid; one bad item rejects the whole list, because
// a partially shown analysis could silently hide feedback.
function cleanList(list, fields) {
  if (!Array.isArray(list)) return null
  const clean = []
  for (const item of list) {
    const cleanedItem = cleanItem(item, fields)
    if (!cleanedItem) return null
    clean.push(cleanedItem)
  }
  return clean
}

const LIST_FIELDS = {
  grammarErrors: ['original', 'corrected', 'explanation'],
  unclearSentences: ['original', 'suggestion', 'explanation'],
  naturalExpressions: ['original', 'alternatives', 'explanation'],
}
const TEXT_FIELDS = ['detectedLanguage', 'correctedText', 'translation']

// Validates an analysis (from the model, or one stored earlier) and
// returns a fresh copy with only the known fields, or null when anything
// is off. Text is kept exactly as returned; `**` markup is handled by the
// renderer.
export function validateAnalysis(value) {
  if (!isPlainObject(value)) return null
  const clean = {}
  for (const field of TEXT_FIELDS) {
    if (!isNonBlankString(value[field])) return null
  }
  clean.detectedLanguage = value.detectedLanguage
  for (const [field, fields] of Object.entries(LIST_FIELDS)) {
    const list = cleanList(value[field], fields)
    if (!list) return null
    clean[field] = list
  }
  clean.correctedText = value.correctedText
  clean.translation = value.translation
  if (Object.hasOwn(value, 'analyzedAt')) {
    if (typeof value.analyzedAt !== 'string') return null
    clean.analyzedAt = value.analyzedAt
  }
  return clean
}

// One optional Markdown code fence around the whole text (```json ... ```),
// which some models add even in JSON mode.
const FENCE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i

// Parses the model's text into a validated analysis stamped with
// analyzedAt = now. Any problem throws GeminiError('format'); its message
// never contains the response, which may quote the diary.
export function parseAnalysisResponse(text, { now = new Date() } = {}) {
  if (typeof text !== 'string') throw new GeminiError('format')
  const fenced = FENCE.exec(text)
  let parsed
  try {
    parsed = JSON.parse(fenced ? fenced[1] : text)
  } catch {
    throw new GeminiError('format')
  }
  const analysis = validateAnalysis(parsed)
  if (!analysis) throw new GeminiError('format')
  return { ...analysis, analyzedAt: now.toISOString() }
}
