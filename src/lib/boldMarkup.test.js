import { parseBoldMarkup } from './boldMarkup.js'

// Rebuilds the source string from segments, re-adding the ** markers that
// were consumed for bold segments. Used to prove no text is ever lost.
const rebuild = (segments) =>
  segments.map((s) => (s.bold ? `**${s.text}**` : s.text)).join('')

describe('parseBoldMarkup', () => {
  it('returns plain text as a single non-bold segment', () => {
    expect(parseBoldMarkup('Hello world')).toEqual([{ text: 'Hello world', bold: false }])
  })

  it('marks text between a pair of ** as bold', () => {
    expect(parseBoldMarkup('今日は**晴れ**です')).toEqual([
      { text: '今日は', bold: false },
      { text: '晴れ', bold: true },
      { text: 'です', bold: false },
    ])
  })

  it('handles several bold parts', () => {
    expect(parseBoldMarkup('a **b** c **d** e')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
      { text: ' c ', bold: false },
      { text: 'd', bold: true },
      { text: ' e', bold: false },
    ])
  })

  it('handles bold at the very start and end', () => {
    expect(parseBoldMarkup('**start** middle **end**')).toEqual([
      { text: 'start', bold: true },
      { text: ' middle ', bold: false },
      { text: 'end', bold: true },
    ])
  })

  it('handles adjacent bold parts', () => {
    expect(parseBoldMarkup('**a****b**')).toEqual([
      { text: 'a', bold: true },
      { text: 'b', bold: true },
    ])
  })

  it('keeps line breaks, inside and outside bold', () => {
    expect(parseBoldMarkup('line1\n**bold\nline**\nline3')).toEqual([
      { text: 'line1\n', bold: false },
      { text: 'bold\nline', bold: true },
      { text: '\nline3', bold: false },
    ])
  })

  it('keeps an unpaired ** as literal text', () => {
    expect(parseBoldMarkup('a ** b')).toEqual([{ text: 'a ** b', bold: false }])
  })

  it('keeps a trailing unpaired ** after a valid pair as literal text', () => {
    expect(parseBoldMarkup('**x** and ** y')).toEqual([
      { text: 'x', bold: true },
      { text: ' and ** y', bold: false },
    ])
  })

  it('keeps an empty pair **** as literal text', () => {
    expect(parseBoldMarkup('a****b')).toEqual([{ text: 'a****b', bold: false }])
  })

  it('keeps an empty pair literal and still parses a later pair', () => {
    expect(parseBoldMarkup('****x**y**')).toEqual([
      { text: '****x', bold: false },
      { text: 'y', bold: true },
    ])
  })

  it('leaves single asterisks alone', () => {
    expect(parseBoldMarkup('2 * 3 = *six*')).toEqual([
      { text: '2 * 3 = *six*', bold: false },
    ])
  })

  it('keeps HTML-like text as plain text', () => {
    expect(parseBoldMarkup('**<b>x</b>**')).toEqual([{ text: '<b>x</b>', bold: true }])
  })

  it('returns an empty array for empty, null or non-string input', () => {
    expect(parseBoldMarkup('')).toEqual([])
    expect(parseBoldMarkup(null)).toEqual([])
    expect(parseBoldMarkup(undefined)).toEqual([])
    expect(parseBoldMarkup(42)).toEqual([])
  })

  it('never loses text', () => {
    const inputs = [
      'plain',
      '**a**',
      'a ** b',
      '****',
      '**',
      '***',
      '*****',
      '***a***',
      '**a** ** b **c',
      'x\n**y\nz**\n',
      '****x**y**',
    ]
    for (const input of inputs) {
      expect(rebuild(parseBoldMarkup(input))).toBe(input)
    }
  })

  it('never returns empty segments', () => {
    for (const input of ['**a**', '**a****b**', '****', 'a**b**']) {
      for (const segment of parseBoldMarkup(input)) {
        expect(segment.text).not.toBe('')
      }
    }
  })
})
