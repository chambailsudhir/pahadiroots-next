# Pahadi_AI — migrated to pahadiroots-next

Drop these 3 files into the repo at the **exact same paths** (they either
replace an existing file or are brand new — no other files touched):

| File | Status | What it does |
|---|---|---|
| `public/js/ai-assistant.js` | **NEW** | The widget, copied verbatim (byte-for-byte) from the old site. Self-contained — injects its own CSS/DOM, no other file depends on it. |
| `src/app/api/chat/route.ts` | **NEW** | Next.js App Router port of the old `api/chat.js`. Same logic: Gemini first, Claude (Anthropic) fallback. |
| `src/app/layout.tsx` | **REPLACE** | Added one `<Script>` tag (loads the widget site-wide) + its import. Everything else in the file is unchanged from your current version — diff before overwriting if you've edited layout.tsx since your last upload. |

## Env vars — already confirmed set, no action needed
Checked directly on your `pahadiroots-next` Vercel project via the Vercel
connector: `GEMINI_API_KEY` and `ANTHROPIC_API_KEY` are both already present
for Production/Preview/Development. `/api/chat` will work as soon as this
deploys.

## After you push
1. Merge these 3 files into `chambailsudhir/pahadiroots-next` on GitHub (main branch, or a PR if you prefer review first).
2. Vercel will auto-deploy from the push.
3. Hard-refresh the live URL and confirm the chat bubble + language switcher appear bottom-right, same as the old site.
