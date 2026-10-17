import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SettingsPage from './SettingsPage.jsx'
import { loadSettings } from '../storage/connection.js'

vi.mock('../storage/connection.js', () => ({
  loadSettings: vi.fn(),
  updateSettings: vi.fn(),
}))

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/" element={<p>主畫面</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(loadSettings).mockResolvedValue({ welcomeSeen: true, geminiApiKey: '' })
})

describe('SettingsPage', () => {
  it('shows the 設定 heading, a link back home and the API key section', async () => {
    renderSettings()
    expect(screen.getByRole('heading', { level: 2, name: '設定' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '回主畫面' })).toHaveAttribute('href', '/')
    expect(
      await screen.findByRole('heading', { level: 3, name: 'Gemini API key' }),
    ).toBeInTheDocument()
  })

  it('goes back to the home route via 回主畫面', async () => {
    renderSettings()
    await screen.findByText('尚未設定 API key')
    fireEvent.click(screen.getByRole('link', { name: '回主畫面' }))
    expect(screen.getByText('主畫面')).toBeInTheDocument()
  })
})
