// Shared cookie name constants — imported by API routes
// NOT exported from any route.ts file (Next.js disallows non-handler exports)
export const COOKIE_TOKEN   = 'pr_token'
export const COOKIE_REFRESH = 'pr_refresh'

// Short-lived (10 min) HttpOnly cookie holding the PKCE code_verifier of the Google sign-in that THIS
// browser started (set by `google_oauth`, consumed once by `google_callback`). It is what binds an
// OAuth return to the browser that initiated it — login-CSRF / session-fixation defence.
export const COOKIE_OAUTH_VERIFIER = 'pr_oauth_pkce'
export const OAUTH_VERIFIER_MAX_AGE_SEC = 10 * 60
