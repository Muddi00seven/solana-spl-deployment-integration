import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/components/Providers'

export const metadata: Metadata = {
  title: 'SPL Token Studio — Create · Deploy · Integrate',
  description:
    'One-page Solana dapp to create an SPL token on devnet and call every token function (mint, transfer, burn, balance).',
}

// `Providers` is a client component ('use client') that only renders its wallet
// context after mounting in the browser — so the wallet adapter's browser-only
// APIs never run during server rendering. That's why we can import it directly
// here without a dynamic `ssr:false` import (which Next 14 disallows inside a
// Server Component like this layout).
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
