// The privacy policy is a static page in public/ (docs/decisions.md
// 隱私權政策), not an App route: links to it are plain <a href>, and the
// URL follows vite.config.js `base` instead of hard-coding /nikki-ai/.
export const PRIVACY_POLICY_URL = `${import.meta.env.BASE_URL}privacy.html`
