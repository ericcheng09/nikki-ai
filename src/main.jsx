import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import syncEngine from './lib/syncEngine.js'
import './index.css'

// Syncs on app start when signed in, then on changes, 'online' and
// sign-in. Signed out it only reads local state and makes no requests.
syncEngine.start()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* BASE_URL comes from vite.config.js `base`, so the basename is never hard-coded. */}
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
