# SPL Token Studio — Create · Deploy · Integrate

A single-page **Next.js 14** dapp that takes you through the *entire* lifecycle of a
Solana **SPL token** — creating (deploying) it on-chain, then calling every core
token function from the browser using the **Solana Wallet Adapter** (Phantom /
Solflare), with **no `ethers`, no Reown, no EVM**.

Everything runs on **Solana devnet**, so it's free and safe to experiment with.

---

## Table of contents

1. [What is an SPL token? (plain English)](#1-what-is-an-spl-token-plain-english)
2. [Key concepts you must know](#2-key-concepts-you-must-know)
3. [What this app does](#3-what-this-app-does)
4. [Project file map](#4-project-file-map)
5. [The full flow: create → deploy → integrate](#5-the-full-flow-create--deploy--integrate)
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
| **Mint authority** | The wallet allowed to create (mint) new supply. This app sets it to *you*. |
| **Freeze authority** | The wallet allowed to freeze token accounts. Also set to you (can be disabled). |
| **Decimals** | Divisibility. With 9 decimals, `1` whole token = `1,000,000,000` base units. On-chain amounts are always in base units; the UI converts for you. |
| **Rent-exempt deposit** | To keep an account alive on Solana you deposit a little SOL up front (~0.0015 SOL for a mint). |
| **Signature** | A transaction's unique ID. Every action returns one; the app links it to Solana Explorer. |

---

## 3. What this app does

One page, seven steps, each button calls exactly one function in `lib/spl.ts`:

1. **Connect wallet** — Phantom / Solflare, on devnet.
2. **Airdrop devnet SOL** — free gas so you can pay fees. *(devnet only)*
3. **Create & deploy token** — initialize a new mint; you become the authority.
4. **Mint tokens** — print supply into any wallet (creates its ATA if needed).
5. **Check balance** — read-only, free, no wallet popup.
6. **Transfer tokens** — send to another wallet (creates their ATA if needed).
7. **Burn tokens** — permanently destroy supply.

> **Note on the airdrop step:** you originally asked for the *core* set (create, mint,
> transfer, balance, burn). A devnet **SOL airdrop** button was added on top, because
> without a small amount of SOL for fees none of the other actions can run. It's clearly
> labeled and devnet-only — remove it before going to mainnet.

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
  SplTokenApp.tsx   → THE single page. Connect button, balance, and one panel per
                      SPL function. Each button calls a function from lib/spl.ts.

lib/
  solana.ts         → Network config: the devnet Connection + Explorer link helpers.
                      Switch to mainnet here in one line.
  spl.ts            → EVERY on-chain SPL action, heavily commented:
                      createToken, mintTokens, transferTokens, burnTokens,
                      getTokenBalance (+ base-unit helper).

scripts/
  deploy-token.mjs  → Standalone CLI deployment: generates/loads a keypair,
                      funds it, creates the mint, mints initial supply, optionally
                      revokes authority, saves deployment.json. Run: npm run deploy
                      Full guide: DEPLOYMENT.md

next.config.mjs     → Webpack fallbacks so crypto libs build in the browser.
.env.local.example  → Optional custom RPC URL.
```

---

## 5. The full flow: create → deploy → integrate

> Two ways to deploy: **in the browser** (the "Create token" button, below) or
> **from the command line** (`npm run deploy`). The scripted CLI flow and the
> Solana `spl-token` CLI method are documented step-by-step in
> **[DEPLOYMENT.md](./DEPLOYMENT.md)**.

**Create + Deploy** happen in one transaction (`createToken` in `lib/spl.ts`):

```
Generate a fresh keypair for the mint account
   → SystemProgram.createAccount  (allocate the account, pay rent-exempt SOL)
      → createInitializeMint2Instruction  (set decimals + mint/freeze authority)
         → wallet signs + mint keypair co-signs
            → transaction confirmed  ➜  your token now exists on devnet
```

**Integrate** = the app's other buttons calling the token:

```
Mint     → (create recipient ATA if missing) → MintTo         → you sign as authority
Balance  → derive ATA → getAccount            → read amount    → free, no popup
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

### 6.2 — Run the web app (mint / transfer / burn in the browser)

This path additionally needs a **browser wallet** (Phantom or Solflare).

```bash
# 1. install dependencies (skip if already done above)
npm install

# 2. (optional) custom RPC — the app works without this on public devnet
cp .env.local.example .env.local   # then fill NEXT_PUBLIC_RPC_URL if you have one

# 3. start the dev server
npm run dev
```

Open **http://localhost:3000**, then:

1. In your **Phantom** extension → Settings → **Developer Settings** → set network to
   **Devnet**. *(This is essential — a mainnet wallet won't see your devnet token.)*
2. Click **Select Wallet** → connect.
3. Click **Airdrop 1 SOL** (if the built-in faucet is busy, use
   <https://faucet.solana.com> and paste your address).
4. Click **Create token** → approve in Phantom. The mint address auto-fills. *(Or
   paste the mint address you got from `npm run deploy` in 6.1.)*
5. **Mint** some tokens to yourself → **Check balance** → **Transfer** to another
   address → **Burn** a few. Each success shows an Explorer link.

---

## 7. How each SPL function works

All live in `lib/spl.ts`. They receive the `connection`, your wallet `publicKey`, and
the adapter's `sendTransaction` (which pops up Phantom to sign).

- **`createToken(...)`** — generates a mint keypair, allocates the account, and
  initializes it with your chosen decimals and you as authority. Returns the mint
  address + signature.
- **`mintTokens(...)`** — derives the recipient's ATA, creates it if missing, then
  `MintTo`. Only the mint authority (you) can do this.
- **`transferTokens(...)`** — derives both ATAs, creates the recipient's if missing,
  then `Transfer` from your account. You sign as the owner.
- **`burnTokens(...)`** — `Burn` from your ATA. Reduces total supply permanently.
- **`getTokenBalance(...)`** — read-only. Derives your ATA and reads `.amount`. If the
  account doesn't exist yet, returns `0` (no error).

**Read vs Write:**
*Read* (balance) touches no wallet, costs nothing, no popup.
*Write* (create / mint / transfer / burn) needs your signature + a tiny SOL fee, so
Phantom pops up each time.

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

1. In `lib/solana.ts`, change `CLUSTER` from `'devnet'` to `'mainnet-beta'`.
2. Set a real paid RPC in `.env.local` (`NEXT_PUBLIC_RPC_URL`) — the public endpoint
   is heavily rate-limited.
3. **Remove the Airdrop panel** in `SplTokenApp.tsx` — there is no airdrop on mainnet;
   you must fund the wallet with real SOL.
4. Switch your Phantom wallet back to **Mainnet**.
5. Every action now costs **real SOL**. Test thoroughly on devnet first.

---

## 10. Troubleshooting

| Problem | Fix |
|--------|------|
| **Airdrop fails / "429"** | The devnet faucet is rate-limited. Use <https://faucet.solana.com>. |
| **"Attempt to debit an account but found no record of a prior credit"** | Your wallet has 0 SOL. Airdrop first. |
| **Token/actions do nothing after create** | Make sure Phantom is on **Devnet**, and that the mint address field is filled. |
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
