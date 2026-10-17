// Copies dist/index.html to dist/404.html after `vite build`.
// GitHub Pages serves 404.html for unknown paths, so a page reload on a
// client-side route such as /nikki-ai/entry/<id> still loads the SPA
// (spec 2.3). Plain Node so it works on every OS (no shell `cp`).
import { copyFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function copyIndexTo404(distDir) {
  const index = join(distDir, 'index.html')
  if (!existsSync(index)) {
    throw new Error(`${index} not found; run vite build first`)
  }
  copyFileSync(index, join(distDir, '404.html'))
}

// Run only when executed directly (`node scripts/copy-404.js`), not on import.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  copyIndexTo404(resolve('dist'))
}
