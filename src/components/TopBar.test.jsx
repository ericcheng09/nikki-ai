import { act, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import TopBar from './TopBar.jsx'
import { fakeSyncEngine } from '../testUtils/fakeSyncEngine.js'
import { markWelcomeSeen } from '../storage/connection.js'

vi.mock('../storage/connection.js', () => ({
  markWelcomeSeen: vi.fn(),
}))

// Shows the current path, plus an in-app link for leaving a page.
function Probe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <p data-testid="path">{location.pathname}</p>
      <p data-testid="search">{location.search}</p>
      <Link to="/other">離開</Link>
      {/* Mimics DiaryEditor after creating an entry. */}
      <button type="button" onClick={() => navigate('/entry/created', { replace: true })}>
        儲存後
      </button>
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
const search = () => screen.getByTestId('search').textContent
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

  it.each([['/entry/new'], ['/entry/abc']])('goes back to the previous in-app page from %s', (start) => {
    renderAt(['/?month=2026-10&date=2026-10-18', start], 1)
    expect(gear()).toBeInTheDocument()
    expect(help()).toBeInTheDocument()
    fireEvent.click(backButton())
    // The previous page, query included (the calendar selection survives).
    expect(path()).toBe('/')
    expect(search()).toBe('?month=2026-10&date=2026-10-18')
  })

  it.each([['/entry/new'], ['/entry/abc']])('goes home from a directly opened %s', (start) => {
    renderAt([start])
    fireEvent.click(backButton())
    expect(path()).toBe('/')
    expect(search()).toBe('')
  })

  it('goes back past a replaced entry page to the page before 新增日記', () => {
    renderAt(['/?date=2026-10-18', '/entry/new'], 1)
    // The editor replaces /entry/new with the created entry.
    fireEvent.click(screen.getByRole('button', { name: '儲存後' }))
    expect(path()).toBe('/entry/created')
    fireEvent.click(backButton())
    expect(path()).toBe('/')
    expect(search()).toBe('?date=2026-10-18')
  })

  it('goes home when the first page of the session was replaced (history index 0)', () => {
    // BrowserRouter keeps the entry index in history.state; a replace from
    // the first page keeps idx 0 although the key changes.
    window.history.replaceState({ idx: 0 }, '')
    try {
      renderAt(['/entry/new'])
      fireEvent.click(screen.getByRole('button', { name: '儲存後' }))
      fireEvent.click(backButton())
      expect(path()).toBe('/')
    } finally {
      window.history.replaceState(null, '')
    }
  })

  it('uses history when history.state.idx is above 0', () => {
    window.history.replaceState({ idx: 1 }, '')
    try {
      renderAt(['/?month=2026-09', '/entry/abc'], 1)
      fireEvent.click(backButton())
      expect(search()).toBe('?month=2026-09')
    } finally {
      window.history.replaceState(null, '')
    }
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

describe('TopBar sync status', () => {
  function renderWith(engine, path = '/') {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <TopBar engine={engine} />
      </MemoryRouter>,
    )
  }
  const cloud = () => screen.queryByRole('link', { name: /^同步狀態：/ })

  it('shows no cloud while signed out', () => {
    renderWith(fakeSyncEngine({ signedIn: false, state: 'idle' }))
    expect(cloud()).not.toBeInTheDocument()
  })

  it('shows no cloud before the first sync starts', () => {
    renderWith(fakeSyncEngine({ signedIn: true, state: 'idle' }))
    expect(cloud()).not.toBeInTheDocument()
  })

  it.each([
    ['syncing', '同步狀態：同步中'],
    ['synced', '同步狀態：已同步'],
    ['error', '同步狀態：同步失敗'],
  ])('%s: a cloud link to settings named %s, left of the gear', (state, name) => {
    renderWith(fakeSyncEngine({ signedIn: true, state }))
    const link = screen.getByRole('link', { name })
    expect(link).toHaveAttribute('href', '/settings')
    expect(link).toHaveAttribute('title', name)
    expect(link).toHaveAttribute('data-sync-state', state)
    expect(link).toHaveClass(`sync-icon-${state}`)
    // Before the gear in the DOM (and so to its left).
    expect(link.compareDocumentPosition(gear()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('draws a different mark for each state', () => {
    const engine = fakeSyncEngine({ signedIn: true, state: 'syncing' })
    renderWith(engine)
    const marks = []
    for (const state of ['syncing', 'synced', 'error']) {
      act(() => engine.set({ state }))
      marks.push(cloud().querySelector('svg').innerHTML)
    }
    expect(new Set(marks).size).toBe(3)
  })

  it('follows status changes and disappears on sign-out', () => {
    const engine = fakeSyncEngine({ signedIn: true, state: 'syncing' })
    renderWith(engine)
    act(() => engine.set({ state: 'synced' }))
    expect(cloud()).toHaveAccessibleName('同步狀態：已同步')
    act(() => engine.set({ signedIn: false, state: 'idle' }))
    expect(cloud()).not.toBeInTheDocument()
  })

  it('is shown on the settings page too, but not on the welcome page', () => {
    const engine = fakeSyncEngine({ signedIn: true, state: 'synced' })
    const { unmount } = renderWith(engine, '/settings')
    expect(cloud()).toBeInTheDocument()
    unmount()
    renderWith(engine, '/welcome')
    expect(cloud()).not.toBeInTheDocument()
  })
})
