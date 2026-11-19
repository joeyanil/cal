import type { NextConfig } from 'next'

/**
 * K2 Calendar Engine runs as a first-class subsystem inside the K2 Next.js
 * application — no separate backend, no separate runtime (02_Technology_Architecture.md).
 */

// The browser talks to Supabase directly only to sign in and out, so that one
// address is the only outside place the page is allowed to connect to.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const supabaseOrigin = (() => {
  try {
    return new URL(supabaseUrl).origin
  } catch {
    return ''
  }
})()

// React's development mode needs eval for readable error traces; the real
// (production) site never does, so the strict rule applies there.
const scriptSrc = process.env.NODE_ENV === 'production' ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'"

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js writes small inline scripts and styles into every page.
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin}`.trim(),
  // Nobody may put this site inside another page (clickjacking).
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // Do not announce which framework runs the site.
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Every answer from the API belongs to one signed-in person: never store it.
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ]
  },
}

export default nextConfig
