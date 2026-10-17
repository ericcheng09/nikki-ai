// Integration test: WelcomePage and HomePage under real routes with the
// real connection.js; only the IndexedDB layer (db.js) is mocked so that
// saving welcomeSeen can fail.
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../App.jsx'
import { getSettings, saveSettings } from '../storage/db.js'

vi.mock('../storage/db.js', () => ({
  openDatabase: vi.fn().mockResolvedValue({}),
  getAllEntries: vi.fn().mockResolvedValue([]),
  putEntry: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}))

describe('welcome flow', () => {
  it('stays on the list after 開始使用 even when saving welcomeSeen fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error')
    // The stored value stays false because every save fails.
    vi.mocked(getSettings).mockResolvedValue({ welcomeSeen: false })
    vi.mocked(saveSettings).mockRejectedValue(new Error('write failed'))

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    // First visit: redirected to the welcome page.
    fireEvent.click(await screen.findByRole('button', { name: '開始使用' }))

    // Back home, and not sent back to /welcome.
    expect(await screen.findByText(/還沒有日記/)).toBeInTheDocument()
    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(getSettings).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: '開始使用' })).not.toBeInTheDocument()
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
