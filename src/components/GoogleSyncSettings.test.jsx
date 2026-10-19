import { act, fireEvent, render, screen } from '@testing-library/react'
import GoogleSyncSettings from './GoogleSyncSettings.jsx'

const INTRO =
  '登入 Google 後，日記、語言清單、API key 與模型會同步到你 Google Drive 中只有這個 App 看得到的資料夾。'

function deferred() {
  let resolve
  const promise = new Promise((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// Stand-in for the googleAuth module's default instance.
function fakeAuth(status = 'signedOut') {
  const listeners = new Set()
  return {
    getStatus: vi.fn(async () => status),
    onStatusChange: vi.fn((listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    signIn: vi.fn(async () => ({ ok: true })),
    signOut: vi.fn(async () => undefined),
    preload: vi.fn(),
    emit: (next) => listeners.forEach((listener) => listener(next)),
    listenerCount: () => listeners.size,
  }
}

const section = () => screen.getByRole('region', { name: 'Google Drive 同步' })

let consoleSpies
beforeEach(() => {
  consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((name) => vi.spyOn(console, name))
})
afterEach(() => {
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  }
})

describe('GoogleSyncSettings', () => {
  it('shows a loading text first', () => {
    const auth = fakeAuth()
    auth.getStatus.mockReturnValue(new Promise(() => {}))
    render(<GoogleSyncSettings auth={auth} />)
    expect(screen.getByText('載入中…')).toBeInTheDocument()
  })

  it('signed out: explains sync and offers 登入 Google', async () => {
    render(<GoogleSyncSettings auth={fakeAuth()} />)
    expect(await screen.findByRole('button', { name: '登入 Google' })).toBeInTheDocument()
    expect(screen.getByText(INTRO)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '登出' })).not.toBeInTheDocument()
  })

  it('signed in: shows 已登入 and 登出, never an account', async () => {
    render(<GoogleSyncSettings auth={fakeAuth('signedIn')} />)
    expect(await screen.findByText('已登入')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登出' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '登入 Google' })).not.toBeInTheDocument()
    expect(section().textContent).not.toMatch(/@/)
  })

  it('needs re-login: shows the expiry message with 重新登入', async () => {
    render(<GoogleSyncSettings auth={fakeAuth('needsLogin')} />)
    expect(await screen.findByText('Google 登入已過期，請重新登入。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新登入' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登出' })).toBeInTheDocument()
  })

  it('signs in from the click and moves focus to 登出', async () => {
    const auth = fakeAuth()
    render(<GoogleSyncSettings auth={auth} />)
    const button = await screen.findByRole('button', { name: '登入 Google' })
    button.focus()
    fireEvent.click(button)
    expect(await screen.findByText('已登入')).toBeInTheDocument()
    expect(auth.signIn).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '登出' })).toHaveFocus()
  })

  it('shows an error and stays signed out when sign-in fails', async () => {
    const auth = fakeAuth()
    auth.signIn.mockResolvedValue({ ok: false })
    render(<GoogleSyncSettings auth={auth} />)
    const button = await screen.findByRole('button', { name: '登入 Google' })
    button.focus()
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('無法登入 Google，請再試一次。')
    expect(screen.getByText(INTRO)).toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('treats a thrown sign-in error like a failure', async () => {
    const auth = fakeAuth()
    auth.signIn.mockRejectedValue(new Error('boom'))
    render(<GoogleSyncSettings auth={auth} />)
    fireEvent.click(await screen.findByRole('button', { name: '登入 Google' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('無法登入 Google，請再試一次。')
  })

  it('clears the error on the next attempt', async () => {
    const auth = fakeAuth()
    auth.signIn.mockResolvedValueOnce({ ok: false })
    render(<GoogleSyncSettings auth={auth} />)
    fireEvent.click(await screen.findByRole('button', { name: '登入 Google' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '登入 Google' }))
    expect(await screen.findByText('已登入')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('re-login from needsLogin returns to signed in', async () => {
    const auth = fakeAuth('needsLogin')
    render(<GoogleSyncSettings auth={auth} />)
    fireEvent.click(await screen.findByRole('button', { name: '重新登入' }))
    expect(await screen.findByText('已登入')).toBeInTheDocument()
  })

  it('keeps needsLogin with an error when re-login fails', async () => {
    const auth = fakeAuth('needsLogin')
    auth.signIn.mockResolvedValue({ ok: false })
    render(<GoogleSyncSettings auth={auth} />)
    fireEvent.click(await screen.findByRole('button', { name: '重新登入' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('無法登入 Google，請再試一次。')
    expect(screen.getByText('Google 登入已過期，請重新登入。')).toBeInTheDocument()
  })

  it('ignores double clicks while signing in', async () => {
    const auth = fakeAuth()
    const pending = deferred()
    auth.signIn.mockReturnValue(pending.promise)
    render(<GoogleSyncSettings auth={auth} />)
    const button = await screen.findByRole('button', { name: '登入 Google' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await act(async () => pending.resolve({ ok: true }))
    expect(auth.signIn).toHaveBeenCalledTimes(1)
  })

  it('signs out and moves focus to 登入 Google', async () => {
    const auth = fakeAuth('signedIn')
    render(<GoogleSyncSettings auth={auth} />)
    fireEvent.click(await screen.findByRole('button', { name: '登出' }))
    expect(await screen.findByRole('button', { name: '登入 Google' })).toHaveFocus()
    expect(auth.signOut).toHaveBeenCalledTimes(1)
  })

  it('shows an error when signing out fails', async () => {
    const auth = fakeAuth('signedIn')
    auth.signOut.mockRejectedValue(new Error('db'))
    render(<GoogleSyncSettings auth={auth} />)
    fireEvent.click(await screen.findByRole('button', { name: '登出' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('無法登出')
    expect(screen.getByText('已登入')).toBeInTheDocument()
  })

  it('follows status changes from elsewhere (e.g. a failed background renewal)', async () => {
    const auth = fakeAuth('signedIn')
    render(<GoogleSyncSettings auth={auth} />)
    await screen.findByText('已登入')
    act(() => auth.emit('needsLogin'))
    expect(screen.getByText('Google 登入已過期，請重新登入。')).toBeInTheDocument()
  })

  it('starts loading GIS when the section mounts', async () => {
    const auth = fakeAuth()
    render(<GoogleSyncSettings auth={auth} />)
    expect(auth.preload).toHaveBeenCalledTimes(1)
    await screen.findByRole('button', { name: '登入 Google' })
  })

  it('calls signIn synchronously in the click handler', async () => {
    const auth = fakeAuth()
    render(<GoogleSyncSettings auth={auth} />)
    const button = await screen.findByRole('button', { name: '登入 Google' })
    fireEvent.click(button)
    // Checked before any await: the call happens within the user gesture.
    expect(auth.signIn).toHaveBeenCalledTimes(1)
    await screen.findByText('已登入')
  })

  it('announces 需要重新登入 when it arrives while the page is open', async () => {
    const auth = fakeAuth('signedIn')
    render(<GoogleSyncSettings auth={auth} />)
    await screen.findByText('已登入')
    act(() => auth.emit('needsLogin'))
    expect(screen.getByRole('alert')).toHaveTextContent('Google 登入已過期，請重新登入。')
  })

  it('does not raise an alert for 需要重新登入 already shown on page load', async () => {
    render(<GoogleSyncSettings auth={fakeAuth('needsLogin')} />)
    await screen.findByText('Google 登入已過期，請重新登入。')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('unsubscribes on unmount', async () => {
    const auth = fakeAuth()
    const { unmount } = render(<GoogleSyncSettings auth={auth} />)
    await screen.findByRole('button', { name: '登入 Google' })
    expect(auth.listenerCount()).toBe(1)
    unmount()
    expect(auth.listenerCount()).toBe(0)
  })

  it('shows a load error when the state cannot be read', async () => {
    const auth = fakeAuth()
    auth.getStatus.mockRejectedValue(new Error('db'))
    render(<GoogleSyncSettings auth={auth} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('無法讀取設定，請重新整理頁面。')
  })
})
