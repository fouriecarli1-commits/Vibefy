import type { NextConfig } from 'next';

/**
 * Security headers are set here rather than in a platform dashboard so that the
 * configuration lives with the code, is reviewed with the code, and is identical
 * in preview and production. We assess other people's headers for a living.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self' https://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Every workspace package, not a hand-kept subset. They ship TypeScript
  // source rather than compiled output, so one that is imported and not listed
  // here fails at build time — and the list drifting behind the imports is a
  // build that breaks on the day a new package is used, not on the day it is
  // added.
  transpilePackages: [
    '@vibefycode/api',
    '@vibefycode/badge',
    '@vibefycode/billing',
    '@vibefycode/copilot',
    '@vibefycode/directory',
    '@vibefycode/engine',
    '@vibefycode/governance',
    '@vibefycode/monitoring',
    '@vibefycode/notify',
    '@vibefycode/policy',
    '@vibefycode/report',
    '@vibefycode/remediation',
    '@vibefycode/rubric',
    '@vibefycode/shared',
    '@vibefycode/trustcheck',
    '@vibefycode/workspace',
  ],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
