import { WELCOME_SAMPLE_ANALYSIS, WELCOME_SAMPLE_CONTENT } from './welcomeSample.js'

describe('welcome sample', () => {
  it('has the sample diary text', () => {
    expect(WELCOME_SAMPLE_CONTENT).toMatch(/^今日は友達と一緒に新しいカフェを行きました。/)
    expect(WELCOME_SAMPLE_CONTENT).toMatch(/でも少し疲れました。$/)
  })

  it('has an analysis with every field of spec 4.2', () => {
    expect(Object.keys(WELCOME_SAMPLE_ANALYSIS).sort()).toEqual(
      [
        'analyzedAt',
        'correctedText',
        'detectedLanguage',
        'grammarErrors',
        'naturalExpressions',
        'translation',
        'unclearSentences',
      ].sort(),
    )
    expect(WELCOME_SAMPLE_ANALYSIS.grammarErrors).toHaveLength(2)
    expect(WELCOME_SAMPLE_ANALYSIS.unclearSentences).toHaveLength(1)
    expect(WELCOME_SAMPLE_ANALYSIS.naturalExpressions).toHaveLength(2)
    for (const item of WELCOME_SAMPLE_ANALYSIS.naturalExpressions) {
      expect(item.alternatives.length).toBeGreaterThanOrEqual(1)
      expect(item.alternatives.length).toBeLessThanOrEqual(2)
    }
  })

  it('is deeply frozen so the shared sample cannot be modified', () => {
    expect(Object.isFrozen(WELCOME_SAMPLE_ANALYSIS)).toBe(true)
    expect(Object.isFrozen(WELCOME_SAMPLE_ANALYSIS.grammarErrors)).toBe(true)
    expect(Object.isFrozen(WELCOME_SAMPLE_ANALYSIS.naturalExpressions[0].alternatives)).toBe(true)
  })
})
