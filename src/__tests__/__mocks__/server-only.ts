// Stub for 'server-only' — prevents build-time guard from breaking vitest runs.
// In production Next.js, this package throws if imported in a client bundle.
// In vitest (Node.js), we just export nothing — the import is a no-op.
export {}
