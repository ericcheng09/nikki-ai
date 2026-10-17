import { Routes, Route } from 'react-router-dom'

function HomePage() {
  return (
    <main>
      <h1>外語學習日記</h1>
    </main>
  )
}

// Router is provided by the caller (main.jsx / tests) so App can be
// rendered with a MemoryRouter in unit tests.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
    </Routes>
  )
}
