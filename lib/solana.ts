// ─── Solana network configuration ──────────────────────────────────────────
// Everything network-related lives here so switching from devnet to mainnet
// later is a ONE-LINE change.

import { clusterApiUrl, Connection, PublicKey } from '@solana/web3.js'

// Which Solana cluster are we on?
// - 'devnet'  → free test network. You can airdrop free SOL. USE THIS for learning.
// - 'mainnet-beta' → the real network. Real SOL, real money. Don't test here.
export const CLUSTER = 'devnet' as const

// The RPC endpoint is the URL your app talks to in order to read/write the
// blockchain. `clusterApiUrl('devnet')` returns Solana's public devnet RPC.
// For production you'd normally use a paid RPC (Helius, QuickNode, etc.) via
// NEXT_PUBLIC_RPC_URL, because the public endpoint is rate-limited.
export const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_URL ?? clusterApiUrl(CLUSTER)

// A single shared Connection object.
// `confirmed` = wait until the transaction is confirmed by the cluster before
// treating it as done. It's a good balance between speed and safety.
export const connection = new Connection(RPC_ENDPOINT, 'confirmed')

// ─── Explorer link helpers ──────────────────────────────────────────────────
// Build a Solana Explorer URL so the UI can show clickable links to a
// transaction signature or an account (mint/wallet) on the correct cluster.

export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER}`
}

export function explorerAddress(address: string | PublicKey): string {
  const value = typeof address === 'string' ? address : address.toBase58()
  return `https://explorer.solana.com/address/${value}?cluster=${CLUSTER}`
}
