import { Routes, Route } from 'react-router-dom'
import TopBar from './components/TopBar.jsx'
import HomePage from './components/HomePage.jsx'
import DiaryEditor from './components/DiaryEditor.jsx'
import EntryPage from './components/EntryPage.jsx'
import WelcomePage from './components/WelcomePage.jsx'
import SettingsPage from './components/SettingsPage.jsx'

// Router is provided by the caller (main.jsx / tests) so App can be
// rendered with a MemoryRouter in unit tests.
export default function App() {
  return (
    <>
      <TopBar />
      <div className="app">
        <main>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/welcome" element={<WelcomePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/entry/new" element={<DiaryEditor />} />
            <Route path="/entry/:id" element={<EntryPage />} />
          </Routes>
        </main>
      </div>
    </>
  )
}
