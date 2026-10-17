import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import HomeMenu from './HomeMenu.jsx'

function renderMenu() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <HomeMenu />
              <p>外面</p>
            </>
          }
        />
        <Route path="/settings" element={<p>設定頁</p>} />
        <Route path="/welcome" element={<p>說明頁</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function menuButton() {
  return screen.getByRole('button', { name: '選單' })
}

describe('HomeMenu', () => {
  it('starts closed with an accessible toggle button', () => {
    renderMenu()
    const button = menuButton()
    // Disclosure pattern: no aria-haspopup, only aria-expanded/controls.
    expect(button).not.toHaveAttribute('aria-haspopup')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).not.toHaveAttribute('aria-controls')
    expect(screen.queryByRole('link', { name: '設定' })).not.toBeInTheDocument()
  })

  it('opens to show 設定 and 使用說明 links', () => {
    renderMenu()
    fireEvent.click(menuButton())
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true')
    const listId = menuButton().getAttribute('aria-controls')
    expect(screen.getByRole('list')).toHaveAttribute('id', listId)
    expect(screen.getByRole('link', { name: '設定' })).toHaveAttribute('href', '/settings')
    expect(screen.getByRole('link', { name: '使用說明' })).toHaveAttribute('href', '/welcome')
  })

  it('toggles closed when the button is clicked again', () => {
    renderMenu()
    fireEvent.click(menuButton())
    fireEvent.click(menuButton())
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: '設定' })).not.toBeInTheDocument()
  })

  it('navigates to /settings when 設定 is chosen', () => {
    renderMenu()
    fireEvent.click(menuButton())
    fireEvent.click(screen.getByRole('link', { name: '設定' }))
    expect(screen.getByText('設定頁')).toBeInTheDocument()
  })

  it('navigates to /welcome when 使用說明 is chosen', () => {
    renderMenu()
    fireEvent.click(menuButton())
    fireEvent.click(screen.getByRole('link', { name: '使用說明' }))
    expect(screen.getByText('說明頁')).toBeInTheDocument()
  })

  it('closes after an item is chosen', () => {
    render(
      <MemoryRouter>
        <HomeMenu />
      </MemoryRouter>,
    )
    fireEvent.click(menuButton())
    fireEvent.click(screen.getByRole('link', { name: '設定' }))
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: '設定' })).not.toBeInTheDocument()
  })

  it('closes when clicking outside the menu', () => {
    renderMenu()
    fireEvent.click(menuButton())
    fireEvent.mouseDown(screen.getByText('外面'))
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: '設定' })).not.toBeInTheDocument()
  })

  it('stays open when clicking inside the menu list', () => {
    renderMenu()
    fireEvent.click(menuButton())
    fireEvent.mouseDown(screen.getByRole('link', { name: '設定' }))
    expect(screen.getByRole('link', { name: '設定' })).toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the button', () => {
    renderMenu()
    fireEvent.click(menuButton())
    screen.getByRole('link', { name: '使用說明' }).focus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
    expect(menuButton()).toHaveFocus()
  })

  it('closes when keyboard focus leaves the menu, without moving focus', () => {
    render(
      <MemoryRouter>
        <HomeMenu />
        <button type="button">外面按鈕</button>
      </MemoryRouter>,
    )
    fireEvent.click(menuButton())
    const outside = screen.getByRole('button', { name: '外面按鈕' })
    screen.getByRole('link', { name: '使用說明' }).focus()
    // Simulates Tab past the last item; act() flushes the state update
    // triggered by the native focus change.
    act(() => outside.focus())
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
    expect(outside).toHaveFocus()
  })

  it('stays open while focus moves between the button and items', () => {
    renderMenu()
    menuButton().focus()
    fireEvent.click(menuButton())
    act(() => {
      screen.getByRole('link', { name: '設定' }).focus()
      screen.getByRole('link', { name: '使用說明' }).focus()
      menuButton().focus()
    })
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true')
  })

  it('stays open when focus is lost without a new target', () => {
    renderMenu()
    fireEvent.click(menuButton())
    screen.getByRole('link', { name: '設定' }).focus()
    // e.g. Safari click on a non-focusable spot or window blur.
    act(() => screen.getByRole('link', { name: '設定' }).blur())
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true')
  })

  it('ignores other keys while open', () => {
    renderMenu()
    fireEvent.click(menuButton())
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true')
  })
})
