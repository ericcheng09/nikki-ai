// Parses the `**bold**` markers used in the AI's correctedText (spec 4.2)
// into plain data segments, so the UI can render them as React elements
// and never has to treat AI text as HTML (spec 5.4).
//
// Rules:
// - Text between a pair of `**` markers is bold; markers pair up in order.
// - An unpaired `**` (no closing marker) stays as literal text.
// - An empty pair `****` stays as literal text.
// - Nothing is ever dropped: re-adding `**` around bold segments
//   reproduces the input exactly. Line breaks are kept as-is.
//
// Returns [{ text, bold }], with adjacent plain text merged and no empty
// segments.
const MARKER = '**'

export function parseBoldMarkup(input) {
  if (typeof input !== 'string' || input === '') return []

  const segments = []
  let plain = ''
  let pos = 0

  const flushPlain = () => {
    if (plain !== '') segments.push({ text: plain, bold: false })
    plain = ''
  }

  while (pos < input.length) {
    const open = input.indexOf(MARKER, pos)
    if (open === -1) break
    const close = input.indexOf(MARKER, open + MARKER.length)
    // No closing marker: the rest (including this `**`) is literal.
    if (close === -1) break

    if (close === open + MARKER.length) {
      // Empty pair `****`: keep it literally and continue after it.
      plain += input.slice(pos, close + MARKER.length)
    } else {
      plain += input.slice(pos, open)
      flushPlain()
      segments.push({ text: input.slice(open + MARKER.length, close), bold: true })
    }
    pos = close + MARKER.length
  }

  plain += input.slice(pos)
  flushPlain()
  return segments
}
