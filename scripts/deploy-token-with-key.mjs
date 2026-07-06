// ─────────────────────────────────────────────────────────────────────────────
// deploy-token-with-key.mjs — Deploy an SPL token using a PRIVATE KEY you pass IN
// the command (no keypair file, no generated throwaway key).
// ─────────────────────────────────────────────────────────────────────────────
//
// This is the same deployment flow as `scripts/deploy-token.mjs` (create mint →
// ATA → mint supply → optional revoke → save deployment.json), EXCEPT the
// deployer identity comes from a private key you provide on the command line
// (or via the PRIVATE_KEY env var) instead of a keypair JSON file on disk.
//
// The private key can be either format:
//   • Phantom / base58 string   e.g.  4wBqpZM9... (the string deploy-token.mjs prints)
//   • JSON array of 64 numbers   e.g.  [12,34,...]  (a raw Solana secret-key array)
//
// Run it with (note the `--` so npm forwards the args to the script):
//   npm run deploy:key -- <YOUR_PRIVATE_KEY>
//   npm run deploy:key -- <YOUR_PRIVATE_KEY> --decimals 6 --supply 1000000 --name "My Token"
//   npm run deploy:key -- <YOUR_PRIVATE_KEY> --revoke              (locks total supply)
//   npm run deploy:key -- <YOUR_PRIVATE_KEY> --cluster mainnet-beta --rpc <your-rpc-url>
//
// You may also pass the key via a flag or env var instead of positionally:
//   npm run deploy:key -- --private-key <YOUR_PRIVATE_KEY>
//   PRIVATE_KEY=<YOUR_PRIVATE_KEY> npm run deploy:key
//
// Or directly with node:
//   node scripts/deploy-token-with-key.mjs <YOUR_PRIVATE_KEY> --supply 500000
//
// ⚠️  SECURITY: passing a private key on the command line leaves it in your shell
//     history and process list. For a MAINNET key, prefer the PRIVATE_KEY env var,
//     clear your history afterwards (`history -c`), and never commit the key.
//
// Other config (CLI flag > env var > default), identical to deploy-token.mjs:
//   CLUSTER, RPC_URL, DECIMALS, INITIAL_SUPPLY, TOKEN_NAME
// ─────────────────────────────────────────────────────────────────────────────

// Load .env into process.env first (works on any Node version, no flag needed).
import './load-env.mjs'

import fs from 'node:fs'
import path from 'node:path'
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
import bs58 from 'bs58'

import { attachTokenMetadata, validateMetadata } from './metadata.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── 1. Read configuration (CLI flags > env vars > sensible defaults) ────────
// The private key is read either from the first positional argument, from
// `--private-key` / `-k`, or from the PRIVATE_KEY env var.

function readArgs() {
  const args = process.argv.slice(2)
  const get = (flag) => {
    const i = args.indexOf(flag)
    return i !== -1 && args[i + 1] ? args[i + 1] : undefined
  }
  const has = (flag) => args.includes(flag)

  // The first argument that is NOT a flag (doesn't start with "-") and does not
  // directly follow a value-taking flag is treated as the positional private key.
  const valueFlags = new Set([
    '--private-key',
    '-k',
    '--cluster',
    '--rpc',
    '--decimals',
    '--supply',
    '--name',
    '--symbol',
    '--uri',
  ])
  let positionalKey
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (valueFlags.has(a)) {
      i++ // skip this flag's value
      continue
    }
    if (a.startsWith('-')) continue // some other boolean flag
    positionalKey = a
    break
  }

  const privateKey =
    get('--private-key') ?? get('-k') ?? positionalKey ?? process.env.PRIVATE_KEY

  return {
    privateKey,
    cluster: get('--cluster') ?? process.env.CLUSTER ?? 'devnet',
    rpcUrl: get('--rpc') ?? process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL,
    decimals: Number(get('--decimals') ?? process.env.DECIMALS ?? 9),
    supply: Number(get('--supply') ?? process.env.INITIAL_SUPPLY ?? 1_000_000),
    name: get('--name') ?? process.env.TOKEN_NAME ?? 'My SPL Token',
    symbol: get('--symbol') ?? process.env.TOKEN_SYMBOL ?? 'MYSPL',
    uri: get('--uri') ?? process.env.TOKEN_URI ?? '', // off-chain JSON (logo/desc)
    revoke: has('--revoke'), // if set, mint authority is removed after minting
    insecureRpc:
      has('--insecure-rpc') ||
      process.env.RPC_INSECURE === '1' ||
      process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0',
  }
}

// ─── 2. Turn the user-given private key into a Keypair ───────────────────────
// Accepts either a base58 secret-key string (Phantom export) or a JSON array of
// 64 numbers (raw Solana secret key). This is the ONLY difference from
// deploy-token.mjs, which instead loads/generates a keypair file on disk.

function keypairFromPrivateKey(raw) {
  if (!raw || !String(raw).trim()) {
    throw new Error(
      'No private key provided.\n' +
        'Pass it in the command, for example:\n' +
        '  npm run deploy:key -- <YOUR_PRIVATE_KEY>\n' +
        '  npm run deploy:key -- --private-key <YOUR_PRIVATE_KEY>\n' +
        '  PRIVATE_KEY=<YOUR_PRIVATE_KEY> npm run deploy:key\n' +
        'The key can be a base58 string (Phantom export) or a JSON array of 64 numbers.',
    )
  }

  const value = String(raw).trim()
  let secretKey

  if (value.startsWith('[')) {
    // JSON array of 64 numbers (the same shape stored in a keypair file).
    let arr
    try {
      arr = JSON.parse(value)
    } catch {
      throw new Error('Private key looks like a JSON array but could not be parsed.')
    }
    if (!Array.isArray(arr) || arr.length !== 64) {
      throw new Error(
        `Expected a JSON array of 64 numbers, got length ${Array.isArray(arr) ? arr.length : 'n/a'}.`,
      )
    }
    secretKey = Uint8Array.from(arr)
  } else {
    // base58 string (Phantom "Export Private Key" format).
    try {
      secretKey = bs58.decode(value)
    } catch {
      throw new Error('Private key is not valid base58. Check for typos or extra spaces.')
    }
    if (secretKey.length !== 64) {
      throw new Error(
        `Decoded base58 secret key must be 64 bytes, got ${secretKey.length}. ` +
          'Make sure you pasted the SECRET key (not the public key/address).',
      )
    }
  }

  let kp
  try {
    kp = Keypair.fromSecretKey(secretKey)
  } catch {
    throw new Error('Could not build a keypair from the provided secret key.')
  }
  console.log(`🔑 Using provided private key: ${kp.publicKey.toBase58()}`)
  return kp
}

// ─── Network retry helper ────────────────────────────────────────────────────
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
  throw new Error(
    `Could not reach the Solana RPC while trying to "${label}".\n` +
      `This is a NETWORK issue, not a code bug. Try:\n` +
      `  • Turn off any VPN/proxy, or switch network (e.g. phone hotspot)\n` +
      `  • Test the endpoint:  curl https://api.devnet.solana.com -X POST ` +
      `-H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'\n` +
      `  • Use a different RPC:  npm run deploy:key -- <YOUR_PRIVATE_KEY> --rpc <your-rpc-url>\n` +
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
async function ensureFunds(connection, payer, cluster) {
  const balance = await withRetry('check balance', () =>
    connection.getBalance(payer.publicKey),
  )
  console.log(`💰 Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`)

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
  console.log('\n🚀 SPL TOKEN DEPLOYMENT (using provided private key)')
  console.log('─'.repeat(50))
  console.log(
    `Cluster: ${cfg.cluster} · Name: ${cfg.name} · Symbol: ${cfg.symbol} · ` +
      `Decimals: ${cfg.decimals} · Initial supply: ${cfg.supply} · ` +
      `Revoke authority: ${cfg.revoke}`,
  )

  // Fail fast BEFORE deploying if the name/symbol won't fit Metaplex's limits.
  validateMetadata({ name: cfg.name, symbol: cfg.symbol, uri: cfg.uri })

  // Pick the RPC endpoint. A custom RPC (paid) is recommended for mainnet.
  const endpoint = cfg.rpcUrl ?? clusterApiUrl(cfg.cluster)
  configureRpcTls(endpoint, cfg.insecureRpc)
  const connection = new Connection(endpoint, 'confirmed')

  // Step 1 + 2: identity comes straight from the private key you passed in.
  const payer = keypairFromPrivateKey(cfg.privateKey)

  // Step 3: funds.
  await ensureFunds(connection, payer, cfg.cluster)

  // ── Step 4: CREATE THE MINT (the actual deploy) ──
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
  console.log('\n📦 Creating deployer Associated Token Account…')
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer, // payer for the ATA rent
    mint, // which token
    payer.publicKey, // whose account
  )
  console.log(`✅ ATA: ${ata.address.toBase58()}`)

  // ── Step 6: mint the initial supply ──
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

  // ── Step 6.5: attach on-chain NAME + SYMBOL (Metaplex Token Metadata) ──
  // The mint alone has no name/symbol; wallets read those from a Metaplex
  // metadata account. We create it here so Phantom/Explorer show a real name and
  // symbol. Must run while the deployer is still the mint authority (before any
  // --revoke below), because CreateMetadataAccountV3 requires that signature.
  console.log(`\n🏷️  Attaching metadata (name "${cfg.name}", symbol "${cfg.symbol}")…`)
  let metadata = null
  try {
    metadata = await attachTokenMetadata(connection, payer, mint, {
      name: cfg.name,
      symbol: cfg.symbol,
      uri: cfg.uri,
    })
    console.log(`✅ Metadata account: ${metadata.metadataAddress}`)
    console.log(`   Tx: ${metadata.signature}`)
  } catch (err) {
    console.warn(
      `⚠️  Could not attach metadata: ${String(err?.message ?? err)}\n` +
        `   The token IS deployed and minted; only the on-chain name/symbol is missing.\n` +
        `   You can retry attaching metadata later without redeploying.`,
    )
  }

  // ── Step 7 (optional): revoke the mint authority ──
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
    symbol: cfg.symbol,
    mintAddress: mint.toBase58(),
    decimals: mintInfo.decimals,
    initialSupply: cfg.supply,
    totalSupplyBaseUnits: mintInfo.supply.toString(),
    mintAuthority: mintInfo.mintAuthority?.toBase58() ?? null,
    freezeAuthority: mintInfo.freezeAuthority?.toBase58() ?? null,
    deployer: payer.publicKey.toBase58(),
    ata: ata.address.toBase58(),
    metadataUri: cfg.uri || null,
    metadataAddress: metadata?.metadataAddress ?? null,
    metadataTx: metadata?.signature ?? null,
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
    `\n👉 Saved to deployment.json — the web app auto-reads it. Run \`npm run dev\`\n` +
      `   to integrate with this token (check balance / transfer / burn):\n   ${result.mintAddress}`,
  )
}

main().catch((err) => {
  console.error('\n❌ Deployment failed:')
  console.error(err)
  process.exit(1)
})


