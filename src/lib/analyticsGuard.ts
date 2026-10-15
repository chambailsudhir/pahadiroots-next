// ─────────────────────────────────────────────────────────────────────────────
// lib/analyticsGuard.ts
//
// F-01: inline <head> script that runs BEFORE Google Tag Manager / gtag load.
// On /order-success it moves a legacy ?token= out of the URL (into
// sessionStorage, under the same key lib/confirmationToken.ts reads) and
// rewrites the address bar with history.replaceState, so no analytics tag can
// ever observe it. It is a no-op on every other path (the Google sign-in
// callback legitimately uses a `token` parameter and must not be touched).
//
// Kept as a plain string constant so layout.tsx can inline it and a unit test
// can execute it against a fake window.
// ─────────────────────────────────────────────────────────────────────────────

export const ANALYTICS_URL_GUARD_SCRIPT = `(function(){try{var l=window.location;if(l.pathname.indexOf('/order-success')!==0)return;var u=new URL(l.href);var t=u.searchParams.get('token');if(t===null)return;var n=u.searchParams.get('id')||u.searchParams.get('num')||'';if(/^[0-9a-f-]{36}$/i.test(t)&&/^[A-Za-z0-9-]{4,32}$/.test(n)){try{window.sessionStorage.setItem('pr_ct:'+n,t)}catch(e){}}u.searchParams.delete('token');window.history.replaceState(window.history.state,'',u.pathname+u.search+u.hash)}catch(e){}})();`
