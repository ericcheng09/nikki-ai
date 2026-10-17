// Minimal static server that mimics GitHub Pages for E2E tests against the
// production build. Unlike `vite preview`, it does NOT fall back to
// index.html: unknown paths get status 404 with dist/404.html as the body,
// exactly like Pages, so the 404.html SPA fallback is really exercised.
//
// Usage: node scripts/pages-server.js [--port 5199] [--dir dist]
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const BASE = '/nikki-ai/'

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

function isFile(path) {
  return existsSync(path) && statSync(path).isFile()
}

function isDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory()
}

// Decides the response for a request path. Pure (apart from reading the
// file system) so it can be unit-tested without opening a socket.
// Returns { status, headers, file? , body? }.
export function resolveRequest(rootDir, rawPath) {
  const root = resolve(rootDir)
  let pathname
  try {
    pathname = decodeURIComponent(new URL(rawPath, 'http://x').pathname)
  } catch {
    return { status: 400, headers: { 'Content-Type': 'text/plain' }, body: 'Bad Request' }
  }

  // Pages redirects the bare repo path to its trailing-slash form.
  if (pathname === BASE.slice(0, -1)) {
    return { status: 301, headers: { Location: BASE } }
  }

  const notFound = () => {
    const page = join(root, '404.html')
    return isFile(page)
      ? { status: 404, headers: { 'Content-Type': CONTENT_TYPES['.html'] }, file: page }
      : { status: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not Found' }
  }

  if (!pathname.startsWith(BASE)) return notFound()

  const target = resolve(root, '.' + sep + pathname.slice(BASE.length))
  // Never serve anything outside the build directory (e.g. "/../").
  if (target !== root && !target.startsWith(root + sep)) return notFound()

  if (isDirectory(target)) {
    // Like Pages: "/dir" redirects to "/dir/", which serves dir/index.html.
    if (!pathname.endsWith('/')) {
      return { status: 301, headers: { Location: pathname + '/' } }
    }
    const index = join(target, 'index.html')
    return isFile(index)
      ? { status: 200, headers: { 'Content-Type': CONTENT_TYPES['.html'] }, file: index }
      : notFound()
  }

  if (isFile(target)) {
    const type = CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream'
    return { status: 200, headers: { 'Content-Type': type }, file: target }
  }

  return notFound()
}

export function createPagesServer(rootDir) {
  return createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }
    const result = resolveRequest(rootDir, req.url ?? '/')
    const body = result.file ? readFileSync(result.file) : (result.body ?? '')
    res.writeHead(result.status, result.headers)
    res.end(req.method === 'HEAD' ? undefined : body)
  })
}

function readArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = resolve(readArg('dir', 'dist'))
  const port = Number(readArg('port', '5199'))
  if (!isFile(join(dir, 'index.html'))) {
    console.error(`${dir}/index.html not found; run "npm run build" first.`)
    process.exit(1)
  }
  createPagesServer(dir).listen(port, () => {
    console.log(`GitHub Pages mock: http://localhost:${port}${BASE} (serving ${dir})`)
  })
}
