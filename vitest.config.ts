import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
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
      ],
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
