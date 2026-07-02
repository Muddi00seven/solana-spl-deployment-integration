/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // ─── Webpack fallbacks ────────────────────────────────────────────────────
  // Some wallet/crypto libraries reference optional Node.js core modules that
  // do NOT exist in the browser. If we don't tell webpack to ignore them, the
  // build fails with "Module not found: Can't resolve 'fs'/'pino-pretty'/...".
  // Setting them to `false` means "pretend this module is empty in the browser".
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
      'pino-pretty': false,
      encoding: false,
    }
    return config
  },
}

export default nextConfig
