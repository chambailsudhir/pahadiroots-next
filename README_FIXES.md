# Pahadi_AI — 3 fixes (Sept 2026)

Only **1 file changed**: `public/js/ai-assistant.js` — replace it at the same
path (`public/js/ai-assistant.js` in `pahadiroots-next`). No other file
touched, so nothing else needs re-diffing.

## 1. Language search + reordering — done
- Added a search box inside the language dropdown (type "kangri", "pun",
  "हिंदी", etc. to filter instantly; group headers hide themselves when
  empty; "No language found" shows if nothing matches).
- Reordered the list per your priority: **⭐ Recommended (Kangri Pahari →
  Hindi → English)** shown first, then **more Indian languages**, then
  **other Pahadi bolis / Northeast India**, then **🌍 Global Languages last**.
- Removed two duplicate entries (Assamese and Manipuri were listed twice in
  the old file — harmless but sloppy).

## 2. Kangri answering Punjabi-flavored — partially done, need your word doc
What I did now (no vocabulary file needed for this part):
- Made थुआड़ा the required word for "तुम्हारा" and explicitly banned तुहाड़ा
  (flagged as Punjabi, not Kangri) — that was the exact word visible in your
  screenshot's reply.
- Added a dedicated "DIALECT PURITY" block to the system prompt naming
  specific Punjabi words/phrases the model must never substitute in Kangri
  replies (ਕੀ ਹਾਲ ਏ, ਤੁਹਾਨੂੰ, ਸਤ ਸ੍ਰੀ ਅਕਾਲ, etc.) with the correct Kangri
  equivalent next to each, and telling it to fall back to plain Hindi rather
  than guess a Punjabi-sounding word when unsure.

**What I still need from you:** you mentioned a Word doc with your own long
Kangri vocabulary list. Please upload it — I'll merge it into the system
prompt's word list precisely rather than guess at spellings/meanings myself
(that's the only way to actually get 100% authentic per your source, and I'd
rather ask than risk introducing more wrong words). Once I have it I'll
replace/extend the existing "AUTHENTIC KANGRI WORD LIST" block with it.

## 3. Overlapping buttons — done
Root cause: `pahadiroots-next`'s mobile bottom nav (`MobileBottomNav.tsx`)
already has its own WhatsApp "Chat" tab and its own floating scroll-to-top
button (`.stt-btn` in `globals.css`) — the widget's *own* floating WhatsApp
button and AI avatar bubble were landing directly on top of both.
- **Removed** the widget's own floating WhatsApp button entirely (kept the
  one your site's bottom nav already provides — no more duplicate).
- **Repositioned** the AI chat bubble to stack cleanly above the site's
  scroll-to-top button and bottom nav on both mobile (≤900px) and desktop,
  using the exact same spacing formula as `globals.css` so it can't drift
  out of sync later. The chat panel and its "toast" notification were moved
  up to match.

`node -c` (syntax) and project-wide `tsc --noEmit` are both clean — this is
a plain JS file so tsc doesn't type-check it directly, but nothing else in
the project was touched.
