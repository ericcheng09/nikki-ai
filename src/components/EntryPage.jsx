import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import DiaryEditor from './DiaryEditor.jsx'
import { loadEntry } from '../storage/connection.js'

// Loads the entry for /entry/:id and shows it in an editable form.
export default function EntryPage() {
  const { id } = useParams()
  // status: 'loading' | 'ready' | 'notFound' | 'error'
  const [state, setState] = useState({ status: 'loading', entry: null, id })

  useEffect(() => {
    let active = true
    loadEntry(id)
      .then((entry) => {
        if (!active) return
        // Soft-deleted tombstones count as missing.
        if (!entry || entry.deleted) {
          setState({ status: 'notFound', entry: null, id })
        } else {
          setState({ status: 'ready', entry, id })
        }
      })
      .catch(() => {
        // Deliberately not logging: the error could carry diary data.
        if (active) setState({ status: 'error', entry: null, id })
      })
    return () => {
      active = false
    }
  }, [id])

  // While a new id loads, state still holds the previous id's result;
  // treat that as loading instead of showing the wrong entry.
  if (state.id !== id || state.status === 'loading') {
    return <p className="muted">載入中…</p>
  }
  if (state.status === 'error') {
    return (
      <p className="error" role="alert">
        無法存取本機資料，請重新整理頁面。
      </p>
    )
  }
  if (state.status === 'notFound') {
    return (
      <section>
        <p>找不到這篇日記</p>
        <Link to="/">回主畫面</Link>
      </section>
    )
  }
  // key: remount the form (fresh state) when navigating to another entry.
  return <DiaryEditor key={state.entry.id} entry={state.entry} />
}
