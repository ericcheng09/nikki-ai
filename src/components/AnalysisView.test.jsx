import { render, screen, within } from '@testing-library/react'
import AnalysisView from './AnalysisView.jsx'

const analysis = {
  detectedLanguage: '日文',
  grammarErrors: [
    { original: 'カフェを行きました', corrected: 'カフェに行きました', explanation: '目的地用に' },
    { original: 'おいしいでした', corrected: 'おいしかったです', explanation: '形容詞過去式' },
  ],
  unclearSentences: [
    { original: '明日も…、でも疲れました。', suggestion: '疲れましたが、明日も…。', explanation: '轉折' },
  ],
  naturalExpressions: [
    { original: '二つ食べましたから', alternatives: ['二つも食べたので', '二つも食べちゃったので'], explanation: 'ので較柔和' },
    { original: '早く起きる', alternatives: ['早起きする'], explanation: '更簡潔' },
  ],
  correctedText: '新しいカフェ**に**行きました。\nコーヒーもおいし**かった**です。',
  translation: '去了新的咖啡廳。\n咖啡也很好喝。',
  analyzedAt: '2026-01-01T00:00:00.000Z',
}

const region = (name) => screen.getByRole('region', { name })

describe('AnalysisView', () => {
  it('shows the detected language', () => {
    render(<AnalysisView analysis={analysis} />)
    expect(region('判斷的語言')).toHaveTextContent('日文')
  })

  it('lists grammar errors with original, correction and explanation', () => {
    render(<AnalysisView analysis={analysis} />)
    const items = within(region('文法錯誤')).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('カフェを行きました')
    expect(items[0]).toHaveTextContent('カフェに行きました')
    expect(items[0]).toHaveTextContent('目的地用に')
    expect(within(region('文法錯誤')).queryByText('無錯誤')).not.toBeInTheDocument()
  })

  it('shows 無錯誤 when there are no grammar errors', () => {
    render(<AnalysisView analysis={{ ...analysis, grammarErrors: [] }} />)
    expect(within(region('文法錯誤')).getByText('無錯誤')).toBeInTheDocument()
    expect(within(region('文法錯誤')).queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('lists unclear sentences with original, suggestion and explanation', () => {
    render(<AnalysisView analysis={analysis} />)
    const [item] = within(region('不通順或易誤會的句子')).getAllByRole('listitem')
    expect(item).toHaveTextContent('明日も…、でも疲れました。')
    expect(item).toHaveTextContent('疲れましたが、明日も…。')
    expect(item).toHaveTextContent('轉折')
  })

  it('lists natural expressions with every alternative', () => {
    render(<AnalysisView analysis={analysis} />)
    const section = region('更道地的說法')
    expect(section).toHaveTextContent('二つ食べましたから')
    expect(section).toHaveTextContent('二つも食べたので')
    expect(section).toHaveTextContent('二つも食べちゃったので')
    expect(section).toHaveTextContent('ので較柔和')
    expect(section).toHaveTextContent('早起きする')
    expect(section).toHaveTextContent('更簡潔')
  })

  it('separates multiple alternatives with ／ (docs/decisions.md)', () => {
    render(<AnalysisView analysis={analysis} />)
    const [first, second] = within(region('更道地的說法')).getAllByRole('listitem')
    expect(first.querySelector('.analysis-change').textContent).toBe(
      '二つ食べましたから → 二つも食べたので／二つも食べちゃったので',
    )
    // A single alternative has no separator.
    expect(second.querySelector('.analysis-change').textContent).toBe('早く起きる → 早起きする')
  })

  it.each([
    ['不通順或易誤會的句子', { unclearSentences: [] }],
    ['更道地的說法', { naturalExpressions: [] }],
  ])('shows 無 when %s is empty', (name, override) => {
    render(<AnalysisView analysis={{ ...analysis, ...override }} />)
    expect(within(region(name)).getByText('無')).toBeInTheDocument()
    expect(within(region(name)).queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('renders ** parts of the corrected text as <strong> and keeps line breaks', () => {
    render(<AnalysisView analysis={analysis} />)
    const section = region('修改後全文')
    const strong = section.querySelectorAll('strong')
    expect([...strong].map((el) => el.textContent)).toEqual(['に', 'かった'])
    expect(section).not.toHaveTextContent('**')
    const text = section.querySelector('.analysis-text')
    expect(text.textContent).toBe('新しいカフェに行きました。\nコーヒーもおいしかったです。')
  })

  it('keeps line breaks in the translation', () => {
    render(<AnalysisView analysis={analysis} />)
    const text = region('中文翻譯').querySelector('.analysis-text')
    expect(text.textContent).toBe('去了新的咖啡廳。\n咖啡也很好喝。')
  })

  it('does not show analyzedAt', () => {
    const { container } = render(<AnalysisView analysis={analysis} />)
    expect(container).not.toHaveTextContent('2026-01-01')
  })

  it('does not crash on an empty analysis object', () => {
    render(<AnalysisView analysis={{}} />)
    expect(within(region('文法錯誤')).getByText('無錯誤')).toBeInTheDocument()
    expect(within(region('不通順或易誤會的句子')).getByText('無')).toBeInTheDocument()
    expect(within(region('更道地的說法')).getByText('無')).toBeInTheDocument()
    expect(region('修改後全文').querySelector('strong')).toBeNull()
  })

  it('skips malformed list values and items', () => {
    render(
      <AnalysisView
        analysis={{
          ...analysis,
          grammarErrors: 'not a list',
          unclearSentences: [null, 'text', 42],
          naturalExpressions: [
            { original: 'orig', alternatives: ['ok', null, { x: 1 }], explanation: 'e' },
            undefined,
          ],
        }}
      />,
    )
    expect(within(region('文法錯誤')).getByText('無錯誤')).toBeInTheDocument()
    expect(within(region('不通順或易誤會的句子')).getByText('無')).toBeInTheDocument()
    const items = within(region('更道地的說法')).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0].querySelectorAll('.analysis-fixed')).toHaveLength(1)
    expect(items[0]).toHaveTextContent('ok')
  })

  it('renders HTML in every field as plain text only', () => {
    const img = '<img src=x onerror=alert(1)>'
    const script = '<script>alert(1)</script>'
    const evil = {
      detectedLanguage: img,
      grammarErrors: [{ original: img, corrected: script, explanation: img }],
      unclearSentences: [{ original: script, suggestion: img, explanation: script }],
      naturalExpressions: [{ original: img, alternatives: [script, img], explanation: script }],
      correctedText: `${img} **${script}** ${img}`,
      translation: script,
      analyzedAt: '2026-01-01T00:00:00.000Z',
    }
    const { container } = render(<AnalysisView analysis={evil} />)

    expect(container.querySelector('img, script, iframe')).toBeNull()
    // The raw strings are visible as text.
    expect(container.textContent).toContain(img)
    expect(container.textContent).toContain(script)
    expect(region('修改後全文').querySelector('strong').textContent).toBe(script)
  })
})
