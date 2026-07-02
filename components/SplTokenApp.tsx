'use client'

// ─── The single-page SPL Token app ──────────────────────────────────────────
// One screen that walks a user through the FULL lifecycle of an SPL token:
//   1. Connect a wallet          (Phantom / Solflare on devnet)
//   2. Airdrop devnet SOL        (so you have gas to pay fees)
//   3. Create + deploy the token (initialize a new mint)
//   4. Mint new tokens           (print supply into a wallet)
//   5. Check balance             (read-only, free)
//   6. Transfer tokens           (send to another wallet)
//   7. Burn tokens               (destroy supply)
//
// Every button below calls exactly one function from `lib/spl.ts`.

import { useCallback, useEffect, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import { explorerAddress, explorerTx } from '@/lib/solana'
import {
  createToken,
  mintTokens,
  transferTokens,
  burnTokens,
  getTokenBalance,
  type SendTx,
} from '@/lib/spl'

// A tiny helper type for the per-action status message shown in each panel.
type Status = { kind: 'idle' | 'busy' | 'ok' | 'err'; text: string; sig?: string }
const idle: Status = { kind: 'idle', text: '' }

export function SplTokenApp() {
  // `connection` = devnet RPC. `publicKey` = connected wallet. `sendTransaction`
  // signs + sends (the Phantom popup). `connected` = is a wallet linked?
  const { connection } = useConnection()
  const { publicKey, sendTransaction, connected } = useWallet()

  // Shared state for the token we're working with.
  const [decimals, setDecimals] = useState(9)
  const [mintAddress, setMintAddress] = useState('')

  // SOL balance shown at the top (you need SOL to pay fees).
  const [solBalance, setSolBalance] = useState<number | null>(null)

  // Per-panel input + status.
  const [airStatus, setAirStatus] = useState<Status>(idle)
  const [createStatus, setCreateStatus] = useState<Status>(idle)

  const [mintAmount, setMintAmount] = useState('100')
  const [mintTo, setMintTo] = useState('')
  const [mintStatus, setMintStatus] = useState<Status>(idle)

  const [tokenBalance, setTokenBalance] = useState<number | null>(null)
  const [balStatus, setBalStatus] = useState<Status>(idle)

  const [xferTo, setXferTo] = useState('')
  const [xferAmount, setXferAmount] = useState('10')
  const [xferStatus, setXferStatus] = useState<Status>(idle)

  const [burnAmount, setBurnAmount] = useState('5')
  const [burnStatus, setBurnStatus] = useState<Status>(idle)

  // `sendTransaction` from the adapter matches our SendTx type.
  const sendTx = sendTransaction as unknown as SendTx

  // ── Load the wallet's SOL balance whenever it connects/changes ──
  const refreshSol = useCallback(async () => {
    if (!publicKey) return
    const lamports = await connection.getBalance(publicKey)
    setSolBalance(lamports / LAMPORTS_PER_SOL)
  }, [connection, publicKey])

  useEffect(() => {
    if (connected && publicKey) {
      refreshSol()
      // Pre-fill "mint to" and "transfer from" with your own address for convenience.
      setMintTo(publicKey.toBase58())
    } else {
      setSolBalance(null)
    }
  }, [connected, publicKey, refreshSol])

  // ── Action handlers ──────────────────────────────────────────────────────

  // Airdrop 1 devnet SOL (free test money). Devnet only; may be rate-limited.
  async function handleAirdrop() {
    if (!publicKey) return
    setAirStatus({ kind: 'busy', text: 'Requesting 1 devnet SOL…' })
    try {
      const sig = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL)
      const latest = await connection.getLatestBlockhash()
      await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed')
      await refreshSol()
      setAirStatus({ kind: 'ok', text: 'Airdropped 1 SOL', sig })
    } catch (e) {
      setAirStatus({ kind: 'err', text: errMsg(e) + ' (devnet faucet is often rate-limited — try faucet.solana.com)' })
    }
  }

  // Create + deploy the token (initialize a new mint).
  async function handleCreate() {
    if (!publicKey) return
    setCreateStatus({ kind: 'busy', text: 'Creating mint — approve in wallet…' })
    try {
      const { mintAddress: newMint, signature } = await createToken(
        connection,
        publicKey,
        sendTx,
        decimals,
      )
      setMintAddress(newMint)
      setCreateStatus({ kind: 'ok', text: `Token created: ${newMint}`, sig: signature })
    } catch (e) {
      setCreateStatus({ kind: 'err', text: errMsg(e) })
    }
  }

  // Mint new tokens to a wallet.
  async function handleMint() {
    if (!publicKey || !requireMint(setMintStatus)) return
    setMintStatus({ kind: 'busy', text: 'Minting — approve in wallet…' })
    try {
      const sig = await mintTokens(
        connection,
        publicKey,
        sendTx,
        mintAddress,
        mintTo || publicKey.toBase58(),
        Number(mintAmount),
        decimals,
      )
      setMintStatus({ kind: 'ok', text: `Minted ${mintAmount} tokens`, sig })
    } catch (e) {
      setMintStatus({ kind: 'err', text: errMsg(e) })
    }
  }

  // Read the connected wallet's balance of this token (free, no popup).
  async function handleCheckBalance() {
    if (!publicKey || !requireMint(setBalStatus)) return
    setBalStatus({ kind: 'busy', text: 'Reading balance…' })
    try {
      const bal = await getTokenBalance(connection, publicKey, mintAddress, decimals)
      setTokenBalance(bal)
      setBalStatus({ kind: 'ok', text: 'Balance updated' })
    } catch (e) {
      setBalStatus({ kind: 'err', text: errMsg(e) })
    }
  }

  // Transfer tokens to another wallet.
  async function handleTransfer() {
    if (!publicKey || !requireMint(setXferStatus)) return
    setXferStatus({ kind: 'busy', text: 'Transferring — approve in wallet…' })
    try {
      const sig = await transferTokens(
        connection,
        publicKey,
        sendTx,
        mintAddress,
        xferTo,
        Number(xferAmount),
        decimals,
      )
      setXferStatus({ kind: 'ok', text: `Sent ${xferAmount} tokens`, sig })
    } catch (e) {
      setXferStatus({ kind: 'err', text: errMsg(e) })
    }
  }

  // Burn tokens from your own balance.
  async function handleBurn() {
    if (!publicKey || !requireMint(setBurnStatus)) return
    setBurnStatus({ kind: 'busy', text: 'Burning — approve in wallet…' })
    try {
      const sig = await burnTokens(
        connection,
        publicKey,
        sendTx,
        mintAddress,
        Number(burnAmount),
        decimals,
      )
      setBurnStatus({ kind: 'ok', text: `Burned ${burnAmount} tokens`, sig })
    } catch (e) {
      setBurnStatus({ kind: 'err', text: errMsg(e) })
    }
  }

  // Guard: most actions need a mint address first.
  function requireMint(setter: (s: Status) => void): boolean {
    if (!mintAddress) {
      setter({ kind: 'err', text: 'Create a token first, or paste a mint address above.' })
      return false
    }
    return true
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="bg-gradient-to-r from-solpurple to-solgreen bg-clip-text text-3xl font-bold text-transparent">
          SPL Token Studio
        </h1>
        <p className="mt-1 text-sm text-white/60">
          Create · Deploy · Integrate — live on Solana <b>devnet</b>
        </p>
      </header>

      {/* Wallet bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
        <WalletMultiButton />
        {connected && publicKey && (
          <span className="text-sm text-white/70">
            SOL: <b>{solBalance === null ? '…' : solBalance.toFixed(4)}</b>
          </span>
        )}
      </div>

      {!connected ? (
        <p className="rounded-xl border border-white/10 bg-white/5 p-6 text-white/70">
          Connect a Phantom or Solflare wallet (set it to <b>Devnet</b> in wallet
          settings) to begin.
        </p>
      ) : (
        <div className="space-y-5">
          {/* Shared token settings */}
          <Panel title="Token settings">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Decimals (set before creating)">
                <input
                  type="number"
                  min={0}
                  max={9}
                  value={decimals}
                  onChange={(e) => setDecimals(Number(e.target.value))}
                  className={inputCls}
                />
              </Field>
              <Field label="Mint address (auto-filled after create; or paste one)">
                <input
                  value={mintAddress}
                  onChange={(e) => setMintAddress(e.target.value.trim())}
                  placeholder="Create a token below…"
                  className={inputCls}
                />
              </Field>
            </div>
            {mintAddress && (
              <a
                href={explorerAddress(mintAddress)}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-solgreen underline"
              >
                View mint on Solana Explorer ↗
              </a>
            )}
          </Panel>

          {/* 1. Airdrop */}
          <Panel title="1 · Get devnet SOL (gas)">
            <p className="mb-3 text-sm text-white/60">
              You need a little SOL to pay transaction fees. This funds your wallet
              with free devnet SOL.
            </p>
            <Button onClick={handleAirdrop} busy={airStatus.kind === 'busy'}>
              Airdrop 1 SOL
            </Button>
            <StatusLine status={airStatus} />
          </Panel>

          {/* 2. Create */}
          <Panel title="2 · Create & deploy token">
            <p className="mb-3 text-sm text-white/60">
              Initializes a new mint. You become the mint + freeze authority.
            </p>
            <Button onClick={handleCreate} busy={createStatus.kind === 'busy'}>
              Create token
            </Button>
            <StatusLine status={createStatus} />
          </Panel>

          {/* 3. Mint */}
          <Panel title="3 · Mint tokens">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Amount (whole tokens)">
                <input value={mintAmount} onChange={(e) => setMintAmount(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Recipient wallet">
                <input value={mintTo} onChange={(e) => setMintTo(e.target.value.trim())} className={inputCls} />
              </Field>
            </div>
            <Button onClick={handleMint} busy={mintStatus.kind === 'busy'}>
              Mint
            </Button>
            <StatusLine status={mintStatus} />
          </Panel>

          {/* 4. Balance */}
          <Panel title="4 · Check your balance">
            <Button onClick={handleCheckBalance} busy={balStatus.kind === 'busy'}>
              Check balance
            </Button>
            {tokenBalance !== null && (
              <p className="mt-3 text-sm text-white/80">
                You hold: <b>{tokenBalance}</b> tokens
              </p>
            )}
            <StatusLine status={balStatus} />
          </Panel>

          {/* 5. Transfer */}
          <Panel title="5 · Transfer tokens">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Amount (whole tokens)">
                <input value={xferAmount} onChange={(e) => setXferAmount(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Recipient wallet">
                <input value={xferTo} onChange={(e) => setXferTo(e.target.value.trim())} placeholder="Destination address" className={inputCls} />
              </Field>
            </div>
            <Button onClick={handleTransfer} busy={xferStatus.kind === 'busy'}>
              Transfer
            </Button>
            <StatusLine status={xferStatus} />
          </Panel>

          {/* 6. Burn */}
          <Panel title="6 · Burn tokens">
            <Field label="Amount to burn (whole tokens)">
              <input value={burnAmount} onChange={(e) => setBurnAmount(e.target.value)} className={inputCls} />
            </Field>
            <div className="mt-3">
              <Button onClick={handleBurn} busy={burnStatus.kind === 'busy'}>
                Burn
              </Button>
            </div>
            <StatusLine status={burnStatus} />
          </Panel>
        </div>
      )}
    </div>
  )
}

// ─── Small presentational helpers ───────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-solgreen'

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/80">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-white/50">{label}</span>
      {children}
    </label>
  )
}

function Button({
  onClick,
  busy,
  children,
}: {
  onClick: () => void
  busy: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="rounded-lg bg-gradient-to-r from-solpurple to-solgreen px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-50"
    >
      {busy ? 'Working…' : children}
    </button>
  )
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === 'idle') return null
  const color =
    status.kind === 'err'
      ? 'text-red-400'
      : status.kind === 'ok'
        ? 'text-solgreen'
        : 'text-white/60'
  return (
    <div className={`mt-3 break-all text-xs ${color}`}>
      <span>{status.text}</span>
      {status.sig && (
        <>
          {' · '}
          <a href={explorerTx(status.sig)} target="_blank" rel="noreferrer" className="underline">
            view transaction ↗
          </a>
        </>
      )}
    </div>
  )
}

// Turn any thrown error into a short readable string.
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
