// Error type shared by gemini.js and analysis.js (kept in its own module
// so the two do not import each other).
//
// `code` is machine-readable and mapped to Chinese text by the UI:
// 'invalidKey' | 'quota' | 'modelUnavailable' | 'network' | 'format' |
// 'other', plus 'noKey' / 'noModel' for missing settings. The message is
// fixed English text and never includes the key, the prompt, the diary or
// the response (spec 5.4).
export class GeminiError extends Error {
  constructor(code) {
    super(`Gemini request failed: ${code}`)
    this.name = 'GeminiError'
    this.code = code
  }
}
