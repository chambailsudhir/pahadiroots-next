// ─────────────────────────────────────────────────────────────────────────────
// eslint.config.js
//
// BUG FIX (Next.js 16 / ESLint 9 migration): this project never had an
// ESLint config file — `next lint` (pre-16) auto-applied eslint-config-next
// via its own legacy .eslintrc resolution under ESLint 8. ESLint 9 requires
// the new "flat config" format (eslint.config.js) and dropped automatic
// .eslintrc support entirely, so `npx eslint .` failed outright with
// "ESLint couldn't find an eslint.config.(js|mjs|cjs) file."
//
// eslint-config-next@16 ships its rules as a flat-config array, so this file
// is intentionally minimal — just spread the preset and ignore build output.
// ─────────────────────────────────────────────────────────────────────────────
const nextConfig = require('eslint-config-next')

module.exports = [
  {
    ignores: ['.next/**', 'node_modules/**', 'dist/**', 'coverage/**'],
  },
  ...nextConfig,
]
