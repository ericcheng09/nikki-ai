// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPagesServer, resolveRequest } from './pages-server.js'

// Each test gets a unique temp folder: <tempRoot>/dist is the served build,
// and files placed next to it in <tempRoot> must never be reachable.
let tempRoot
let dir

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'pages-'))
  dir = join(tempRoot, 'dist')
  mkdirSync(dir)
  writeFileSync(join(dir, 'index.html'), 'INDEX')
  writeFileSync(join(dir, '404.html'), 'NOT-FOUND-APP')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'app.js'), 'JS')
})

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true })
})

describe('resolveRequest', () => {
  it('serves index.html for the base path', () => {
    const r = resolveRequest(dir, '/nikki-ai/')
    expect(r.status).toBe(200)
    expect(r.file).toBe(join(dir, 'index.html'))
    expect(r.headers['Content-Type']).toMatch(/text\/html/)
  })

  it('serves existing files with a content type, ignoring the query string', () => {
    const r = resolveRequest(dir, '/nikki-ai/assets/app.js?v=1')
    expect(r.status).toBe(200)
    expect(r.file).toBe(join(dir, 'assets', 'app.js'))
    expect(r.headers['Content-Type']).toMatch(/javascript/)
  })

  it('answers unknown SPA routes with status 404 and the 404.html body', () => {
    const r = resolveRequest(dir, '/nikki-ai/entry/abc')
    expect(r.status).toBe(404)
    expect(r.file).toBe(join(dir, '404.html'))
  })

  it('redirects the bare base path and directories to their slash form', () => {
    expect(resolveRequest(dir, '/nikki-ai')).toMatchObject({
      status: 301,
      headers: { Location: '/nikki-ai/' },
    })
    expect(resolveRequest(dir, '/nikki-ai/assets')).toMatchObject({
      status: 301,
      headers: { Location: '/nikki-ai/assets/' },
    })
  })

  it('returns 404 for a directory without index.html', () => {
    expect(resolveRequest(dir, '/nikki-ai/assets/').status).toBe(404)
  })

  it('returns 404 outside the base path', () => {
    expect(resolveRequest(dir, '/other/').status).toBe(404)
  })

  it('never serves files outside the build directory', () => {
    const secret = join(tempRoot, 'secret.txt')
    writeFileSync(secret, 'SECRET')
    // A sibling whose name starts with "dist" must not pass a prefix check.
    mkdirSync(join(tempRoot, 'dist-evil'))
    const evil = join(tempRoot, 'dist-evil', 'x.txt')
    writeFileSync(evil, 'EVIL')

    for (const path of [
      '/nikki-ai/../secret.txt',
      '/nikki-ai/%2e%2e/secret.txt',
      // An encoded slash survives URL normalisation and is decoded later.
      '/nikki-ai/..%2fsecret.txt',
      '/nikki-ai/..%2fdist-evil%2fx.txt',
    ]) {
      const r = resolveRequest(dir, path)
      expect(r.status).toBe(404)
      expect([secret, evil]).not.toContain(r.file)
    }
  })

  it('returns 400 for a malformed URL encoding', () => {
    expect(resolveRequest(dir, '/nikki-ai/%E0%A4%A').status).toBe(400)
  })

  it('falls back to a plain 404 when 404.html is missing', () => {
    rmSync(join(dir, '404.html'))
    const r = resolveRequest(dir, '/nikki-ai/missing')
    expect(r).toMatchObject({ status: 404, body: 'Not Found' })
  })
})

describe('createPagesServer', () => {
  let server
  let origin

  beforeEach(async () => {
    server = createPagesServer(dir)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${server.address().port}`
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  it('serves files and the 404 page over HTTP', async () => {
    const ok = await fetch(`${origin}/nikki-ai/`)
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('INDEX')

    const missing = await fetch(`${origin}/nikki-ai/entry/abc`)
    expect(missing.status).toBe(404)
    expect(await missing.text()).toBe('NOT-FOUND-APP')
  })

  it('rejects methods other than GET and HEAD', async () => {
    const res = await fetch(`${origin}/nikki-ai/`, { method: 'POST' })
    expect(res.status).toBe(405)
  })
})
