import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SettingsPage from './SettingsPage.jsx'

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

describe('SettingsPage', () => {
  it('shows the 設定 heading and a link back home', () => {
    renderSettings()
    expect(screen.getByRole('heading', { level: 2, name: '設定' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '回主畫面' })).toHaveAttribute('href', '/')
  })

  it('goes back to the home route via 回主畫面', () => {
    renderSettings()
    fireEvent.click(screen.getByRole('link', { name: '回主畫面' }))
    expect(screen.getByText('主畫面')).toBeInTheDocument()
  })
})
