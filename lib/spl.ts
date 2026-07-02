// ─── SPL Token library ──────────────────────────────────────────────────────
// This file contains every on-chain action the WEB APP can perform on the
// already-deployed SPL token. It is written to be read by someone who has never
// touched Solana before.
//
// IMPORTANT — this app INTEGRATES with an EXISTING token; it does NOT create or
// mint one. The token was deployed once by `npm run deploy`
// (scripts/deploy-token.mjs), which also minted the initial supply. So the only
// actions here are transfer, burn, and read-balance. There is intentionally no
// `createToken` or `mintTokens`:
//   • Deploying/minting is a one-time authority action done by the deployer.
//   • The mint authority is the DEPLOYER keypair, not a connected browser wallet,
//     so a browser wallet cannot mint new supply anyway.
//
// Key ideas you MUST understand first:
//
//  • MINT ACCOUNT: An SPL token is really a "mint" account on-chain. The mint
//    stores the token's decimals, current total supply, and who is allowed to
//    create (mint) new tokens. (Solana's equivalent of an ERC-20 contract.)
//    In this app the mint address is fixed — it comes from deployment.json.
//
//  • ASSOCIATED TOKEN ACCOUNT (ATA): A wallet does NOT hold tokens directly.
//    For each token a wallet owns, there is a separate little account (the ATA)
//    that holds THAT wallet's balance of THAT token. Its address is derived
//    deterministically from (wallet, mint), so it's always findable.
//
//  • DECIMALS: Like cents in a dollar. With 9 decimals, 1 whole token =
//    1_000_000_000 "base units". On-chain amounts are always in base units.

import {
  PublicKey,
  Transaction,
  type Connection,
} from '@solana/web3.js'

import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  createBurnInstruction,
} from '@solana/spl-token'

// The wallet adapter gives us a `sendTransaction` function with this shape.
// It signs the transaction with the user's wallet (Phantom popup), sends it,
// and returns the transaction signature (its unique ID).
export type SendTx = (
  transaction: Transaction,
  connection: Connection,
) => Promise<string>

// Small helper: wait until the network confirms a transaction is final.
async function confirm(connection: Connection, signature: string) {
  // We need a recent blockhash + its "valid until" height to confirm safely.
  const latest = await connection.getLatestBlockhash()
  await connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    'confirmed',
  )
  return signature
}

// ─── 1. TRANSFER tokens to another wallet ───────────────────────────────────
/**
 * Sends `amount` whole tokens from the connected wallet to `recipient`.
 * Creates the recipient's ATA if they don't have one yet.
 */
export async function transferTokens(
  connection: Connection,
  owner: PublicKey,
  sendTx: SendTx,
  mintAddress: string,
  recipient: string,
  amount: number,
  decimals: number,
): Promise<string> {
  const mint = new PublicKey(mintAddress)
  const recipientPk = new PublicKey(recipient)

  // Source = the connected wallet's token account. Destination = recipient's.
  const fromAta = await getAssociatedTokenAddress(mint, owner)
  const toAta = await getAssociatedTokenAddress(mint, recipientPk)

  const transaction = new Transaction()

  // Make sure the recipient has somewhere to receive the token.
  if (!(await accountExists(connection, toAta))) {
    transaction.add(
      createAssociatedTokenAccountInstruction(owner, toAta, recipientPk, mint),
    )
  }

  transaction.add(
    createTransferInstruction(
      fromAta, // source token account
      toAta, // destination token account
      owner, // owner of the source (must sign) = you
      toBaseUnits(amount, decimals),
    ),
  )

  const signature = await sendTx(transaction, connection)
  await confirm(connection, signature)
  return signature
}

// ─── 2. BURN tokens (permanently destroy supply) ────────────────────────────
/**
 * Destroys `amount` whole tokens from the connected wallet's balance.
 * Burned tokens are gone forever and total supply goes down.
 */
export async function burnTokens(
  connection: Connection,
  owner: PublicKey,
  sendTx: SendTx,
  mintAddress: string,
  amount: number,
  decimals: number,
): Promise<string> {
  const mint = new PublicKey(mintAddress)

  // The account we're burning FROM = your token account for this mint.
  const fromAta = await getAssociatedTokenAddress(mint, owner)

  const transaction = new Transaction().add(
    createBurnInstruction(
      fromAta, // token account to burn from
      mint, // which token
      owner, // owner (must sign) = you
      toBaseUnits(amount, decimals),
    ),
  )

  const signature = await sendTx(transaction, connection)
  await confirm(connection, signature)
  return signature
}

// ─── 3. CHECK BALANCE (read-only, no wallet popup, free) ────────────────────
/**
 * Returns how many WHOLE tokens `owner` holds of `mintAddress`.
 * If the owner has no token account for this mint yet, the balance is 0.
 */
export async function getTokenBalance(
  connection: Connection,
  owner: PublicKey,
  mintAddress: string,
  decimals: number,
): Promise<number> {
  const mint = new PublicKey(mintAddress)
  const ata = await getAssociatedTokenAddress(mint, owner)

  try {
    // getAccount reads the token account. `.amount` is a bigint in base units.
    const account = await getAccount(connection, ata)
    return Number(account.amount) / 10 ** decimals
  } catch {
    // "TokenAccountNotFoundError" just means the wallet never held this token.
    return 0
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

// Is there an account at this address on-chain?
async function accountExists(
  connection: Connection,
  address: PublicKey,
): Promise<boolean> {
  const info = await connection.getAccountInfo(address)
  return info !== null
}

// Convert human tokens (e.g. 1.5) into on-chain base units as a bigint.
// We round to avoid floating-point dust like 1499999999.9999998.
export function toBaseUnits(amount: number, decimals: number): bigint {
  return BigInt(Math.round(amount * 10 ** decimals))
}
