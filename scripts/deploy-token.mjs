// ─────────────────────────────────────────────────────────────────────────────
// deploy-token.mjs — Standalone SPL token DEPLOYMENT script (Node.js)
// ─────────────────────────────────────────────────────────────────────────────
//
// This script creates ("deploys") a brand-new SPL token on Solana devnet from
// the command line — no browser, no wallet extension. It is the scripted twin
// of the "Create token" button in the web app.
//
// What it does, in order:
//   1. Load (or generate) a deployer keypair that pays the fees + owns the token
//   2. Connect to the cluster (devnet by default)
//   3. Make sure the deployer has some SOL (airdrop on devnet if low)
//   4. CREATE THE MINT           → this is the actual "deploy"
//   5. Create the deployer's Associated Token Account (ATA)
//   6. Mint an initial supply into that ATA
//   7. (optional) Revoke the mint authority so supply becomes fixed forever
//   8. Save everything to deployment.json and print Explorer links
//
// Run it with:
//   node scripts/deploy-token.mjs
//   node scripts/deploy-token.mjs --decimals 6 --supply 1000000 --name "My Token"
//   node scripts/deploy-token.mjs --revoke        (locks total supply)
//   node scripts/deploy-token.mjs --cluster mainnet-beta --keypair ~/.config/solana/id.json
//
// Config can also come from env vars (e.g. via `node --env-file=.env.local ...`):
//   CLUSTER, RPC_URL, KEYPAIR_PATH, DECIMALS, INITIAL_SUPPLY, TOKEN_NAME
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from '@solana/web3.js'
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
  AuthorityType,
  getMint,
} from '@solana/spl-token'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── 1. Read configuration (CLI flags > env vars > sensible defaults) ────────

function readArgs() {
  const args = process.argv.slice(2)
  const get = (flag) => {
    const i = args.indexOf(flag)
    return i !== -1 && args[i + 1] ? args[i + 1] : undefined
  }
  const has = (flag) => args.includes(flag)

  return {
    cluster: get('--cluster') ?? process.env.CLUSTER ?? 'devnet',
    rpcUrl: get('--rpc') ?? process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL,
    keypairPath: get('--keypair') ?? process.env.KEYPAIR_PATH,
    decimals: Number(get('--decimals') ?? process.env.DECIMALS ?? 9),
    supply: Number(get('--supply') ?? process.env.INITIAL_SUPPLY ?? 1_000_000),
    name: get('--name') ?? process.env.TOKEN_NAME ?? 'My SPL Token',
    revoke: has('--revoke'), // if set, mint authority is removed after minting
    insecureRpc:
      has('--insecure-rpc') ||
      process.env.RPC_INSECURE === '1' ||
      process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0',
  }
}

// ─── 2. Load or generate the deployer keypair ────────────────────────────────
// A keypair is the deployer's identity: it pays fees and becomes the token's
// mint + freeze authority. On devnet we can safely generate a throwaway one and
// save it locally. NEVER commit a mainnet keypair to git.

function loadOrCreateKeypair(keypairPath) {
  // Default location for the generated devnet keypair.
  const defaultPath = path.join(__dirname, 'deployer-keypair.json')
  const filePath = keypairPath
    ? keypairPath.replace(/^~(?=$|\/)/, os.homedir()) // expand a leading ~
    : defaultPath

  if (fs.existsSync(filePath)) {
    // A Solana keypair file is just a JSON array of 64 numbers (the secret key).
    const secret = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const kp = Keypair.fromSecretKey(Uint8Array.from(secret))
    console.log(`🔑 Loaded deployer keypair: ${kp.publicKey.toBase58()}`)
    return kp
  }

  // No keypair found → generate a fresh one and save it (devnet convenience).
  const kp = Keypair.generate()
  fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)))
  console.log(`🆕 Generated new deployer keypair → ${filePath}`)
  console.log(`   Public key: ${kp.publicKey.toBase58()}`)
  return kp
}

// ─── Network retry helper ────────────────────────────────────────────────────
// Public RPC endpoints occasionally drop a request ("fetch failed"). Instead of
// crashing on the first hiccup, retry a few times with a short backoff.
async function withRetry(label, fn, tries = 4) {
  let lastErr
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const isNetwork = String(err?.message ?? err).includes('fetch failed')
      console.warn(
        `… ${label} failed (attempt ${attempt}/${tries})` +
          (isNetwork ? ' — network/RPC unreachable' : ''),
      )
      if (attempt < tries) await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
  // All retries exhausted — throw a friendly, actionable error.
  throw new Error(
    `Could not reach the Solana RPC while trying to "${label}".\n` +
      `This is a NETWORK issue, not a code bug. Try:\n` +
      `  • Turn off any VPN/proxy, or switch network (e.g. phone hotspot)\n` +
      `  • Test the endpoint:  curl https://api.devnet.solana.com -X POST ` +
      `-H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'\n` +
      `  • Use a different RPC:  node scripts/deploy-token.mjs --rpc <your-rpc-url>\n` +
      `Original error: ${String(lastErr?.message ?? lastErr)}`,
  )
}

function configureRpcTls(endpoint, insecureRpc) {
  const publicSolanaRpc = /(^|\/\/)(api\.(devnet|testnet)\.solana\.com)(\/|$)/.test(
    endpoint,
  )

  if (!insecureRpc && !publicSolanaRpc) return

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

  console.warn(
    '⚠️  TLS certificate verification is disabled for this RPC endpoint. ' +
      'Use a trusted RPC URL for mainnet or remove --insecure-rpc once your environment trust chain is fixed.',
  )
}

// ─── 3. Make sure the deployer has SOL to pay fees ───────────────────────────
// Creating a mint + ATA costs a small rent-exempt deposit + fees. On devnet we
// can airdrop free SOL; on mainnet you must fund the wallet yourself.

async function ensureFunds(connection, payer, cluster) {
  const balance = await withRetry('check balance', () =>
    connection.getBalance(payer.publicKey),
  )
  console.log(`💰 Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`)

  // ~0.05 SOL is plenty for a deploy + mint.
  if (balance >= 0.05 * LAMPORTS_PER_SOL) return

  if (cluster !== 'devnet' && cluster !== 'testnet') {
    throw new Error(
      `Not enough SOL and airdrop only works on devnet/testnet. ` +
        `Fund ${payer.publicKey.toBase58()} with SOL and re-run.`,
    )
  }

  console.log('⛽ Low balance — requesting a 1 SOL airdrop…')
  try {
    const sig = await withRetry('request airdrop', () =>
      connection.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL),
    )
    const latest = await withRetry('get blockhash', () =>
      connection.getLatestBlockhash(),
    )
    await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed')
    console.log('✅ Airdrop confirmed')
  } catch {
    console.warn(
      '⚠️  Airdrop failed (faucet rate-limited). Fund the address manually via ' +
        'https://faucet.solana.com and re-run.',
    )
  }
}

// ─── Explorer link helper ────────────────────────────────────────────────────
function explorer(kind, value, cluster) {
  const suffix = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`
  return `https://explorer.solana.com/${kind}/${value}${suffix}`
}

// ─── Main deployment flow ────────────────────────────────────────────────────

async function main() {
  const cfg = readArgs()
  console.log('\n🚀 SPL TOKEN DEPLOYMENT')
  console.log('─'.repeat(50))
  console.log(
    `Cluster: ${cfg.cluster} · Decimals: ${cfg.decimals} · ` +
      `Initial supply: ${cfg.supply} · Revoke authority: ${cfg.revoke}`,
  )

  // Pick the RPC endpoint. A custom RPC (paid) is recommended for mainnet.
  const endpoint = cfg.rpcUrl ?? clusterApiUrl(cfg.cluster)
  configureRpcTls(endpoint, cfg.insecureRpc)
  const connection = new Connection(endpoint, 'confirmed')

  // Step 1 + 2: identity.
  const payer = loadOrCreateKeypair(cfg.keypairPath)

  // Step 3: funds.
  await ensureFunds(connection, payer, cfg.cluster)

  // ── Step 4: CREATE THE MINT (the actual deploy) ──
  // createMint builds + sends the transaction that allocates and initializes a
  // new mint account. Arguments:
  //   connection, payer, mintAuthority, freezeAuthority, decimals
  console.log('\n🏗️  Creating mint (deploying the token)…')
  const mint = await createMint(
    connection,
    payer, // pays the fees
    payer.publicKey, // mint authority (can create supply)
    payer.publicKey, // freeze authority (can freeze accounts); pass null to disable
    cfg.decimals,
  )
  console.log(`✅ Token deployed. Mint address: ${mint.toBase58()}`)

  // ── Step 5: create the deployer's Associated Token Account ──
  // A wallet holds each token in a dedicated ATA. getOrCreate makes it if needed.
  console.log('\n📦 Creating deployer Associated Token Account…')
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer, // payer for the ATA rent
    mint, // which token
    payer.publicKey, // whose account
  )
  console.log(`✅ ATA: ${ata.address.toBase58()}`)

  // ── Step 6: mint the initial supply ──
  // Amounts are in BASE UNITS, so multiply whole tokens by 10^decimals.
  const baseUnits = BigInt(Math.round(cfg.supply * 10 ** cfg.decimals))
  console.log(`\n🪙 Minting ${cfg.supply} tokens…`)
  const mintSig = await mintTo(
    connection,
    payer, // fee payer
    mint, // token to mint
    ata.address, // destination ATA
    payer.publicKey, // mint authority (must be payer here)
    baseUnits, // amount in base units
  )
  console.log(`✅ Minted. Tx: ${mintSig}`)

  // ── Step 7 (optional): revoke the mint authority ──
  // Setting the mint authority to `null` makes the total supply FIXED forever —
  // nobody can ever mint more. Common for "no more inflation" tokens.
  if (cfg.revoke) {
    console.log('\n🔒 Revoking mint authority (supply becomes fixed)…')
    await setAuthority(
      connection,
      payer, // fee payer
      mint, // account to update
      payer.publicKey, // current authority
      AuthorityType.MintTokens, // which authority we're changing
      null, // new authority = none → locked forever
    )
    console.log('✅ Mint authority revoked')
  }

  // Read back the final on-chain state for the record.
  const mintInfo = await getMint(connection, mint)

  // ── Step 8: save results ──
  const result = {
    cluster: cfg.cluster,
    name: cfg.name,
    mintAddress: mint.toBase58(),
    decimals: mintInfo.decimals,
    initialSupply: cfg.supply,
    totalSupplyBaseUnits: mintInfo.supply.toString(),
    mintAuthority: mintInfo.mintAuthority?.toBase58() ?? null,
    freezeAuthority: mintInfo.freezeAuthority?.toBase58() ?? null,
    deployer: payer.publicKey.toBase58(),
    ata: ata.address.toBase58(),
    deployedAt: new Date().toISOString(),
    explorer: {
      mint: explorer('address', mint.toBase58(), cfg.cluster),
      deployer: explorer('address', payer.publicKey.toBase58(), cfg.cluster),
    },
  }

  const outPath = path.join(__dirname, '..', 'deployment.json')
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2))

  console.log('\n' + '─'.repeat(50))
  console.log('🎉 DEPLOYMENT COMPLETE')
  console.log('─'.repeat(50))
  console.log(JSON.stringify(result, null, 2))
  console.log(`\n📝 Saved to ${outPath}`)
  console.log(`🔗 Explorer: ${result.explorer.mint}`)
  console.log(
    `\n👉 Paste this mint address into the web app to mint/transfer/burn:\n   ${result.mintAddress}`,
  )
}

main().catch((err) => {
  console.error('\n❌ Deployment failed:')
  console.error(err)
  process.exit(1)
})
