FIX: Removed "Get 5% Off Your First Order" popup (offer not actually
running)

File changed:
  src/app/providers.tsx

What was wrong:
  A global email-capture modal (LeadCapturePopup, mounted app-wide in
  providers.tsx) advertised "Get 5% Off Your First Order" with a
  "Claim My 5% Off" button. Per your instruction, this offer isn't
  actually being run — not a code bug, a real mismatch between what the
  popup promised and what the store offers.

Fix:
  Un-mounted <LeadCapturePopup /> from providers.tsx (removed the import
  and the JSX usage). The component file itself
  (src/components/analytics/LeadCapturePopup.tsx) is left untouched and
  in the repo, so this is a one-line change to bring back if a real
  first-order offer is created later — nothing was deleted, just stopped
  from showing.

  Note: this is separate from the "WELCOME50 - ₹50 off" text in the
  announcement/ticker bar at the very top of the page, which wasn't part
  of what was flagged — left alone. If that one should go too, let me
  know and I'll remove it the same way.

Verification:
  - npx tsc --noEmit -> 0 errors
  - npx eslint (providers.tsx) -> 0 errors
  - npx vitest run (full suite) -> 104 files / 1247 tests passed, 5 skipped
    (unchanged), 0 regressions (no test mounted/asserted on the popup, so
    none needed updating)

Drop-in instructions:
  Replace src/app/providers.tsx in your repo with the file in this zip.
  No other files touched.
