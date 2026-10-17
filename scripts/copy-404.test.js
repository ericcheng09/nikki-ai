// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyIndexTo404 } from './copy-404.js'

let dir

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'copy404-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('copyIndexTo404', () => {
  it('creates 404.html with the same content as index.html', () => {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>')
    copyIndexTo404(dir)
    expect(readFileSync(join(dir, '404.html'), 'utf8')).toBe(
      '<!doctype html><div id="root"></div>',
    )
  })

  it('throws when index.html is missing and creates nothing', () => {
    expect(() => copyIndexTo404(dir)).toThrow(/index\.html not found/)
    expect(existsSync(join(dir, '404.html'))).toBe(false)
  })
})
