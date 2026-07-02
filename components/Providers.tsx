'use client'

// ─── Wallet Adapter Providers ───────────────────────────────────────────────
// These three providers, nested in this exact order, are what make "Connect
// Wallet" work anywhere in the app:
//
//   ConnectionProvider  → gives every component the RPC `connection` (devnet).
//   WalletProvider      → tracks which wallet is selected/connected + signing.
//   WalletModalProvider → the pretty "Select your wallet" popup + button UI.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from '@solana/wallet-adapter-wallets'

// The wallet-adapter modal + button styles. Importing the CSS here (in a client
// component) reliably resolves the package path — doing it via `@import` of a
// bare specifier in globals.css does not.
import '@solana/wallet-adapter-react-ui/styles.css'

import { RPC_ENDPOINT } from '@/lib/solana'

export function Providers({ children }: { children: ReactNode }) {
  // The list of wallets the modal will offer. Add more adapters here if needed.
  // useMemo so we don't recreate the adapter objects on every render.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  )

  // ── Mount gate ──
  // The wallet adapter uses browser-only APIs (window, localStorage). We only
  // render it AFTER the component has mounted in the browser. This avoids both
  // "window is not defined" during server rendering and React hydration
  // mismatches on the Connect button — without needing `ssr:false` dynamic
  // imports (which are disallowed inside Server Components in Next 14).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      {/* autoConnect: reconnect the last-used wallet automatically on reload. */}
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
