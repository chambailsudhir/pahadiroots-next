# Pahadi_AI — round 4 fixes (Sept 2026)

Only **1 file changed**: `public/js/ai-assistant.js` — same path as before.

## 1. Stopped advertising weather/budget/gift capabilities upfront
The welcome message and the underlying capability are two different things
— I only touched the welcome text. The bot can still search live weather
or make budget suggestions if a customer actually asks; it just no longer
lists those in its opening message across all 17 language variants. Every
welcome message now leads with products and closes with delivery/returns,
nothing that pulls attention toward "weather" or "gift ideas."

## 2. Brand name — updated every hardcoded mention
Found and updated 5 places in the system prompt / footer that still said
"5 Pahadi Roots" or "Pahadi Roots": the brand introduction, the
competitor-redirect rule, the tone instruction, and the panel footer text.
The refusal message you screenshotted ("I can only guide you on 5 Pahadi
Roots products...") isn't a fixed template — the model writes it live from
the competitor rule in the system prompt, so updating that rule to say
"HimVeda by Pahadi Roots" fixes it at the source rather than patching one
sentence.

## 3. Both overlaps — root-caused and fixed
- **WhatsApp vs. scroll-to-top**: round 3 restored the WhatsApp button for
  desktop at the same `bottom:24px; right:16px` as your site's own
  scroll-to-top button (`.stt-btn` in `globals.css`) — direct collision.
  Moved WhatsApp to `bottom:78px` (24 + 42 + 12px gap), stacked cleanly
  above it.
- **AI bubble vs. hero carousel arrow**: round 3's "vertical-center" fix
  solved the bottom-nav overlap but created a new one — pahadiroots.com's
  hero banner has its own carousel arrows sitting right at viewport-center
  too. The bubble is now pinned a fixed distance below the header
  (`top: 130px`, via a `--pr-fab-top` CSS variable at the top of the
  stylesheet) instead of `top: 50%`, so it sits in the quieter area right
  under your nav — clear of both the hero carousel *and* the bottom nav.
  If 130px doesn't quite match the height of your header + promo bar
  exactly, that one variable is the only number to nudge — the panel
  position and everything else follows it automatically.

Syntax check, a div open/close balance check (70/70), and a CSS brace
balance check (119/119) all pass. No other file was touched, so no `tsc`
run was needed this round.
