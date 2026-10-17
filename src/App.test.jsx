import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App.jsx'

describe('App', () => {
  it('renders the Chinese title on the home route', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('heading', { level: 1, name: '外語學習日記' }),
    ).toBeInTheDocument()
  })

  it('renders no title on an unknown route', () => {
    render(
      <MemoryRouter initialEntries={['/does-not-exist']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })
})
