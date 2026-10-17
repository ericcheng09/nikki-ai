// The sample diary entry shown on first launch (spec 3.5).
// It is local-only, read-only in the UI, and removed for good once the user
// deletes it (sampleDismissed). The analysis is stored now but only shown
// once the Phase 2 result view exists.
import { createEntry, getLocalDateString } from './diary.js'

// Fixed id so seeding is idempotent and the sample can always be found.
export const SAMPLE_ENTRY_ID = '5a3b1e0c-7d2f-4c8a-9b6e-1f0d2c3b4a59'

export const SAMPLE_CONTENT =
  '今日は友達と一緒に新しいカフェを行きました。店の中はとても静かで、コーヒーもおいしいでした。私はケーキを二つ食べましたから、お腹がいっぱいになりました。そのあと、公園を散歩しました。明日も早く起きるつもりです、でも少し疲れました。'

export const SAMPLE_ANALYSIS = Object.freeze({
  detectedLanguage: '日文',
  grammarErrors: [
    {
      original: 'カフェを行きました',
      corrected: 'カフェに行きました',
      explanation:
        '「行く」的目的地要用「に」或「へ」。「を」用在經過的地方，例如「公園を散歩する」。',
    },
    {
      original: 'おいしいでした',
      corrected: 'おいしかったです',
      explanation:
        'い形容詞的過去式要把「い」改成「かった」再加「です」，不能直接接「でした」。',
    },
  ],
  unclearSentences: [
    {
      original: '明日も早く起きるつもりです、でも少し疲れました。',
      suggestion: '少し疲れましたが、明日も早く起きるつもりです。',
      explanation:
        '「でも」通常放在句首，不會用逗號接在句子中間。先說累了、再說明天也要早起，轉折會更清楚。',
    },
  ],
  naturalExpressions: [
    {
      original: 'ケーキを二つ食べましたから',
      alternatives: ['ケーキを二つも食べたので', 'ケーキを二つも食べちゃったので'],
      explanation:
        '說明原因時，「ので」比「から」柔和。「も」強調吃得多，「ちゃった」帶有「不小心吃太多」的口語感。',
    },
    {
      original: '早く起きる',
      alternatives: ['早起きする'],
      explanation: '日常生活中更常用，也更簡潔。',
    },
  ],
  correctedText:
    '今日は友達と一緒に新しいカフェ**に**行きました。店の中はとても静かで、コーヒーもおいし**かった**です。私はケーキを二つ食べましたから、お腹がいっぱいになりました。そのあと、公園を散歩しました。**少し疲れましたが、明日も早く起きるつもりです。**',
  translation:
    '今天和朋友一起去了一家新開的咖啡廳。店裡非常安靜，咖啡也很好喝。我吃了兩塊蛋糕，所以肚子很飽。之後去公園散步。雖然有點累了，但明天也打算早起。',
  analyzedAt: '2026-01-01T00:00:00.000Z',
})

// The sample is dated on the day it is first seeded (local date), so it
// appears at the top of a brand-new diary.
export function createSampleEntry({ now = new Date() } = {}) {
  const entry = createEntry(
    {
      date: getLocalDateString(now),
      content: SAMPLE_CONTENT,
      language: 'auto',
      isSample: true,
    },
    { now, generateId: () => SAMPLE_ENTRY_ID },
  )
  // Deep copy so no caller can mutate the shared constant.
  return { ...entry, analysis: structuredClone(SAMPLE_ANALYSIS) }
}
