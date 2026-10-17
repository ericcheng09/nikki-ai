import { SAMPLE_ENTRY_ID, SAMPLE_ANALYSIS, createSampleEntry } from './sample.js'

describe('createSampleEntry', () => {
  it('builds a sample entry with a fixed id, local date and current timestamps', () => {
    // Local 00:30 on Oct 17 is still Oct 16 in UTC (TZ is pinned to Asia/Taipei).
    const now = new Date(2026, 9, 17, 0, 30)
    const sample = createSampleEntry({ now })

    expect(sample).toMatchObject({
      id: SAMPLE_ENTRY_ID,
      date: '2026-10-17',
      language: 'auto',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      deleted: false,
      deletedAt: null,
      isSample: true,
      analysis: SAMPLE_ANALYSIS,
    })
    expect(sample.content).toMatch(/^今日は友達と一緒に新しいカフェを行きました。/)
  })

  it('always uses the same id so it can be found and never duplicated', () => {
    expect(createSampleEntry().id).toBe(createSampleEntry().id)
    expect(SAMPLE_ENTRY_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('has an analysis with every field of spec 4.2', () => {
    expect(Object.keys(SAMPLE_ANALYSIS).sort()).toEqual(
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
    expect(SAMPLE_ANALYSIS.grammarErrors).toHaveLength(2)
    expect(SAMPLE_ANALYSIS.unclearSentences).toHaveLength(1)
    expect(SAMPLE_ANALYSIS.naturalExpressions).toHaveLength(2)
    for (const item of SAMPLE_ANALYSIS.naturalExpressions) {
      expect(item.alternatives.length).toBeGreaterThanOrEqual(1)
      expect(item.alternatives.length).toBeLessThanOrEqual(2)
    }
  })

  it('returns a fresh object each time so callers cannot mutate the shared analysis', () => {
    const a = createSampleEntry()
    a.analysis.grammarErrors.push({})
    expect(createSampleEntry().analysis.grammarErrors).toHaveLength(2)
  })
})
