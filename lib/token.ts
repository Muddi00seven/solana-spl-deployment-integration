// ─── The deployed token ──────────────────────────────────────────────────────
// The web app integrates with ONE specific token: the one that was already
// deployed on-chain by `npm run deploy` (see scripts/deploy-token.mjs). Its full
// record lives in deployment.json — this module surfaces the fields the UI needs.
//
// There is deliberately NO "create token" or "mint token" flow in the browser:
//   • The token already exists on-chain (deployed by the script).
//   • Its mint authority is the DEPLOYER keypair, not a random connected wallet,
//     so a browser wallet could not mint new supply even if we asked it to.
//
// To point the app at a different token, re-run `npm run deploy` (which rewrites
// deployment.json) — no code change needed here.

import deployment from '@/deployment.json'

export const DEPLOYED_TOKEN = {
  /** Human-readable token name from the deployment record. */
  name: deployment.name,
  /** The mint account address — this IS the token. */
  mintAddress: deployment.mintAddress,
  /** Divisibility (base units = amount × 10^decimals). */
  decimals: deployment.decimals,
  /** Cluster the token was deployed to ('devnet' | 'mainnet-beta' | …). */
  cluster: deployment.cluster,
  /** Wallet that holds mint authority (the deployer) — cannot mint from the UI. */
  mintAuthority: deployment.mintAuthority,
  /** Pre-built Solana Explorer links for the mint + deployer. */
  explorer: deployment.explorer,
} as const
