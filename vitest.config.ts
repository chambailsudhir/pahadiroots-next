import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  // PERF-ROUND ADDITION: tsconfig.json sets "jsx": "preserve" (Next.js's SWC
  // compiler does the JSX transform for the actual app build — verified via
  // `npm run build`, unaffected by this file). Vitest's default oxc-based
  // transform reads that same tsconfig setting, so any .tsx file containing
  // JSX (including component source files merely *imported* by a test, even
  // if the test itself has no JSX) fails with "Unexpected JSX expression" /
  // "vite:import-analysis ... contains invalid JS syntax". This previously
  // limited tests to .ts files with no JSX (hooks/stores/services).
  //
  // `oxc: false` + `esbuild.jsx: 'automatic'` overrides this for the TEST RUN
  // ONLY — it does not change tsconfig.json or the Next.js build pipeline —
  // and unblocks component-level render tests (e.g.
  // CartDrawer.itemMemo.test.ts) that import .tsx components directly.
  esbuild: {
    // @ts-expect-error — under Vite 8's oxc pipeline, `esbuild` is not an
    // installed dependency, so Vite's `ESBuildOptions` type (which extends
    // `esbuild.TransformOptions`) can't resolve `jsx` as a known property
    // here. The option is still read and honoured at runtime once oxc is
    // disabled below — without it, .tsx imports fail to parse (see comment
    // above).
    jsx: 'automatic',
  },
  oxc: false,
  test: {
    // Default environment is node. Individual test files can override with
    // the `// @vitest-environment jsdom` file-level directive when they need
    // a browser-like context (e.g. renderHook tests for useCartPage).
    environment: 'node',
    globals: true,
    // BUG FIX: Playwright e2e specs in e2e/ were picked up by Vitest because
    // no exclude pattern was set. Playwright's test.describe() is incompatible
    // with Vitest's runner — each spec errored at the file-import stage with
    // "Playwright Test did not expect test.describe() to be called here."
    // Result: 5 file-level errors despite all 567 unit tests passing.
    // Fix: exclude the e2e/ directory from Vitest's glob entirely.
    // Playwright is run separately via `npx playwright test` (or the e2e CI job).
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'e2e/**',
    ],
    environmentOptions: {
      jsdom: {
        url: 'http://localhost:3000',
      },
    },
    // Mock modules that only work in Next.js / browser contexts
    server: {
      deps: {
        // Treat these as external so they resolve without the actual Next.js runtime
        inline: [/^(?!next).*/],
      },
    },
    // Stub Next.js-only packages that vitest can't resolve
    alias: {
      'server-only': path.resolve(__dirname, './src/__tests__/__mocks__/server-only.ts'),
    },
    coverage: {
      provider: 'v8',
      include: [
        'src/lib/services/pricingService.ts',
        'src/lib/utils.ts',
        'src/store/cartStore.ts',
        // ── Payment & order routes (previously uncovered — audit gap closed) ──
        'src/app/api/v1/payments/route.ts',
        'src/app/api/v1/orders/route.ts',
        'src/app/api/health/route.ts',
        'src/lib/services/inventoryService.ts',
        'src/hooks/useCartPage.ts',
        // ── Email dead-letter queue (audit gap closed) ──
        'src/lib/server/email.ts',
        'src/app/api/v1/cron/retry-failed-emails/route.ts',
      ],
      // BUG FIX: no thresholds were set — a PR that deleted tests or removed a
      // file from include would silently drop coverage to 0% without failing CI.
      // These floors match current levels; raise them as the suite grows.
      //   lines/functions/statements: 70% — core cart + pricing is well covered.
      //   branches: 60% — some error paths remain deliberately untested.
      thresholds: {
        lines:      70,
        functions:  70,
        statements: 70,
        branches:   60,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Stub Next.js-only packages so vitest can import route files
      'server-only': path.resolve(__dirname, './src/__tests__/__mocks__/server-only.ts'),
    },
  },
})
