// ─────────────────────────────────────────────────────────────────────────────
// metadata.mjs — Attach on-chain NAME + SYMBOL to an SPL token (Metaplex)
// ─────────────────────────────────────────────────────────────────────────────
//
// The classic SPL Token Program's mint account stores only decimals, supply and
// authorities — NOT a name or symbol. Wallets like Phantom and Solana Explorer
// read the human name/symbol/logo from a SEPARATE account owned by the
// **Metaplex Token Metadata** program (program id metaqbxx…).
//
// This helper creates that metadata account for a given mint, so the token shows
// up with a real name + symbol everywhere. It is shared by both deploy scripts
// (deploy-token.mjs and deploy-token-with-key.mjs).
//
// IMPORTANT ordering: metadata must be created while the deployer is STILL the
// mint authority (CreateMetadataAccountV3 requires the mint authority to sign).
// So the deploy scripts call this AFTER minting supply but BEFORE any --revoke.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'

// mpl-token-metadata v2 is CommonJS; a namespace import works reliably in ESM.
import * as tokenMetadata from '@metaplex-foundation/mpl-token-metadata'

const { createCreateMetadataAccountV3Instruction, PROGRAM_ID } = tokenMetadata

// The Token Metadata program's on-chain limits. Exceeding them makes the
// instruction fail on-chain, so we check up front and fail with a clear message.
export const METADATA_LIMITS = { name: 32, symbol: 10, uri: 200 }

/** Throw a friendly error if name/symbol/uri are too long for Metaplex. */
export function validateMetadata({ name, symbol, uri = '' }) {
  if (!name || !String(name).trim()) {
    throw new Error('Token name is empty — set TOKEN_NAME or pass --name.')
  }
  if (!symbol || !String(symbol).trim()) {
    throw new Error('Token symbol is empty — set TOKEN_SYMBOL or pass --symbol.')
  }
  if (name.length > METADATA_LIMITS.name) {
    throw new Error(
      `Token name is ${name.length} chars; Metaplex allows max ${METADATA_LIMITS.name}.`,
    )
  }
  if (symbol.length > METADATA_LIMITS.symbol) {
    throw new Error(
      `Token symbol is ${symbol.length} chars; Metaplex allows max ${METADATA_LIMITS.symbol}.`,
    )
  }
  if (uri && uri.length > METADATA_LIMITS.uri) {
    throw new Error(
      `Metadata URI is ${uri.length} chars; Metaplex allows max ${METADATA_LIMITS.uri}.`,
    )
  }
}

/** Derive the metadata PDA (program-derived address) for a mint. */
export function metadataPda(mint) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), PROGRAM_ID.toBuffer(), mint.toBuffer()],
    PROGRAM_ID,
  )
  return pda
}

/**
 * Create the Metaplex metadata account for `mint`, giving the token an on-chain
 * name + symbol (+ optional off-chain JSON `uri` for logo/description).
 *
 * @returns {{ metadataAddress: string, signature: string }}
 */
export async function attachTokenMetadata(connection, payer, mint, { name, symbol, uri = '' }) {
  validateMetadata({ name, symbol, uri })

  const metadata = metadataPda(mint)

  const ix = createCreateMetadataAccountV3Instruction(
    {
      metadata,
      mint,
      mintAuthority: payer.publicKey,
      payer: payer.publicKey,
      updateAuthority: payer.publicKey,
    },
    {
      createMetadataAccountArgsV3: {
        data: {
          name,
          symbol,
          uri, // link to off-chain JSON (logo, description). Empty is allowed.
          sellerFeeBasisPoints: 0, // royalties — 0 for a normal fungible token
          creators: null,
          collection: null,
          uses: null,
        },
        isMutable: true, // allow updating the metadata later
        collectionDetails: null,
      },
    },
  )

  const tx = new Transaction().add(ix)
  const signature = await sendAndConfirmTransaction(connection, tx, [payer])

  return { metadataAddress: metadata.toBase58(), signature }
}

export { PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID }
