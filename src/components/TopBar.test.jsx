import { act, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, useLocation } from 'react-router-dom'
import TopBar from './TopBar.jsx'
import { markWelcomeSeen } from '../storage/connection.js'

vi.mock('../storage/connection.js', () => ({
  markWelcomeSeen: vi.fn(),
}))

// Shows the current path, plus an in-app link for leaving a page.
function Probe() {
  const location = useLocation()
  return (
    <>
      <p data-testid="path">{location.pathname}</p>
      <Link to="/other">離開</Link>
    </>
  )
}

function renderAt(entries, initialIndex) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={initialIndex}>
      <TopBar />
      <Probe />
    </MemoryRouter>,
  )
}

const path = () => screen.getByTestId('path').textContent
const backButton = () => screen.queryByRole('button', { name: '返回' })
const gear = () => screen.queryByRole('link', { name: '設定' })
const help = () => screen.queryByRole('link', { name: '使用說明' })
const start = () => screen.queryByRole('button', { name: '開始使用' })

afterEach(() => {
  vi.mocked(markWelcomeSeen).mockReset()
  vi.restoreAllMocks()
})

describe('TopBar', () => {
  it('shows the app name linking home, 設定 and 使用說明 on the home page', () => {
    renderAt(['/'])
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: '外語學習日記' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '外語學習日記' })).toHaveAttribute('href', '/')
    expect(gear()).toHaveAttribute('href', '/settings')
    expect(gear()).toHaveAttribute('title', '設定')
    expect(help()).toHaveAttribute('href', '/welcome')
    expect(help()).toHaveAttribute('title', '使用說明')
    expect(backButton()).not.toBeInTheDocument()
    expect(start()).not.toBeInTheDocument()
  })

  it('hides every icon from assistive tech', () => {
    renderAt(['/entry/abc'])
    const svgs = document.querySelectorAll('svg')
    expect(svgs).toHaveLength(2)
    for (const svg of svgs) expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(backButton()).toHaveAttribute('title', '返回')
  })

  it.each([['/entry/new'], ['/entry/abc']])('goes home from %s via 返回', (start) => {
    renderAt(['/settings', start], 1)
    expect(gear()).toBeInTheDocument()
    expect(help()).toBeInTheDocument()
    fireEvent.click(backButton())
    // Home, not the previous history entry (/settings).
    expect(path()).toBe('/')
  })

  it('hides 設定 on the settings page but keeps 使用說明', () => {
    renderAt(['/settings'])
    expect(gear()).not.toBeInTheDocument()
    expect(help()).toBeInTheDocument()
    expect(backButton()).toBeInTheDocument()
  })

  it('goes home from a directly opened settings page', () => {
    renderAt(['/settings'])
    fireEvent.click(backButton())
    expect(path()).toBe('/')
  })

  it('goes back to the in-app page settings was opened from', () => {
    renderAt(['/entry/abc'])
    fireEvent.click(gear())
    expect(path()).toBe('/settings')
    fireEvent.click(backButton())
    expect(path()).toBe('/entry/abc')
  })

  it.each([['/'], ['/welcome'], ['/nope']])('has no back button on %s', (route) => {
    renderAt([route])
    expect(backButton()).not.toBeInTheDocument()
  })
})

describe('TopBar on the welcome page', () => {
  it('shows only 開始使用 on the right', () => {
    renderAt(['/welcome'])
    expect(start()).toBeInTheDocument()
    expect(gear()).not.toBeInTheDocument()
    expect(help()).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '外語學習日記' })).toBeInTheDocument()
  })

  it('開始使用 records welcomeSeen and goes home', async () => {
    vi.mocked(markWelcomeSeen).mockResolvedValue()
    renderAt(['/welcome'])
    fireEvent.click(start())
    await act(async () => {})
    expect(markWelcomeSeen).toHaveBeenCalledTimes(1)
    expect(path()).toBe('/')
    expect(start()).not.toBeInTheDocument()
  })

  it('still goes home, silently, when saving the setting fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error')
    vi.mocked(markWelcomeSeen).mockRejectedValue(new Error('io'))
    renderAt(['/welcome'])
    fireEvent.click(start())
    await act(async () => {})
    expect(path()).toBe('/')
    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it('saves only once when pressed twice quickly', async () => {
    let resolve
    vi.mocked(markWelcomeSeen).mockReturnValue(new Promise((r) => (resolve = r)))
    renderAt(['/welcome'])
    const button = start()
    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    expect(markWelcomeSeen).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    await act(async () => resolve())
  })

  it('does not navigate if the user already left before the save finished', async () => {
    let resolve
    vi.mocked(markWelcomeSeen).mockReturnValue(new Promise((r) => (resolve = r)))
    renderAt(['/welcome'])
    fireEvent.click(start())
    fireEvent.click(screen.getByRole('link', { name: '離開' }))
    expect(path()).toBe('/other')
    await act(async () => resolve())
    expect(path()).toBe('/other')
  })
})
