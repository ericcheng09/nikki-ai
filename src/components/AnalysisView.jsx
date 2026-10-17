import { parseBoldMarkup } from '../lib/boldMarkup.js'

// Read-only view of one AI analysis (spec 4.2). It depends only on the
// analysis object, so the welcome page and the Phase 2 entry page can both
// use it.
//
// Security (spec 5.4): every AI string is rendered as a React text node and
// is never injected as raw HTML; bold markers are parsed into data and
// rendered as <strong> elements.

function Section({ id, title, children }) {
  const headingId = `analysis-${id}`
  return (
    <section className="analysis-section" aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      {children}
    </section>
  )
}

// Defensive: only real arrays of objects are rendered, so a malformed
// value can never crash the view (Phase 2 validates AI output separately).
function asList(value) {
  return Array.isArray(value)
    ? value.filter((item) => item !== null && typeof item === 'object')
    : []
}

function asStrings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}

function EmptyNote({ children }) {
  return <p className="muted">{children}</p>
}

export default function AnalysisView({ analysis: input }) {
  const analysis = input ?? {}
  const grammarErrors = asList(analysis.grammarErrors)
  const unclearSentences = asList(analysis.unclearSentences)
  const naturalExpressions = asList(analysis.naturalExpressions)

  return (
    <div className="analysis-view">
      <Section id="language" title="判斷的語言">
        <p>{analysis.detectedLanguage}</p>
      </Section>

      <Section id="grammar" title="文法錯誤">
        {grammarErrors.length === 0 ? (
          <EmptyNote>無錯誤</EmptyNote>
        ) : (
          <ul className="analysis-list">
            {grammarErrors.map((item, index) => (
              <li key={index}>
                <p className="analysis-change">
                  <span className="analysis-original">{item.original}</span>
                  {' → '}
                  <span className="analysis-fixed">{item.corrected}</span>
                </p>
                <p className="analysis-explanation">{item.explanation}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="unclear" title="不通順或易誤會的句子">
        {unclearSentences.length === 0 ? (
          <EmptyNote>無</EmptyNote>
        ) : (
          <ul className="analysis-list">
            {unclearSentences.map((item, index) => (
              <li key={index}>
                <p className="analysis-change">
                  <span className="analysis-original">{item.original}</span>
                  {' → '}
                  <span className="analysis-fixed">{item.suggestion}</span>
                </p>
                <p className="analysis-explanation">{item.explanation}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="natural" title="更道地的說法">
        {naturalExpressions.length === 0 ? (
          <EmptyNote>無</EmptyNote>
        ) : (
          <ul className="analysis-list">
            {naturalExpressions.map((item, index) => (
              <li key={index}>
                <p className="analysis-change">
                  <span className="analysis-original">{item.original}</span>
                  {' → '}
                  {asStrings(item.alternatives).map((alternative, altIndex) => (
                    <span key={altIndex}>
                      {altIndex > 0 && '／'}
                      <span className="analysis-fixed">{alternative}</span>
                    </span>
                  ))}
                </p>
                <p className="analysis-explanation">{item.explanation}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="corrected" title="修改後全文">
        <p className="analysis-text">
          {parseBoldMarkup(analysis.correctedText).map((segment, index) =>
            segment.bold ? (
              <strong key={index}>{segment.text}</strong>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </p>
      </Section>

      <Section id="translation" title="中文翻譯">
        <p className="analysis-text">{analysis.translation}</p>
      </Section>
    </div>
  )
}
