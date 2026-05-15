/** @type {import('next').NextConfig} */
const path = require('path');

// FIX-A2: Enterprise security headers
// Admin panel must be completely locked down — no indexing, no caching,
// no clickjacking, no MIME sniffing, strict CSP, strict referrer.
const SECURITY_HEADERS = [
  // Prevent search engines and AI crawlers from indexing the admin panel
  { key: 'X-Robots-Tag',           value: 'noindex, nofollow, noarchive, nosnippet' },
  // Force all admin responses to bypass CDN/proxy caches
  { key: 'Cache-Control',          value: 'no-store, no-cache, must-revalidate, private' },
  // Block clickjacking / iframe embedding completely
  { key: 'X-Frame-Options',        value: 'DENY' },
  // Stop browsers from MIME-sniffing responses (prevents content-type confusion attacks)
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Don't leak referrer URL to external sites when admin links out
  { key: 'Referrer-Policy',        value: 'no-referrer' },
  // Force HTTPS for 1 year; include subdomains
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // Disable browser features that admin panel doesn't need
  { key: 'Permissions-Policy',     value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // Content Security Policy: only allow resources from self + Supabase + Resend CDN
  // NOTE: update the supabase host if your project URL changes
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js dev needs unsafe-eval; tighten in prod
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://*.supabase.co https://pahadiroots.com",
      "connect-src 'self' https://*.supabase.co https://api.anthropic.com https://api.resend.com",
      "media-src 'self' blob: https://*.supabase.co",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig = {
  webpack: (config) => {
    config.resolve.alias['@'] = path.join(__dirname, 'src');
    return config;
  },
  async headers() {
    return [
      {
        // Apply security headers to all admin routes + API routes
        source: '/(admin|api)/:path*',
        headers: SECURITY_HEADERS,
      },
      {
        // Also apply to admin root
        source: '/admin',
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

module.exports = nextConfig;
