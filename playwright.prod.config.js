// E2E against the production build via the GitHub Pages mock server.
// Used by `npm run test:e2e:prod` (which builds first).
import { makeConfig } from './playwright.config.js'

export default makeConfig({ prod: true })
