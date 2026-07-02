import type { Config } from 'tailwindcss'

// Tailwind scans these files for class names so it only ships the CSS you use.
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Solana brand-ish gradient colors, used in the UI.
        solpurple: '#9945FF',
        solgreen: '#14F195',
      },
    },
  },
  plugins: [],
}

export default config
