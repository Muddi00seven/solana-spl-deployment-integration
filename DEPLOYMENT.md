# SPL Token Deployment — Full Process & Steps

This guide covers **deploying** (creating on-chain) your SPL token. There are two
independent ways to do it — pick either:

- **Method A — Script** (recommended here): `scripts/deploy-token.mjs`. No wallet
  extension needed; deploys + mints supply in one command.
- **Method B — Solana CLI**: the official `solana` + `spl-token` command-line tools.

Both produce the exact same thing: a **mint account** on Solana. After deploying,
paste the mint address into the web app (`npm run dev`) to mint / transfer / burn.

> On Solana you don't deploy your own contract. "Deploying a token" = asking the
> shared **SPL Token Program** to create and initialize a new **mint** account.
> See the [main README](./README.md) for the concepts (mint, ATA, authority, decimals).

---

## What "deployment" actually consists of

```
1. Have a funded keypair (pays fees, becomes the authority)
2. CREATE THE MINT            ← the deploy step (sets decimals + authority)
3. Create an Associated Token Account (ATA) to hold a balance
4. Mint the initial supply into that ATA
5. (optional) Revoke mint authority → supply fixed forever
6. Record the mint address + verify on Solana Explorer
```

---

## Method A — Deploy with the script

**Prerequisites: only Node.js.** You do **not** need a wallet, an address, SOL, the
Solana CLI, or Rust. The script generates its own keypair and claims its own devnet
SOL automatically.

| Requirement | Needed? |
|-------------|---------|
| Node.js 18+ (20+ recommended) | ✅ yes |
| `npm install` in this project | ✅ yes |
| A wallet / existing address | ❌ no — auto-generated |
| Devnet SOL | ❌ no — auto-airdropped |
| Solana CLI / `spl-token` CLI / Rust | ❌ no (that's Method B) |

Check Node: `node -v` → should be v18 or higher. Get it from <https://nodejs.org> if missing.

### Step 1 — Install dependencies (once)

```bash
npm install
```

The script uses `@solana/web3.js` and `@solana/spl-token`, which are already in
`package.json`. Nothing else to install.

### Step 1.5 — What the script sets up for you (no manual steps)

Running the deploy command automatically:

1. **Generates a keypair** → saved to `scripts/deployer-keypair.json` (git-ignored).
2. **Airdrops 1 devnet SOL** to that new address for fees.
3. Proceeds to create the mint + mint supply (Steps 2–4 below).

So you can go straight to Step 2 even with a brand-new machine that only has Node.js.
*(If the free airdrop is rate-limited, the script tells you the address so you can
top it up at <https://faucet.solana.com> and re-run.)*

### Step 2 — Deploy

```bash
# Simplest: devnet, 9 decimals, 1,000,000 initial supply
npm run deploy
```

On the first run the script **generates a deployer keypair** at
`scripts/deployer-keypair.json` (git-ignored), **airdrops** devnet SOL to it, then
creates the mint and mints the supply. You'll see output ending with:

```
🎉 DEPLOYMENT COMPLETE
{
  "mintAddress": "…",
  "decimals": 9,
  "initialSupply": 1000000,
  ...
}
👉 Paste this mint address into the web app …
```

It also writes the full record to **`deployment.json`** in the project root.

### Step 3 — Options

| Flag / env | Meaning | Example |
|------------|---------|---------|
| `--decimals` / `DECIMALS` | Token divisibility | `--decimals 6` |
| `--supply` / `INITIAL_SUPPLY` | Whole tokens to mint | `--supply 1000000000` |
| `--name` / `TOKEN_NAME` | Label saved to deployment.json | `--name "Echo Coin"` |
| `--revoke` | Remove mint authority (fixed supply) | `--revoke` |
| `--keypair` / `KEYPAIR_PATH` | Use an existing keypair | `--keypair ~/.config/solana/id.json` |
| `--cluster` / `CLUSTER` | Target cluster | `--cluster mainnet-beta` |
| `--rpc` / `RPC_URL` | Custom RPC endpoint | `--rpc https://…` |

Examples:

```bash
# 6-decimal stablecoin-style token, 1 billion supply, locked forever
node scripts/deploy-token.mjs --decimals 6 --supply 1000000000 --revoke

# Load config from .env.local (Node 20+) instead of flags
node --env-file=.env.local scripts/deploy-token.mjs
```

### Step 4 — Verify

Open the Explorer link the script prints (e.g.
`https://explorer.solana.com/address/<MINT>?cluster=devnet`) and confirm decimals,
supply, and authorities. Then run the web app and paste the mint address:

```bash
npm run dev   # → http://localhost:3000, paste the mint into "Mint address"
```

---

## Method B — Deploy with the Solana CLI

Use this if you prefer the official tooling.

### Step 1 — Install the Solana CLI + SPL Token CLI

```bash
# Install the Solana tool suite (macOS/Linux)
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Install the SPL Token CLI
cargo install spl-token-cli    # requires Rust; or use the prebuilt binary
```

### Step 2 — Point at devnet and create a wallet

```bash
solana config set --url https://api.devnet.solana.com
solana-keygen new                 # creates ~/.config/solana/id.json
solana airdrop 2                  # free devnet SOL
solana balance
```

### Step 3 — Create the token (deploy the mint)

```bash
# Create a new token/mint (default 9 decimals). Prints the mint address.
spl-token create-token --decimals 9
# → Creating token <MINT_ADDRESS>
```

### Step 4 — Create an account and mint supply

```bash
# Create YOUR token account (ATA) for this mint
spl-token create-account <MINT_ADDRESS>

# Mint 1,000,000 tokens to yourself
spl-token mint <MINT_ADDRESS> 1000000

# Check
spl-token supply  <MINT_ADDRESS>
spl-token balance <MINT_ADDRESS>
```

### Step 5 — (optional) Lock the supply

```bash
# Remove the mint authority → nobody can ever mint more
spl-token authorize <MINT_ADDRESS> mint --disable
```

### Step 6 — Verify

```bash
spl-token display <MINT_ADDRESS>
```

…or open `https://explorer.solana.com/address/<MINT_ADDRESS>?cluster=devnet`.

---

## Optional: add token metadata (name / symbol / image)

Classic SPL tokens don't store a name on-chain by themselves. To give wallets a
name, symbol, and logo, attach **Metaplex Token Metadata** after deploying. This
needs the extra package `@metaplex-foundation/mpl-token-metadata`. It's out of
scope for the core flow here but is the standard next step for a public token.

---

## Going to mainnet — checklist

1. Use a **real, funded keypair** (never the auto-generated devnet one; never commit it).
2. Set `--cluster mainnet-beta` and a **paid RPC** (`--rpc https://…`).
3. Double-check `--decimals` and `--supply` — they're permanent choices.
4. Decide on `--revoke` (fixed supply) before announcing the token.
5. Every step costs **real SOL**. Rehearse the whole flow on devnet first.

---

## Files produced by deployment

| File | What it is |
|------|------------|
| `scripts/deployer-keypair.json` | Auto-generated devnet keypair (git-ignored). |
| `deployment.json` | Record of the deploy: mint address, decimals, supply, authorities, Explorer links. |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `airdrop failed` / rate-limited | Use <https://faucet.solana.com>, then re-run. |
| `Not enough SOL … airdrop only works on devnet` | You're on mainnet — fund the deployer address manually. |
| `Cannot find module '@solana/spl-token'` | Run `npm install` first. |
| Web app can't see the token | Make sure the app and the deploy used the **same cluster** (devnet), and paste the exact mint address. |
| Want more supply later but revoked authority | Not possible — revoking is permanent. Deploy a new token. |
| `ERR_REQUIRE_ESM … rpc-websockets … require() of ES Module … uuid` | A bad transitive `uuid` version got pulled in. This project pins it via `overrides` in `package.json`. Apply it with a clean reinstall: `rm -rf node_modules package-lock.json && npm install`, then `npm run deploy`. |
