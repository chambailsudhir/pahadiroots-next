# Pahadi Roots — SEO playbook (state as of 2026-10-28)

## Already in the codebase (verified by reading the code)
- Per-page `generateMetadata` with canonical URLs, Open Graph and Twitter cards; admin Settings → SEO controls site-wide title/description/OG image/Search Console token.
- JSON-LD: Organization, WebSite + SearchAction, Product (per-variant Offers, SKU, price validity, ratings/reviews when they exist), BreadcrumbList, CollectionPage + ItemList, BlogPosting, FAQPage (blog, contact). Policy fields added in this change: shipping rate and a 2-day return window on every Offer.
- `sitemap.xml` (static pages, products with image entries, collections, regions, blog; /new-arrivals added), `robots.txt`, web manifest, `lang="en-IN"`.
- Faceted/paginated listing URLs are `noindex,follow` with a canonical; private pages (account, cart, checkout, track, wishlist, search) are noindex or disallowed.
- Google Merchant Center feed: `/feeds/google-merchant.xml` (new, hourly cache).

## Owner actions (cannot be done from code)
1. Google Search Console: add the domain property, paste the token in admin Settings → SEO, submit `https://www.pahadiroots.com/sitemap.xml`. Same for Bing Webmaster Tools (import from GSC).
2. Google Merchant Center: create the account, verify and claim the site, add a scheduled feed fetch of `https://www.pahadiroots.com/feeds/google-merchant.xml`, set shipping and return policy to match the policy pages. Free listings need no ad spend.
3. Google Business Profile (if there is a physical address/warehouse) and consistent NAP details.
4. GA4: confirm the tag id is set in admin Settings; mark `purchase` as a key event.
5. After launch, watch Search Console → Pages (indexing) and → Enhancements (Products, Breadcrumbs, FAQ) for errors; check Core Web Vitals after ~28 days of traffic.
6. Content and links (biggest ranking lever): 2–4 blog posts a month on region/ingredient/recipe topics, product pages with unique descriptions, listings on relevant directories, local press and food-blogger reviews.

## Known gaps / follow-ups
- No `@vercel/speed-insights` yet (the package would not install cleanly with the current npm tree); GA4 web-vitals or Vercel's dashboard toggle can cover this.
- `/lab-reports` is `noindex`; consider indexing it once it has enough unique text, since it is a trust signal.
- Product pages hard-code the production origin for canonical/JSON-LD; fine for one domain.
- Shipping/delivery-time schema (`deliveryTime`) is omitted because no verified transit times exist in settings.
