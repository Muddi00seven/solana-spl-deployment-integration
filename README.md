# SPL Token Studio — Deploy (script) · Integrate (web app)

A **Next.js 14** dapp that **integrates with one already-deployed Solana SPL token**.
The token is created and its supply minted **once** by a command-line deploy script
(`npm run deploy`); the web app then lets a connected wallet **check balance, transfer,
and burn** that same token from the browser using the **Solana Wallet Adapter**
(Phantom / Solflare) — with **no `ethers`, no Reown, no EVM**.

> **The frontend does NOT create or mint tokens.** It binds to the token recorded in
> `deployment.json`. Deploying and minting are one-time authority actions performed by
> the deploy script — the mint authority is the **deployer keypair**, not a connected
> browser wallet, so the browser can't mint new supply anyway.

Everything runs on **Solana devnet**, so it's free and safe to experiment with.

---

## Table of contents

1. [What is an SPL token? (plain English)](#1-what-is-an-spl-token-plain-english)
2. [Key concepts you must know](#2-key-concepts-you-must-know)
3. [What this app does](#3-what-this-app-does)
4. [Project file map](#4-project-file-map)
5. [The full flow: deploy (once) → integrate (web app)](#5-the-full-flow-deploy-once--integrate-web-app)
6. [Run it locally (step by step)](#6-run-it-locally-step-by-step)
7. [How each SPL function works](#7-how-each-spl-function-works)
8. [Wallet connection flow](#8-wallet-connection-flow)
9. [Going to mainnet](#9-going-to-mainnet)
10. [Troubleshooting](#10-troubleshooting)
11. [Glossary](#11-glossary)

---

## 1. What is an SPL token? (plain English)

On Ethereum, a token is a **smart contract** (ERC-20) that you deploy. On Solana it
works differently: you don't deploy your own contract. Instead, there is **one shared
program** on the network called the **SPL Token Program**, and *everybody's* tokens
are created by that same program.

So "creating a token" on Solana means: **asking the SPL Token Program to make a new
"mint" account for you.** That mint account is your token. **SPL** stands for *Solana
Program Library* — the collection of standard on-chain programs, of which the Token
Program is one.

> **EVM comparison:** ERC-20 `deploy contract` ≈ Solana `initialize a mint`.
> One is your own contract; the other is a small account owned by the shared program.

---

## 2. Key concepts you must know

| Concept | What it means |
|--------|----------------|
| **Mint account** | *This is your token.* It stores the token's `decimals`, total supply, and mint authority. Creating a token = creating + initializing a mint. |
| **Associated Token Account (ATA)** | A wallet does **not** hold tokens directly. For each token a wallet owns, a small separate account (the ATA) holds *that wallet's balance of that token*. Its address is derived deterministically from `(wallet, mint)`. |
| **Mint authority** | The wallet allowed to create (mint) new supply. The deploy script sets it to the **deployer keypair** — so minting is a deploy-time action, not a browser one. |
| **Freeze authority** | The wallet allowed to freeze token accounts. Also set to you (can be disabled). |
| **Decimals** | Divisibility. With 9 decimals, `1` whole token = `1,000,000,000` base units. On-chain amounts are always in base units; the UI converts for you. |
| **Rent-exempt deposit** | To keep an account alive on Solana you deposit a little SOL up front (~0.0015 SOL for a mint). |
| **Signature** | A transaction's unique ID. Every action returns one; the app links it to Solana Explorer. |

---

## 3. What this app does

The token itself is deployed **once** by the CLI script (see §6.1). The web app then
**integrates** with that deployed token. It shows the token's details (name, mint
address, decimals, cluster) read from `deployment.json`, and each action button calls
exactly one function in `lib/spl.ts`:

1. **Connect wallet** — Phantom / Solflare, on devnet.
2. **Airdrop devnet SOL** — free gas so you can pay fees. *(devnet only)*
3. **Check balance** — your balance of the deployed token; read-only, free, no popup.
4. **Transfer tokens** — send the deployed token to another wallet (creates their ATA if needed).
5. **Burn tokens** — permanently destroy your own supply of the deployed token.

There are deliberately **no "Create token" or "Mint tokens" buttons** — those are
one-time deploy-script actions (§6.1), not browser actions.

> **Note on the airdrop step:** a devnet **SOL airdrop** button is included because
> without a small amount of SOL for fees the transfer/burn actions can't run. It's
> clearly labeled and devnet-only — remove it before going to mainnet.

---

## 4. Project file map

```
app/
  layout.tsx        → Root layout. Loads Providers via dynamic import (ssr:false)
                      because the wallet adapter is browser-only.
  page.tsx          → Home page. Renders <SplTokenApp/>.
  globals.css       → Tailwind + the wallet-adapter modal stylesheet.

components/
  Providers.tsx     → ConnectionProvider + WalletProvider + WalletModalProvider.
                      This is what makes "Connect Wallet" work everywhere.
  SplTokenApp.tsx   → THE single page. Shows the deployed-token info, connect button,
                      and one panel per integration action (balance/transfer/burn).
                      The mint address + decimals are fixed from deployment.json.

lib/
  solana.ts         → Network config: the devnet Connection + Explorer link helpers.
                      Switch to mainnet here in one line.
  token.ts          → Reads deployment.json and exports DEPLOYED_TOKEN (mint address,
                      decimals, name, cluster). This is the single token the app binds to.
  spl.ts            → The on-chain SPL actions the web app uses, heavily commented:
                      transferTokens, burnTokens, getTokenBalance (+ base-unit helper).
                      No createToken/mintTokens — deploy + mint happen in the script.

scripts/
  deploy-token.mjs  → Standalone CLI deployment: generates/loads a keypair,
                      funds it, creates the mint, mints initial supply, optionally
                      revokes authority, saves deployment.json. Run: npm run deploy
                      Full guide: DEPLOYMENT.md

deployment.json     → The deployed token's record (written by the deploy script).
                      The web app reads its mint address + decimals from here.
next.config.mjs     → Webpack fallbacks so crypto libs build in the browser.
.env.local.example  → Optional custom RPC URL.
```

---

## 5. The full flow: deploy (once) → integrate (web app)

> **Deploy is a one-time command-line step** (`npm run deploy`). The scripted CLI flow
> and the Solana `spl-token` CLI method are documented step-by-step in
> **[DEPLOYMENT.md](./DEPLOYMENT.md)**. After it runs, `deployment.json` holds the
> token's mint address — the web app reads it automatically.

**Deploy + mint initial supply** happen in the script (`scripts/deploy-token.mjs`):

```
Load/generate the deployer keypair (pays fees, becomes mint authority)
   → createMint                     (allocate + initialize the mint on-chain)
      → getOrCreateAssociatedTokenAccount  (deployer's ATA)
         → mintTo                   (mint the initial supply into that ATA)
            → (optional) revoke mint authority  → supply fixed forever
               → write deployment.json  ➜  the token now exists on devnet
```

**Integrate** = the web app's buttons acting on that already-deployed token:

```
Balance  → derive your ATA → getAccount     → read amount    → free, no popup
Transfer → (create recipient ATA if missing) → Transfer       → you sign as owner
Burn     → derive your ATA → Burn             → supply drops   → you sign as owner
```

---

## 6. Run it locally (step by step)

### 6.0 — What do I need to install?

**If you ONLY have Node.js installed, that's almost everything.** Here's exactly
what each path needs:

| You want to… | What you must install |
|--------------|-----------------------|
| **Deploy a token via the script** (`npm run deploy`) | **Nothing extra.** Just Node.js 18+ (20+ recommended) and this project's `npm install`. No wallet, no Solana CLI, no Rust, no pre-existing address. |
| **Use the web app** (`npm run dev`) | Node.js + a **browser wallet extension**: [Phantom](https://phantom.app) or [Solflare](https://solflare.com). Free, 1-click install. |
| **Deploy via the official Solana CLI** (optional, Method B in [DEPLOYMENT.md](./DEPLOYMENT.md)) | The Solana CLI + `spl-token` CLI (and Rust). **Not needed** if you use the script. |

Check your Node version:

```bash
node -v      # should print v18.x or higher (v20+ preferred)
```

If Node is missing or old, install the LTS from <https://nodejs.org>.

> **You do NOT need to create a wallet or address first.** The deploy script
> generates its own keypair and claims its own devnet SOL — see 6.1.

---

### 6.1 — Quick deploy: no address, no wallet needed

This path needs **only Node.js**. The script auto-generates a keypair, auto-claims
free devnet SOL, then deploys the token and mints supply — all by itself.

```bash
# 1. install project dependencies (one time)
npm install

# 2. deploy — this does EVERYTHING automatically:
npm run deploy
```

What `npm run deploy` does, in order, with **zero setup from you**:

1. **Generates a keypair** (a new address + secret key) and saves it to
   `scripts/deployer-keypair.json` (git-ignored — never committed).
2. **Airdrops 1 devnet SOL** to that new address to pay the tiny fees.
3. **Creates the mint** (deploys the token) with your chosen decimals + you as authority.
4. **Creates an ATA** and **mints the initial supply** into it.
5. **Prints the mint address** and saves a full record to `deployment.json`.

You'll end up with output like `👉 mint address: <ADDRESS>`. Copy that address.

> **If the airdrop fails** (the free devnet faucet is sometimes busy/rate-limited):
> the script prints your generated address and stops. Just (a) copy that address,
> (b) claim SOL at <https://faucet.solana.com>, then (c) run `npm run deploy` again —
> now that it has SOL, it deploys straight through.

Options (all optional):

```bash
node scripts/deploy-token.mjs --decimals 6 --supply 1000000000   # custom
node scripts/deploy-token.mjs --revoke                           # lock supply forever
```

---

### 6.2 — Run the web app (integrate: balance / transfer / burn)

> **Deploy first.** The web app binds to the token in `deployment.json`, so you must
> have run `npm run deploy` (§6.1) at least once. This path additionally needs a
> **browser wallet** (Phantom or Solflare).

```bash
# 1. install dependencies (skip if already done above)
npm install

# 2. (optional) custom RPC — the app works without this on public devnet
cp .env.local.example .env.local   # then fill NEXT_PUBLIC_RPC_URL if you have one

# 3. start the dev server
npm run dev
```

Open **http://localhost:3000**. The **Deployed token** panel shows the token's name,
mint address, decimals, and cluster (from `deployment.json`). Then:

1. In your **Phantom** extension → Settings → **Developer Settings** → set network to
   **Devnet**. *(This is essential — a mainnet wallet won't see your devnet token.)*
2. Click **Select Wallet** → connect.
3. Click **Airdrop 1 SOL** (if the built-in faucet is busy, use
   <https://faucet.solana.com> and paste your address).
4. **Check balance** → **Transfer** the token to another address → **Burn** a few.
   Each success shows an Explorer link.

> **How do I get some of the token to test with?** The deploy script minted the initial
> supply to the **deployer's** wallet, not your browser wallet. To try transfer/burn from
> a balance, transfer some of the token from the deployer to your connected wallet (e.g.
> via the deployer keypair), or point the app at a token you deployed to your own wallet.

---

## 7. How each SPL function works

The web-app actions live in `lib/spl.ts`. They receive the `connection`, your wallet
`publicKey`, and the adapter's `sendTransaction` (which pops up Phantom to sign). The
`mintAddress` they operate on is fixed — it comes from `deployment.json` via
`lib/token.ts` (`DEPLOYED_TOKEN`).

- **`transferTokens(...)`** — derives both ATAs, creates the recipient's if missing,
  then `Transfer` from your account. You sign as the owner.
- **`burnTokens(...)`** — `Burn` from your ATA. Reduces total supply permanently.
- **`getTokenBalance(...)`** — read-only. Derives your ATA and reads `.amount`. If the
  account doesn't exist yet, returns `0` (no error).

> **Where are create + mint?** In the deploy script (`scripts/deploy-token.mjs`), which
> runs once from the CLI. They are intentionally **not** in the web app: the mint
> authority is the deployer keypair, so a browser wallet can't mint, and the app's job
> is to integrate with the token that already exists.

**Read vs Write:**
*Read* (balance) touches no wallet, costs nothing, no popup.
*Write* (transfer / burn) needs your signature + a tiny SOL fee, so Phantom pops up each time.

---

## 8. Wallet connection flow

```
User clicks "Select Wallet"
  → WalletModalProvider shows the wallet list (Phantom, Solflare)
    → user picks Phantom → Phantom asks to approve the connection
      → app receives your public key
        → app reads your SOL balance
          → all the SPL panels become usable
```

`components/Providers.tsx` supplies all of this; it's loaded with
`dynamic(..., { ssr: false })` in `app/layout.tsx` because the adapter uses
browser-only APIs (`window`, `localStorage`) that crash during server rendering.

---

## 9. Going to mainnet

1. Deploy the token to mainnet with the script:
   `node scripts/deploy-token.mjs --cluster mainnet-beta --keypair <your-funded-keypair>`
   This rewrites `deployment.json`, so the web app automatically binds to the new token.
2. In `lib/solana.ts`, change `CLUSTER` from `'devnet'` to `'mainnet-beta'` so the
   Explorer links and RPC point at mainnet.
3. Set a real paid RPC in `.env.local` (`NEXT_PUBLIC_RPC_URL`) — the public endpoint
   is heavily rate-limited.
4. **Remove the Airdrop panel** in `SplTokenApp.tsx` — there is no airdrop on mainnet;
   you must fund the wallet with real SOL.
5. Switch your Phantom wallet back to **Mainnet**.
6. Every action now costs **real SOL**. Test thoroughly on devnet first.

---

## 10. Troubleshooting

| Problem | Fix |
|--------|------|
| **Airdrop fails / "429"** | The devnet faucet is rate-limited. Use <https://faucet.solana.com>. |
| **"Attempt to debit an account but found no record of a prior credit"** | Your wallet has 0 SOL. Airdrop first. |
| **Balance shows 0 / transfer says insufficient** | The initial supply was minted to the **deployer**, not your browser wallet. Transfer some of the token to your connected wallet first. |
| **Token panel is empty / wrong token** | The app reads `deployment.json`. Run `npm run deploy` first (or re-run it) so that file exists and points at your token. |
| **`window is not defined` / build crash** | Providers must be imported with `dynamic(..., { ssr:false })` (already done in `layout.tsx`). |
| **`Module not found` during build** | Add the missing module to `resolve.fallback` in `next.config.mjs` as `false`. |
| **Recipient can't see received tokens** | They may need to add the mint address as a custom token in their wallet; the ATA still holds the balance on-chain. |
| **Transfer/burn says insufficient funds** | You're trying to move more tokens than your balance. Check balance first. |

---

## 11. Glossary

- **SPL** — Solana Program Library; the standard on-chain programs. The **Token
  Program** is the one that runs all SPL tokens.
- **Mint** — the account that *is* your token (decimals, supply, authority).
- **ATA (Associated Token Account)** — a wallet's balance-holding account for one
  specific token.
- **Mint authority** — who can create new supply.
- **Freeze authority** — who can freeze token accounts.
- **Decimals** — how divisible a token is (base units = amount × 10^decimals).
- **Lamports** — the smallest unit of SOL (1 SOL = 1,000,000,000 lamports).
- **Rent-exempt** — the up-front SOL deposit that keeps an account alive.
- **RPC endpoint** — the URL your app uses to read/write the blockchain.
- **Signature** — a transaction's unique ID (viewable on Solana Explorer).
- **Devnet vs Mainnet-beta** — free test network vs the real, money network.
- **Wallet Adapter** — Solana's official library for connecting wallets in a dapp.

---

Built with Next.js 14 (App Router), TypeScript, Tailwind, `@solana/web3.js`,
`@solana/spl-token`, and `@solana/wallet-adapter-*`. Devnet by default.
