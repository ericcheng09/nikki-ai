import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import AnalysisView from './AnalysisView.jsx'
import { validateAnalysis } from '../lib/analysis.js'
import { formatLocalDateTime } from '../lib/diary.js'
import { GeminiError, generateAnalysis, geminiErrorMessage } from '../lib/gemini.js'
import { loadSettings, saveEntryAnalysis } from '../storage/connection.js'
import useMediaQuery, { WIDE_LAYOUT_QUERY } from '../lib/useMediaQuery.js'

// Error codes whose fix is on the settings page; their message gets a
// link there.
const SETTINGS_LINK_CODES = new Set(['noKey', 'noModel', 'invalidKey', 'modelUnavailable'])

const UNSAVED_MESSAGE = '請先儲存日記再批改'
const STORE_FAILED_MESSAGE = '無法儲存批改結果，請重新整理頁面後再試一次。'
const INVALID_STORED_MESSAGE = '無法顯示批改結果，請重新批改。'

function geminiFailure(error) {
  const code = error instanceof GeminiError ? error.code : 'other'
  return { text: geminiErrorMessage(code), settingsLink: SETTINGS_LINK_CODES.has(code) }
}

// One review run for a saved entry: fresh settings, the Gemini call, then
// the write-back. Never throws; resolves with { record } (the written
// entry, or null when it was deleted meanwhile and the result discarded)
// or { failure }. It does not depend on the component, so it finishes and
// stores the result even after the page was left (decisions.md).
// Nothing here logs: errors may carry the key, the diary or the response.
async function runReview(entry) {
  let analysis
  try {
    // Read at click time, so a key or model changed in another tab or on
    // the settings page is used without reloading this page.
    const settings = await loadSettings()
    analysis = await generateAnalysis({
      apiKey: settings.geminiApiKey,
      model: settings.geminiModel,
      entry: { content: entry.content, language: entry.language },
    })
  } catch (error) {
    return { failure: geminiFailure(error) }
  }
  try {
    return { record: await saveEntryAnalysis(entry.id, analysis) }
  } catch {
    return { failure: { text: STORE_FAILED_MESSAGE, settingsLink: false } }
  }
}

// 「AI 批改」 button and the stored result of a saved entry (spec 3.2).
// `entry` is the editor's last saved version; `hasUnsavedChanges` blocks
// sending text that differs from it. `onAnalyzed(record)` receives the
// stored record after a successful run (only while still mounted).
export default function AiReviewPanel({ entry, hasUnsavedChanges, onAnalyzed }) {
  const [busy, setBusy] = useState(false)
  // Same synchronous lock as the editor: blocks a second click before
  // React re-renders with busy === true.
  const busyRef = useRef(false)
  // { text, settingsLink } or null
  const [failure, setFailure] = useState(null)
  const mountedRef = useRef(false)
  const headingId = useId()
  // From 768px the panel is a sticky box that scrolls on its own
  // (index.css). Its text has no focusable elements, so the box itself
  // takes focus there to be scrollable by keyboard; on narrow screens the
  // page scrolls and an extra tab stop would only get in the way.
  const isScrollBox = useMediaQuery(WIDE_LAYOUT_QUERY)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function handleReview() {
    if (busyRef.current) return
    // Only the saved text is ever sent, so the result matches what is
    // stored.
    if (hasUnsavedChanges) {
      setFailure({ text: UNSAVED_MESSAGE, settingsLink: false })
      return
    }
    busyRef.current = true
    setBusy(true)
    setFailure(null)
    const outcome = await runReview(entry)
    busyRef.current = false
    // Left the page meanwhile: the result is already stored, nothing to show.
    if (!mountedRef.current) return
    setBusy(false)
    if (outcome.failure) {
      // The previous result (if any) stays visible.
      setFailure(outcome.failure)
    } else if (outcome.record) {
      onAnalyzed(outcome.record)
    }
  }

  const stored = entry.analysis
  // Stored data is re-validated before rendering; it may come from an
  // older version or (Phase 4) another device.
  const analysis = stored == null ? null : validateAnalysis(stored)
  const analyzedAt = analysis ? formatLocalDateTime(analysis.analyzedAt) : ''

  return (
    <section
      className="ai-review"
      aria-labelledby={headingId}
      tabIndex={isScrollBox ? 0 : undefined}
    >
      <div className="toolbar">
        <h2 id={headingId}>AI 批改結果</h2>
        <button type="button" className="button" onClick={handleReview} disabled={busy}>
          {busy ? '批改中…' : 'AI 批改'}
        </button>
      </div>

      {failure && (
        <p className="error" role="alert">
          {failure.text}
          {failure.settingsLink && (
            <>
              {' '}
              <Link to="/settings">前往設定頁</Link>
            </>
          )}
        </p>
      )}

      {stored != null && !analysis && <p className="muted">{INVALID_STORED_MESSAGE}</p>}
      {analysis && (
        <>
          {analyzedAt && <p className="muted">批改時間：{analyzedAt}</p>}
          <AnalysisView analysis={analysis} />
        </>
      )}
    </section>
  )
}
