import { Routes, Route, Link } from 'react-router-dom'
import DiaryList from './components/DiaryList.jsx'
import DiaryEditor from './components/DiaryEditor.jsx'

// Router is provided by the caller (main.jsx / tests) so App can be
// rendered with a MemoryRouter in unit tests.
export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <Link to="/">外語學習日記</Link>
        </h1>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<DiaryList />} />
          <Route path="/entry/new" element={<DiaryEditor />} />
        </Routes>
      </main>
    </div>
  )
}
