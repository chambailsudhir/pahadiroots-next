# Pahadi_AI — round 3 fixes (Sept 2026)

Only **1 file changed**: `public/js/ai-assistant.js` — replace it at the same
path. Nothing else touched.

## 1. Broken panel (blank green strip) — root cause found & fixed
When I added the language search box, I nested it one level deeper
(`pr-lang-search-wrap` + `pr-lang-list` inside `pr-lang-menu`) but forgot to
add one more closing `</div>` at the end of that block. That left the
widget's header row (`.pr-hd`) unclosed in the HTML, so everything after it —
the chips, the whole message list, the input box — ended up nested *inside*
the green header bar instead of below it. That's exactly the broken layout
in your screenshot (thin green strip + big blank area + squeezed controls
at the bottom). Added the missing `</div>`; verified programmatically that
every `<div>` now has a matching `</div>` in the panel's HTML (70/70).

## 2. Moved like mypahadidukan.com
The AI bubble is no longer pinned to the bottom corner. It's now parked at
the **vertical middle of the right edge** (`top:50%`), same idea as the
"Need Help?" pill on mypahadidukan.com. Same for the chat panel — it now
opens beside the bubble, vertically centered, instead of popping up from
the bottom. This also fixes the overlap problem at the root: since neither
the bubble nor the panel touches the bottom of the screen anymore, they
can never collide with your bottom nav or scroll-to-top button, on any
screen size — no more fragile "stack it 126px above the nav" math needed.

## 3. Kangri dictionary — replaced with the actual book, and found a bug
I went through your `हिमाचली कांगड़ी शब्दावली` PDF page by page and rebuilt
the word list from scratch, matched to the book exactly.

**What I found while doing this: the old embedded word list was corrupted.**
Its word/meaning pairs had gotten scrambled — e.g. it had an entry
"अक्रामक = होकर मुट्ठी बंद कर किसी पर" as if अक्रामक were a Kangri word
meaning that, when actually "अक्रामक होकर मुट्ठी बंद कर किसी पर प्रहार करना"
is the *meaning* of a completely different word (घसुन्न). That kind of
scrambling was scattered throughout — which is a very plausible reason the
bot's answers felt "off." The new list is transcribed straight from your
book's own word→meaning pairs, with nothing reordered.

I also kept and tightened the earlier "DIALECT PURITY" guardrail (bans
Punjabi lookalikes like तुहाड़े, requires थुआड़ा) and added a note next to
तुहाड़ा in the new list itself flagging it as the Punjabi-leaning form.

One thing to know: this made the file noticeably bigger (~2,000 dictionary
entries). It's still just one static JS file, so it doesn't affect load
speed, but flagging it since it's a real jump in size.

## 4. WhatsApp missing on desktop — root cause found & fixed
Your last round's fix removed the widget's own WhatsApp button entirely,
reasoning that the mobile bottom nav already has one. That part was right
for mobile — but `MobileBottomNav.tsx` is **mobile-only**
(`display:none` above 900px in `globals.css`), so desktop was left with
*no* WhatsApp entry point at all. Restored the widget's WhatsApp button,
but now scoped with `@media(min-width:901px)` so it only shows on desktop —
mobile still relies solely on the bottom nav's own "Chat" tab, so there's
still no duplicate.

`node -c` (syntax), a div-balance check, a CSS brace-balance check, and
project-wide `tsc --noEmit` are all clean.
