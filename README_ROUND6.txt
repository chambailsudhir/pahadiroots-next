PAHADI ROOTS, ROUND 6 (25 Oct 2026). Contains everything from rounds 4 and 5 (newer files replace older ones).
DATABASE: already live (076 to 086). Nothing to run.
DEPLOY: copy admin/ into pahadi-admin and storefront/ into pahadiroots-next (same paths), push, deploy both.

NEW IN THIS ROUND
1. Orders page: a banner for open orders older than the selected date range (they were invisible), with a link to the last 1 year.
2. Profit page: packaging, logistics and gateway fee are a shared owner only setting (private table finance_config).
3. GST page: months follow the invoice date (order date), seller state from Settings.
4. Inventory: a damaged return no longer reduces sellable stock again (migration 083).
5. Data: 5 test orders hidden (17,18,28,29,30), 2 stuck orders cancelled (129,137), test orders 59 and 62 hidden.
TESTS: admin 1841 pass, storefront 1940 pass.
