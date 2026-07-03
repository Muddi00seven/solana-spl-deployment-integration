# SPL Token Studio — Deploy (script) · Integrate (web app)

> **Lecture edition.** This README is written to be taught from, top to bottom.
> It explains the *concepts*, every *package* we install and why, the full
> *deployment* flow (three ways), and the full *integration* flow — with the exact
> commands, files, and functions involved at each step.

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
3. [Packages we use (and why)](#3-packages-we-use-and-why)
4. [What this app does](#4-what-this-app-does)
5. [Project file map](#5-project-file-map)
6. [Architecture: how the pieces talk to each other](#6-architecture-how-the-pieces-talk-to-each-other)
7. [The full flow: deploy (once) → integrate (web app)](#7-the-full-flow-deploy-once--integrate-web-app)
8. [Deployment — step by step](#8-deployment--step-by-step)
9. [Integration — step by step](#9-integration--step-by-step)
10. [How each SPL function works (the code)](#10-how-each-spl-function-works-the-code)
11. [Wallet connection flow](#11-wallet-connection-flow)
12. [Going to mainnet](#12-going-to-mainnet)
13. [Troubleshooting](#13-troubleshooting)
14. [Glossary](#14-glossary)

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
| **Freeze authority** | The wallet allowed to freeze token accounts. Also set to the deployer (can be disabled). |
| **Decimals** | Divisibility. With 9 decimals, `1` whole token = `1,000,000,000` base units. On-chain amounts are always in base units; the UI converts for you. |
| **Rent-exempt deposit** | To keep an account alive on Solana you deposit a little SOL up front (~0.0015 SOL for a mint). |
| **Keypair** | An address (public key) + its secret key. On Solana this is stored as a JSON array of 64 numbers, or exported for wallets as a single **base58** string. |
| **Signature** | A transaction's unique ID. Every action returns one; the app links it to Solana Explorer. |
| **RPC endpoint** | The URL your code calls to read/write the chain (e.g. `https://api.devnet.solana.com`). |

---

## 3. Packages we use (and why)

Everything is installed from `package.json`. Below is **every** dependency, its pinned
version, and the exact reason it's here — grouped so you can teach it in order.

### 3.1 Runtime dependencies

| Package | Version | Why we use it | Where in the code |
|---------|---------|----------------|-------------------|
| **`@solana/web3.js`** | `^1.95.4` | The core Solana JavaScript SDK. Gives us `Connection` (talk to an RPC), `Keypair` (identity), `PublicKey`, `Transaction`, `LAMPORTS_PER_SOL`, `clusterApiUrl`. Everything on-chain goes through this. | `lib/solana.ts`, `lib/spl.ts`, both deploy scripts, `SplTokenApp.tsx` |
| **`@solana/spl-token`** | `^0.4.9` | Helpers for the **SPL Token Program**. Deploy side: `createMint`, `getOrCreateAssociatedTokenAccount`, `mintTo`, `setAuthority`, `getMint`. App side: `getAssociatedTokenAddress`, `getAccount`, `createTransferInstruction`, `createBurnInstruction`, `createAssociatedTokenAccountInstruction`. | `lib/spl.ts`, both deploy scripts |
| **`@metaplex-foundation/mpl-token-metadata`** | `^2.13.0` | Attaches **on-chain name + symbol** (Metaplex Token Metadata) to the mint so Phantom/Explorer show a real name/ticker. We use `createCreateMetadataAccountV3Instruction` + `PROGRAM_ID`. | `scripts/metadata.mjs` (used by both deploy scripts) |
| **`@solana/wallet-adapter-base`** | `^0.9.23` | Base types/interfaces the other wallet-adapter packages build on. Pulled in transitively; pinned for a consistent version. | (transitive) |
| **`@solana/wallet-adapter-react`** | `^0.15.35` | React context + hooks: `ConnectionProvider`, `WalletProvider`, and the `useConnection` / `useWallet` hooks the UI relies on. | `components/Providers.tsx`, `SplTokenApp.tsx` |
| **`@solana/wallet-adapter-react-ui`** | `^0.9.35` | Ready-made UI: the `WalletModalProvider` (wallet-picker popup), the `WalletMultiButton` (Connect/Disconnect button), and its `styles.css`. Saves us building a wallet modal by hand. | `components/Providers.tsx`, `SplTokenApp.tsx` |
| **`@solana/wallet-adapter-wallets`** | `^0.19.32` | The concrete wallet adapters we offer: `PhantomWalletAdapter`, `SolflareWalletAdapter`. | `components/Providers.tsx` |
| **`bs58`** | `^6.0.0` | Base58 encode/decode. Used to **print** the deployer's secret key in Phantom-import format, and in `deploy-token-with-key.mjs` to **decode** a user-supplied base58 private key. | both deploy scripts |
| **`next`** | `14.2.5` | The React framework (App Router) that serves the web app. | whole `app/` |
| **`react`** / **`react-dom`** | `^18.3.1` | The UI library Next.js renders. | whole `app/`, `components/` |

### 3.2 Dev dependencies (build & tooling only)

| Package | Version | Why |
|---------|---------|-----|
| **`typescript`** | `^5.5.3` | Types across the whole project. |
| **`@types/node`** | `^20.14.0` | Node type definitions (used by the `.mjs` scripts and Next config). |
| **`@types/react`**, **`@types/react-dom`** | `^18.3.x` | React type definitions. |
| **`tailwindcss`** | `^3.4.6` | Utility-first CSS for the UI. |
| **`postcss`** | `^8.4.39` | CSS pipeline Tailwind runs on. |
| **`autoprefixer`** | `^10.4.19` | Adds vendor prefixes to the generated CSS. |

### 3.3 The `overrides` block

```jsonc
"overrides": {
  "rpc-websockets": { "uuid": "9.0.1" }
}
```

`@solana/web3.js` pulls in `rpc-websockets`, which historically resolved a conflicting
`uuid` version. Pinning `uuid` to `9.0.1` here forces one consistent version and
prevents an npm dependency-resolution error during install/build.

> **What we deliberately do NOT use:** no `ethers`, no `wagmi`, no Reown/WalletConnect,
> no EVM libraries. This is a pure Solana stack.

---

## 4. What this app does

The token itself is deployed **once** by a CLI script (see §8). The web app then
**integrates** with that deployed token. It shows the token's details (name, mint
address, decimals, cluster) read from `deployment.json`, and each action button calls
exactly one function in `lib/spl.ts`:

1. **Connect wallet** — Phantom / Solflare, on devnet.
2. **Airdrop devnet SOL** — free gas so you can pay fees. *(devnet only)*
3. **Check balance** — your balance of the deployed token; read-only, free, no popup.
4. **Transfer tokens** — send the deployed token to another wallet (creates their ATA if needed).
5. **Burn tokens** — permanently destroy your own supply of the deployed token.

There are deliberately **no "Create token" or "Mint tokens" buttons** — those are
one-time deploy-script actions (§8), not browser actions.

> **Note on the airdrop step:** a devnet **SOL airdrop** button is included because
> without a small amount of SOL for fees the transfer/burn actions can't run. It's
> clearly labeled and devnet-only — remove it before going to mainnet.

---

## 5. Project file map

```
app/
  layout.tsx        → Root layout. Wraps the app in <Providers/> (wallet context).
  page.tsx          → Home page. Renders <SplTokenApp/>.
  globals.css       → Tailwind directives + base styles.

components/
  Providers.tsx     → ConnectionProvider + WalletProvider + WalletModalProvider.
                      This is what makes "Connect Wallet" work everywhere. Uses a
                      "mount gate" (renders only after mounting in the browser) so the
                      wallet adapter's browser-only APIs never run during SSR.
  SplTokenApp.tsx   → THE single page. Shows the deployed-token info, connect button,
                      and one panel per integration action (balance/transfer/burn).
                      The mint address + decimals are fixed from deployment.json.

lib/
  solana.ts         → Network config: the devnet Connection + Explorer link helpers +
                      withRetry() read helper. Switch to mainnet here in one line.
  token.ts          → Reads deployment.json and exports DEPLOYED_TOKEN (mint address,
                      decimals, name, cluster). The single token the app binds to.
  spl.ts            → The on-chain SPL actions the web app uses, heavily commented:
                      transferTokens, burnTokens, getTokenBalance (+ base-unit helper).
                      No createToken/mintTokens — deploy + mint happen in the scripts.

scripts/
  deploy-token.mjs           → CLI deploy. Auto-generates/loads a keypair file, funds it,
                               creates the mint, mints supply, optional revoke, writes
                               deployment.json.  Run: npm run deploy
  deploy-token-with-key.mjs  → SAME deploy flow, but uses a PRIVATE KEY you pass IN the
                               command (base58 or JSON array) instead of a keypair file.
                               Run: npm run deploy:key -- <YOUR_PRIVATE_KEY>
  metadata.mjs               → Shared helper: attaches on-chain name+symbol via Metaplex
                               Token Metadata (used by both deploy scripts).
  load-env.mjs               → Tiny dependency-free .env loader imported first by both
                               deploy scripts (so .env works on any Node version).
  deployer-keypair.json      → The auto-generated devnet keypair (git-ignored).

contracts/
  spl-token-example.rs → ANNOTATED REFERENCE (lecture) of Solana's official SPL Token
                      Program in Rust — the on-chain program that powers every SPL
                      token. State layouts are byte-verbatim from the official source;
                      instruction/processor logic is faithfully commented. READ-ONLY:
                      not compiled or redeployed (your token uses Solana's deployed
                      program, id Tokenkeg…, which is what makes it a standard token).

deployment.json     → The deployed token's record (written by whichever deploy script
                      you ran). The web app reads its mint address + decimals from here.
next.config.mjs     → Webpack fallbacks so crypto libs build in the browser.
.env.local.example  → Optional custom RPC URL template.
DEPLOYMENT.md       → Long-form deploy guide (script method + official Solana CLI method).
```

---

## 6. Architecture: how the pieces talk to each other

```
                         ┌────────────────────────────┐
   ONE-TIME (CLI)        │   scripts/deploy-token.mjs  │
                         │   or  deploy-token-with-key │
                         └──────────────┬─────────────┘
                                        │ createMint → ATA → mintTo → (revoke?)
                                        ▼
                              ┌───────────────────┐
                              │  deployment.json  │  ◄── the source of truth
                              └─────────┬─────────┘
                                        │ imported by
                                        ▼
   WEB APP (browser)          ┌───────────────────┐
                              │   lib/token.ts    │  → DEPLOYED_TOKEN
                              └─────────┬─────────┘
                                        │ used by
              ┌─────────────────────────┼──────────────────────────┐
              ▼                         ▼                            ▼
     components/Providers.tsx   components/SplTokenApp.tsx      lib/spl.ts
     (wallet + RPC context)     (UI + buttons)  ───calls──►  transfer / burn / balance
                                        │                            │
                                        └──── lib/solana.ts ─────────┘
                                             (Connection + Explorer links)
```

The key idea to teach: **the script writes `deployment.json`, and the web app only
ever reads it.** Deploy and integrate are two separate worlds joined by that one file.

---

## 7. The full flow: deploy (once) → integrate (web app)

**Deploy + mint initial supply** happen in a script (`scripts/deploy-token.mjs` or
`scripts/deploy-token-with-key.mjs`):

```
Load the deployer keypair (pays fees, becomes mint authority)
   → createMint                     (allocate + initialize the mint on-chain)
      → getOrCreateAssociatedTokenAccount  (deployer's ATA)
         → mintTo                   (mint the initial supply into that ATA)
            → attachTokenMetadata   (Metaplex: on-chain name + symbol)
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

## 8. Deployment — step by step

> Deploy is a **one-time command-line step**. There are **three ways** to do it; all
> produce the same thing (a mint account on Solana) and all write `deployment.json`.
> The official Solana `spl-token` CLI method (Method C) is documented fully in
> **[DEPLOYMENT.md](./DEPLOYMENT.md)**.

### Step 0 — Prerequisites

| You want to… | What you must install |
|--------------|-----------------------|
| **Deploy via a script** (`npm run deploy` or `npm run deploy:key`) | **Nothing extra.** Just Node.js 18+ (20+ recommended) and this project's `npm install`. No wallet, no Solana CLI, no Rust. |
| **Use the web app** (`npm run dev`) | Node.js + a **browser wallet extension**: [Phantom](https://phantom.app) or [Solflare](https://solflare.com). |
| **Deploy via the official Solana CLI** (Method C) | The Solana CLI + `spl-token` CLI (and Rust). **Not needed** if you use a script. |

```bash
node -v      # must print v18.x or higher (v20+ preferred)
npm install  # install all packages from package.json (one time)
```

---

### Method A — `npm run deploy` (auto-generated keypair)

The simplest path. The script makes its **own** keypair, claims **free** devnet SOL,
then deploys and mints — with zero setup from you.

```bash
npm run deploy
```

What it does, in order:

1. **Generates a keypair** and saves it to `scripts/deployer-keypair.json` (git-ignored).
2. **Airdrops 1 devnet SOL** to that address to pay the tiny fees.
3. **Creates the mint** (`createMint`) with your decimals + the deployer as authority.
4. **Creates an ATA** and **mints the initial supply** into it (`mintTo`).
5. **Writes `deployment.json`** with the mint address and full record.
6. **Prints the deployer's private key** (base58) so you can import that wallet into
   Phantom — it holds the whole initial supply.

Options (all optional):

```bash
node scripts/deploy-token.mjs --decimals 6 --supply 1000000   # custom token
node scripts/deploy-token.mjs --revoke                        # lock supply forever
node scripts/deploy-token.mjs --name "My Token" --symbol MYT  # on-chain name + symbol
node scripts/deploy-token.mjs --uri https://.../metadata.json # off-chain logo/desc JSON
```

> **Name + symbol are on-chain.** The script attaches a **Metaplex Token Metadata**
> account after minting (step 6.5), so Phantom/Explorer show the real name and ticker.
> Limits: name ≤ 32 chars, symbol ≤ 10 chars. The script validates these *before*
> deploying and fails fast if they're too long. `--uri` optionally points to an
> off-chain JSON file (logo, description).

> **If the airdrop fails** (the devnet faucet is sometimes rate-limited): the script
> prints your generated address and stops. Copy it, claim SOL at
> <https://faucet.solana.com>, then re-run `npm run deploy` — it deploys straight through.

---

### Method B — `npm run deploy:key` (deploy with YOUR private key)

Use this when you want the token to be deployed by a **specific wallet you already
control** (e.g. a Phantom wallet), instead of a throwaway generated key. The private
key is passed **in the command**. It accepts either format:

- a **base58** string (Phantom → Settings → *Export Private Key*), or
- a **JSON array** of 64 numbers (a raw Solana secret-key array).

```bash
# base58 key, positionally (note the -- so npm forwards args to the script)
npm run deploy:key -- <YOUR_PRIVATE_KEY>

# with options
npm run deploy:key -- <YOUR_PRIVATE_KEY> --decimals 6 --supply 1000000 --name "My Token" --revoke

# via a named flag
npm run deploy:key -- --private-key <YOUR_PRIVATE_KEY>

# via an env var (keeps the key out of the visible args)
PRIVATE_KEY=<YOUR_PRIVATE_KEY> npm run deploy:key

# mainnet with a custom RPC
npm run deploy:key -- <YOUR_PRIVATE_KEY> --cluster mainnet-beta --rpc <your-rpc-url>
```

The flow is otherwise **identical** to Method A (create mint → ATA → mint supply →
optional revoke → write `deployment.json`). The **only** difference is *whose* keypair
signs and becomes the mint/freeze authority: yours.

> **⚠️ Security:** a private key on the command line is saved in your shell history and
> is briefly visible in the process list. For a **mainnet** key, prefer the
> `PRIVATE_KEY` env var, run `history -c` afterwards, and never commit or screenshot it.
> On devnet a throwaway key is fine.

**Flags supported by both scripts:** `--decimals`, `--supply`, `--name`, `--symbol`,
`--uri`, `--revoke`, `--cluster <devnet|mainnet-beta>`, `--rpc <url>`, `--insecure-rpc`.
`deploy-token.mjs` also supports `--keypair <path>` (read a keypair *file*);
`deploy-token-with-key.mjs` adds `--private-key` / `-k` (or the positional key, or
`PRIVATE_KEY`). All of these also have `.env` equivalents (`DECIMALS`, `INITIAL_SUPPLY`,
`TOKEN_NAME`, `TOKEN_SYMBOL`, `TOKEN_URI`, `CLUSTER`, `RPC_URL`, `PRIVATE_KEY`).

---

### Method C — Official Solana `spl-token` CLI

For completeness (and to show the "manual" path), the official CLI produces the same
mint. Full step-by-step is in **[DEPLOYMENT.md](./DEPLOYMENT.md)** — summarized:

```bash
solana-keygen new                       # make a keypair
solana config set --url devnet          # point at devnet
solana airdrop 2                         # fund it
spl-token create-token                   # ← creates the mint (deploy)
spl-token create-account <MINT>          # your ATA
spl-token mint <MINT> 1000000            # mint supply
```

You'd then paste the resulting mint address into `deployment.json` manually so the web
app can bind to it.

---

### After any method: verify

Copy the printed **mint address** and open it on Solana Explorer (the script prints a
direct link, and `deployment.json` stores it under `explorer.mint`). You should see the
mint account with its decimals and supply. `deployment.json` now looks like:

```jsonc
{
  "cluster": "devnet",
  "name": "My SPL Token",
  "mintAddress": "Ap2Z...ZTRg",
  "decimals": 9,
  "initialSupply": 1000000,
  "totalSupplyBaseUnits": "1000000000000000",
  "mintAuthority": "2s93...VVB3",
  "freezeAuthority": "2s93...VVB3",
  "deployer": "2s93...VVB3",
  "ata": "Gmr2...Hssk",
  "deployedAt": "2026-07-02T23:14:06.237Z",
  "explorer": { "mint": "https://explorer.solana.com/address/...", "deployer": "..." }
}
```

---

## 9. Integration — step by step

> **Deploy first.** The web app binds to the token in `deployment.json`, so you must
> have run one of the deploy methods (§8) at least once. This path also needs a
> **browser wallet** (Phantom or Solflare).

### Step 1 — (optional) set a custom RPC

The public devnet RPC is heavily rate-limited and sometimes blocks browser reads
(balances show blank). A free RPC from Helius / QuickNode / Alchemy fixes it instantly.

```bash
cp .env.local.example .env.local
# then edit: NEXT_PUBLIC_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
```

The app works without this, but shows a yellow "you're on the public RPC" banner.

### Step 2 — start the dev server

```bash
npm run dev
```

Open **http://localhost:3000**. The **Deployed token** panel shows the token's name,
mint address, decimals, and cluster — all read from `deployment.json` via `lib/token.ts`.

### Step 3 — put your wallet on devnet

In **Phantom** → Settings → **Developer Settings** → set the network to **Devnet**.
*(Essential — a mainnet wallet won't see your devnet token.)*

### Step 4 — connect

Click **Select Wallet** → pick Phantom → approve. Behind the scenes,
`components/Providers.tsx` provides the wallet context, and `SplTokenApp.tsx` reads your
public key and loads your SOL balance.

### Step 5 — get some gas (devnet SOL)

Click **Airdrop 1 SOL**. If the built-in faucet is busy, use
<https://faucet.solana.com> and paste your address. You need a little SOL to pay fees
for transfer/burn.

### Step 6 — use the token functions

1. **Check balance** — read-only, free, no popup. (`getTokenBalance` in `lib/spl.ts`.)
2. **Transfer** — send the token to another address; creates their ATA if missing.
   Phantom pops up to sign. (`transferTokens`.)
3. **Burn** — permanently destroy some of your own balance. Phantom pops up to sign.
   (`burnTokens`.) Total supply drops.

Each successful write shows a **Solana Explorer** link to the transaction.

> **How do I get some of the token to test with?** The deploy step minted the initial
> supply to the **deployer's** wallet, not your browser wallet. Either import the
> deployer key into Phantom (Method A/B print/use it) and test from there, or transfer
> some of the token from the deployer to your connected wallet first.

---

## 10. How each SPL function works (the code)

The web-app actions live in `lib/spl.ts`. They receive the `connection`, your wallet
`publicKey`, and the adapter's `sendTransaction` (which pops up Phantom to sign). The
`mintAddress` they operate on is fixed — it comes from `deployment.json` via
`lib/token.ts` (`DEPLOYED_TOKEN`).

- **`transferTokens(...)`** — derives both ATAs (`getAssociatedTokenAddress`), adds a
  `createAssociatedTokenAccountInstruction` if the recipient has no ATA yet, then a
  `createTransferInstruction`. You sign as the source owner.
- **`burnTokens(...)`** — a single `createBurnInstruction` from your ATA. Reduces total
  supply permanently.
- **`getTokenBalance(...)`** — read-only. Derives your ATA and reads `.amount` via
  `getAccount`. If the account doesn't exist yet, returns `0` (no error).

Amounts are converted with `toBaseUnits(amount, decimals) = amount × 10^decimals`
(rounded to avoid floating-point dust).

> **Where are create + mint?** In the deploy scripts (§8), which run once from the CLI.
> They are intentionally **not** in the web app: the mint authority is the deployer
> keypair, so a browser wallet can't mint, and the app's job is to integrate with the
> token that already exists.

**Read vs Write:**
*Read* (balance) touches no wallet, costs nothing, no popup.
*Write* (transfer / burn) needs your signature + a tiny SOL fee, so Phantom pops up each time.

---

## 11. Wallet connection flow

```
User clicks "Select Wallet"
  → WalletModalProvider shows the wallet list (Phantom, Solflare)
    → user picks Phantom → Phantom asks to approve the connection
      → app receives your public key (useWallet)
        → app reads your SOL balance (connection.getBalance)
          → all the SPL panels become usable
```

`components/Providers.tsx` supplies all of this. Instead of a `dynamic(ssr:false)`
import, it uses a **mount gate**: it tracks a `mounted` state with `useEffect` and
returns `null` until the component has mounted in the browser. That avoids both
`window is not defined` during server rendering and React hydration mismatches — while
staying compatible with Next 14, which disallows `ssr:false` dynamic imports inside
Server Components like `layout.tsx`.

---

## 12. Going to mainnet

1. Deploy the token to mainnet with a script (fund the wallet with **real** SOL first):
   - `node scripts/deploy-token.mjs --cluster mainnet-beta --keypair <your-funded-keypair>`, or
   - `npm run deploy:key -- <YOUR_PRIVATE_KEY> --cluster mainnet-beta --rpc <your-rpc-url>`

   This rewrites `deployment.json`, so the web app automatically binds to the new token.
2. In `lib/solana.ts`, change `CLUSTER` from `'devnet'` to `'mainnet-beta'` so the
   Explorer links and RPC point at mainnet.
3. Set a real paid RPC in `.env.local` (`NEXT_PUBLIC_RPC_URL`) — the public endpoint
   is heavily rate-limited.
4. **Remove the Airdrop panel** in `SplTokenApp.tsx` — there is no airdrop on mainnet;
   fund the wallet with real SOL instead.
5. Switch your Phantom wallet back to **Mainnet**.
6. Every action now costs **real SOL**. Test thoroughly on devnet first.

---

## 13. Troubleshooting

| Problem | Fix |
|--------|------|
| **SOL and token balances are blank / never load** | The public devnet RPC is blocking/rate-limiting browser reads (403/429). Set a free `NEXT_PUBLIC_RPC_URL` in `.env.local` (Helius/QuickNode/Alchemy) and restart `npm run dev`. A yellow banner appears when on the public RPC. |
| **`npm run deploy:key` says "No private key provided"** | Pass the key after `--`, e.g. `npm run deploy:key -- <YOUR_PRIVATE_KEY>`, or set `PRIVATE_KEY=...`. |
| **"Private key is not valid base58" / "must be 64 bytes"** | You pasted the public address or a truncated key. Export the full **secret** key (base58) or a 64-number JSON array. |
| **Airdrop fails / "429"** | The devnet faucet is rate-limited. Use <https://faucet.solana.com>. |
| **"Attempt to debit an account but found no record of a prior credit"** | Your wallet has 0 SOL. Airdrop first. |
| **Balance shows 0 / transfer says insufficient** | The initial supply was minted to the **deployer**, not your browser wallet. Transfer some of the token to your connected wallet first. |
| **Token panel is empty / wrong token** | The app reads `deployment.json`. Run a deploy method first (or re-run) so that file exists and points at your token. |
| **`window is not defined` / build crash** | Providers must render only after mount (the mount gate in `Providers.tsx`, already done). |
| **`Module not found` during build** | Add the missing module to `resolve.fallback` in `next.config.mjs` as `false`. |
| **Recipient can't see received tokens** | They may need to add the mint address as a custom token in their wallet; the ATA still holds the balance on-chain. |

---

## 14. Glossary

- **SPL** — Solana Program Library; the standard on-chain programs. The **Token
  Program** is the one that runs all SPL tokens.
- **Mint** — the account that *is* your token (decimals, supply, authority). Note: the
  mint stores **no** name/symbol — those live in a separate Metaplex metadata account.
- **Token Metadata (Metaplex)** — a separate on-chain account (program `metaqbxx…`) that
  holds the token's **name, symbol, and URI**. Wallets/Explorer read it to display the
  token. Our deploy scripts create it via `scripts/metadata.mjs`.
- **ATA (Associated Token Account)** — a wallet's balance-holding account for one
  specific token.
- **Mint authority** — who can create new supply.
- **Freeze authority** — who can freeze token accounts.
- **Decimals** — how divisible a token is (base units = amount × 10^decimals).
- **Keypair** — an address + its secret key (JSON array of 64 numbers, or a base58 string).
- **Lamports** — the smallest unit of SOL (1 SOL = 1,000,000,000 lamports).
- **Rent-exempt** — the up-front SOL deposit that keeps an account alive.
- **RPC endpoint** — the URL your app uses to read/write the blockchain.
- **Signature** — a transaction's unique ID (viewable on Solana Explorer).
- **Devnet vs Mainnet-beta** — free test network vs the real, money network.
- **Wallet Adapter** — Solana's official library for connecting wallets in a dapp.

---

Built with Next.js 14 (App Router), TypeScript, Tailwind, `@solana/web3.js`,
`@solana/spl-token`, and `@solana/wallet-adapter-*`. Devnet by default.
