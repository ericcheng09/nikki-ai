import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PRIVACY_POLICY_URL } from './privacyPolicy.js'

describe('PRIVACY_POLICY_URL', () => {
  it('points to privacy.html under the base path', () => {
    // Vitest runs with base "/"; the build uses "/nikki-ai/" (checked by
    // the E2E deploy tests against dist/).
    expect(PRIVACY_POLICY_URL).toBe(`${import.meta.env.BASE_URL}privacy.html`)
    expect(PRIVACY_POLICY_URL.endsWith('/privacy.html')).toBe(true)
  })

  it('is an absolute path, not relative to the current App route', () => {
    // A relative "privacy.html" would break on /nikki-ai/entry/<id>.
    expect(PRIVACY_POLICY_URL.startsWith('/')).toBe(true)
  })
})

describe('public/privacy.html', () => {
  const html = readFileSync(resolve(__dirname, '../../public/privacy.html'), 'utf8')

  it('is a standalone Chinese page with an English section', () => {
    expect(html).toMatch(/^<!doctype html>/i)
    expect(html).toContain('<html lang="zh-Hant">')
    expect(html).toContain('<title>隱私權政策 - 外語學習日記</title>')
    expect(html).toContain('<section id="en" lang="en"')
    expect(html.indexOf('隱私權政策：外語學習日記')).toBeLessThan(html.indexOf('Privacy Policy'))
  })

  it('links back to the App and to GitHub Issues', () => {
    expect(html).toContain('<a href="./">回到 App</a>')
    expect(html).toContain('href="https://github.com/ericcheng09/nikki-ai/issues"')
  })

  it('loads no external resources and needs no JavaScript', () => {
    expect(html).not.toMatch(/<script\b/i)
    expect(html).not.toMatch(/<link\b/i)
    expect(html).not.toMatch(/\bsrc=/i)
    expect(html).not.toMatch(/@import|url\(/i)
  })
})
