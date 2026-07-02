// ─── SPL Token library ──────────────────────────────────────────────────────
// This file contains EVERY on-chain action the app can perform on an SPL token.
// It is written to be read by someone who has never touched Solana before.
//
// Key ideas you MUST understand first:
//
//  • MINT ACCOUNT: An SPL token is really a "mint" account on-chain. The mint
//    stores the token's decimals, current total supply, and who is allowed to
//    create (mint) new tokens. Creating a token = creating + initializing a mint.
//    (This is the Solana equivalent of "deploying an ERC-20 contract".)
//
//  • ASSOCIATED TOKEN ACCOUNT (ATA): A wallet does NOT hold tokens directly.
//    For each token a wallet owns, there is a separate little account (the ATA)
//    that holds THAT wallet's balance of THAT token. Its address is derived
//    deterministically from (wallet, mint), so it's always findable.
//
//  • AUTHORITY: The "mint authority" is the wallet allowed to mint new tokens.
//    We set it to the connected wallet, so only you can print more supply.
//
//  • DECIMALS: Like cents in a dollar. With 9 decimals, 1 whole token =
//    1_000_000_000 "base units". On-chain amounts are always in base units.

import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from '@solana/web3.js'

import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createInitializeMint2Instruction,
  getMinimumBalanceForRentExemptMint,
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createTransferInstruction,
  createBurnInstruction,
} from '@solana/spl-token'

// The wallet adapter gives us a `sendTransaction` function with this shape.
// It signs the transaction with the user's wallet (Phantom popup), sends it,
// and returns the transaction signature (its unique ID). We can also pass
// extra `signers` (needed when we create a brand-new account like a mint).
export type SendTx = (
  transaction: Transaction,
  connection: Connection,
  options?: { signers?: Keypair[] },
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

// ─── 1. CREATE + DEPLOY THE TOKEN (initialize a new mint) ───────────────────
/**
 * Creates a brand-new SPL token (mint) on-chain and hands mint authority to the
 * connected wallet. This is the "deploy" step — after it succeeds, the token
 * exists on the blockchain forever.
 *
 * @param connection  live RPC connection
 * @param payer       the connected wallet's public key (pays the small rent fee)
 * @param sendTx      wallet adapter's sendTransaction
 * @param decimals    how divisible the token is (9 is the Solana default)
 * @returns           { mintAddress, signature }
 *
 * Side effect: opens the wallet popup asking the user to approve + pay ~0.0015 SOL.
 */
export async function createToken(
  connection: Connection,
  payer: PublicKey,
  sendTx: SendTx,
  decimals = 9,
): Promise<{ mintAddress: string; signature: string }> {
  // A mint lives in its own fresh account. We generate a throwaway keypair for
  // that account's address; it must co-sign the creation transaction ONCE.
  const mint = Keypair.generate()

  // "Rent-exempt" minimum: to keep an account alive on Solana you must deposit
  // enough SOL up front. This asks the network how much a mint account needs.
  const lamports = await getMinimumBalanceForRentExemptMint(connection)

  const transaction = new Transaction().add(
    // Step A: allocate the empty account that will BECOME the mint.
    SystemProgram.createAccount({
      fromPubkey: payer, // who pays for the new account
      newAccountPubkey: mint.publicKey, // the mint's address
      space: MINT_SIZE, // exact byte size a mint needs
      lamports, // rent-exempt deposit
      programId: TOKEN_PROGRAM_ID, // owned by the SPL Token program
    }),
    // Step B: turn that empty account into a real mint (set decimals + authority).
    createInitializeMint2Instruction(
      mint.publicKey, // the mint
      decimals, // divisibility
      payer, // mint authority = you (can create supply)
      payer, // freeze authority = you (can freeze accounts); pass null to disable
    ),
  )

  // The mint keypair must sign too (it's a new account). The wallet signs the rest.
  const signature = await sendTx(transaction, connection, { signers: [mint] })
  await confirm(connection, signature)

  return { mintAddress: mint.publicKey.toBase58(), signature }
}

// ─── 2. MINT (create) NEW TOKENS into a wallet ──────────────────────────────
/**
 * Prints `amount` whole tokens of `mintAddress` into `recipient`'s wallet.
 * Only the mint authority (you) can do this.
 *
 * If the recipient has never held this token, their Associated Token Account
 * (ATA) doesn't exist yet — so we create it in the same transaction.
 *
 * @param amount whole tokens (e.g. 100). Converted to base units internally.
 */
export async function mintTokens(
  connection: Connection,
  payer: PublicKey,
  sendTx: SendTx,
  mintAddress: string,
  recipient: string,
  amount: number,
  decimals: number,
): Promise<string> {
  const mint = new PublicKey(mintAddress)
  const recipientPk = new PublicKey(recipient)

  // Where the recipient's balance of THIS token will live.
  const ata = await getAssociatedTokenAddress(mint, recipientPk)

  const transaction = new Transaction()

  // Does the recipient's token account already exist? If not, add an instruction
  // to create it (the connected wallet pays the tiny rent for it).
  const ataExists = await accountExists(connection, ata)
  if (!ataExists) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        payer, // payer for the new ATA
        ata, // the ATA address to create
        recipientPk, // whose account it is
        mint, // for which token
      ),
    )
  }

  // Convert whole tokens → base units. 1 token = 10^decimals base units.
  const baseUnits = toBaseUnits(amount, decimals)

  transaction.add(
    createMintToInstruction(
      mint, // token to mint
      ata, // destination token account
      payer, // mint authority (must be you)
      baseUnits, // how much (base units)
    ),
  )

  const signature = await sendTx(transaction, connection)
  await confirm(connection, signature)
  return signature
}

// ─── 3. TRANSFER tokens to another wallet ───────────────────────────────────
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

// ─── 4. BURN tokens (permanently destroy supply) ────────────────────────────
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

// ─── 5. CHECK BALANCE (read-only, no wallet popup, free) ────────────────────
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
