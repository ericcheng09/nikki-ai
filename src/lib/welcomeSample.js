// Sample diary and its finished AI analysis shown on the welcome page
// (spec 3.5). These are program constants only: they are never stored in
// IndexedDB, never listed as a diary entry and never synced.

export const WELCOME_SAMPLE_CONTENT =
  '今日は友達と一緒に新しいカフェを行きました。店の中はとても静かで、コーヒーもおいしいでした。私はケーキを二つ食べましたから、お腹がいっぱいになりました。そのあと、公園を散歩しました。明日も早く起きるつもりです、でも少し疲れました。'

// Deep-frozen so no caller can accidentally modify the shared sample.
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

export const WELCOME_SAMPLE_ANALYSIS = deepFreeze({
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
