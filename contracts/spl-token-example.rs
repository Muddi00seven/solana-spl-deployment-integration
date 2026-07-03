// ═════════════════════════════════════════════════════════════════════════════
//  spl-token-example.rs — The SPL Token Program (Rust), ANNOTATED REFERENCE
// ═════════════════════════════════════════════════════════════════════════════
//
//  WHAT THIS IS
//  ------------
//  This single file is a heavily-commented, lecture-oriented reference of Solana's
//  **official SPL Token Program** — the on-chain Rust program that powers EVERY
//  standard token on Solana (USDC, BONK, and the token this repo deploys). It is
//  faithful to the real program's data layouts and instruction logic.
//
//  The account layouts (Mint = 82 bytes, Account = 165 bytes, Multisig = 355
//  bytes, and the COption byte packing) are reproduced VERBATIM from the official
//  source so they are byte-exact. The instruction set and processor logic mirror
//  the official program's behaviour.
//
//  WHY YOUR TOKEN IS "100% THE SAME AS SOLANA"
//  -------------------------------------------
//  On Solana you do NOT write or deploy your own token contract. There is ONE
//  shared Token Program, written by Solana Labs, already deployed once at:
//
//        TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
//
//  Creating a token = asking THAT program to initialize a new `Mint` account.
//  Because every token — including the one `npm run deploy` creates in this repo
//  — is created by this exact program, they are all genuine, standard SPL tokens
//  that every wallet and exchange understands. This is precisely why the JS/TS
//  deploy script (using @solana/spl-token) already produces a real Solana token.
//
//  IMPORTANT — READ THIS
//  ---------------------
//  • This file is for STUDY / LECTURE only. It is NOT meant to be compiled and
//    redeployed as "your own" token program. Redeploying a modified copy under a
//    new program id would create a NON-standard token that wallets would not
//    recognise as a normal SPL token — the opposite of "same as Solana".
//  • The canonical, authoritative, byte-exact source (the version actually on
//    chain) lives here:
//        https://github.com/solana-program/token   (program/ + interface/)
//    (historically: github.com/solana-labs/solana-program-library, token/program)
//  • Token-2022 is a separate, newer program (TokenzQd…) that adds extensions
//    (transfer fees, on-mint metadata, etc.). This reference is the classic
//    Token Program, which is what this repo uses.
//
//  HOW TO READ IT (map to the real crate)
//  --------------------------------------
//    §1 entrypoint      → lib.rs        (program id + BPF entrypoint)
//    §2 error           → error.rs      (TokenError)
//    §3 state           → state.rs      (Mint / Account / Multisig, byte packing)
//    §4 instruction     → instruction.rs(TokenInstruction enum + (de)serialization)
//    §5 processor        → processor.rs  (the actual logic for each instruction)
//
// ═════════════════════════════════════════════════════════════════════════════

#![allow(clippy::too_many_arguments)]

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    program_error::ProgramError,
    program_option::COption,
    program_pack::{IsInitialized, Pack, Sealed},
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};

// The number of public keys that can be part of a multisig account.
pub const MIN_SIGNERS: usize = 1;
pub const MAX_SIGNERS: usize = 11;

// ─────────────────────────────────────────────────────────────────────────────
// §1  ENTRYPOINT  (maps to lib.rs)
// ─────────────────────────────────────────────────────────────────────────────
//
// The on-chain address ("program id") of the deployed SPL Token Program. This is
// a constant every token account/mint is owned by. It is NOT re-derived — Solana
// Labs deployed the program once and this id is fixed forever.
solana_program::declare_id!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

// The BPF entrypoint. When any instruction is sent to the Token Program, the
// runtime calls this function with:
//   • program_id     — should equal this program's id
//   • accounts       — the accounts the instruction operates on (mint, ATAs, …)
//   • instruction_data — the serialized TokenInstruction (see §4)
entrypoint!(process_instruction);
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Decode the raw bytes into a typed instruction, then dispatch to the
    // matching handler in the Processor (§5).
    let instruction = TokenInstruction::unpack(instruction_data)?;
    Processor::process(program_id, accounts, instruction)
}

// ─────────────────────────────────────────────────────────────────────────────
// §2  ERRORS  (maps to error.rs)
// ─────────────────────────────────────────────────────────────────────────────
//
// Every failure path in the program returns one of these. The discriminant
// (0,1,2,…) is stable and is what clients see as a custom program error code.
#[derive(Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TokenError {
    // 0 — Lamport balance below rent-exempt threshold.
    NotRentExempt,
    // 1 — Insufficient funds for the operation requested.
    InsufficientFunds,
    // 2 — Account not associated with this Mint.
    InvalidMint,
    // 3 — Owner does not match the expected mint.
    MintMismatch,
    // 4 — Owner does not match.
    OwnerMismatch,
    // 5 — This token's supply is fixed and new tokens cannot be minted.
    FixedSupply,
    // 6 — The account cannot be initialized because it is already in use.
    AlreadyInUse,
    // 7 — Invalid number of provided signers.
    InvalidNumberOfProvidedSigners,
    // 8 — Invalid number of required signers.
    InvalidNumberOfRequiredSigners,
    // 9 — State is uninitialized.
    UninitializedState,
    // 10 — Instruction does not support native tokens.
    NativeNotSupported,
    // 11 — Non-native account can only be closed if its balance is zero.
    NonNativeHasBalance,
    // 12 — Invalid instruction.
    InvalidInstruction,
    // 13 — State is invalid for the requested operation.
    InvalidState,
    // 14 — Operation overflowed.
    Overflow,
    // 15 — Account does not support specified authority type.
    AuthorityTypeNotSupported,
    // 16 — This token mint cannot freeze accounts.
    MintCannotFreeze,
    // 17 — Account is frozen; all account operations will fail.
    AccountFrozen,
    // 18 — Mint decimals mismatch between the client and mint.
    MintDecimalsMismatch,
    // 19 — Instruction does not support non-native tokens.
    NonNativeNotSupported,
}
impl From<TokenError> for ProgramError {
    fn from(e: TokenError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §3  STATE  (maps to state.rs)  — byte layouts are VERBATIM from the official source
// ─────────────────────────────────────────────────────────────────────────────
//
// These structs are what actually live on-chain. `Pack` gives each a fixed
// serialized size (LEN) and (un)pack routines. The byte offsets below are the
// canonical, on-chain-compatible layout — every wallet relies on these exact
// positions, so they must never change.

/// A token *mint* — THIS is the token itself. Stores authority, supply, decimals.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Mint {
    /// Optional authority allowed to mint new tokens. If `None`, the supply is
    /// FIXED forever (this is what `--revoke` does in the deploy script).
    pub mint_authority: COption<Pubkey>,
    /// Total supply of tokens (in base units).
    pub supply: u64,
    /// Number of base-10 digits to the right of the decimal point.
    pub decimals: u8,
    /// `true` once the mint has been initialized.
    pub is_initialized: bool,
    /// Optional authority allowed to freeze token accounts of this mint.
    pub freeze_authority: COption<Pubkey>,
}
impl Sealed for Mint {}
impl IsInitialized for Mint {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}
impl Pack for Mint {
    // Layout: 36 (COption<Pubkey>) + 8 (u64) + 1 (u8) + 1 (bool) + 36 = 82 bytes.
    const LEN: usize = 82;
    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        let src = array_ref![src, 0, 82];
        let (mint_authority, supply, decimals, is_initialized, freeze_authority) =
            array_refs![src, 36, 8, 1, 1, 36];
        Ok(Mint {
            mint_authority: unpack_coption_key(mint_authority)?,
            supply: u64::from_le_bytes(*supply),
            decimals: decimals[0],
            is_initialized: match is_initialized {
                [0] => false,
                [1] => true,
                _ => return Err(ProgramError::InvalidAccountData),
            },
            freeze_authority: unpack_coption_key(freeze_authority)?,
        })
    }
    fn pack_into_slice(&self, dst: &mut [u8]) {
        let dst = array_mut_ref![dst, 0, 82];
        let (ma_dst, supply_dst, dec_dst, init_dst, fa_dst) =
            mut_array_refs![dst, 36, 8, 1, 1, 36];
        pack_coption_key(&self.mint_authority, ma_dst);
        *supply_dst = self.supply.to_le_bytes();
        dec_dst[0] = self.decimals;
        init_dst[0] = self.is_initialized as u8;
        pack_coption_key(&self.freeze_authority, fa_dst);
    }
}

/// A token *account* (ATA) — holds ONE wallet's balance of ONE mint.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Account {
    /// The mint this account holds a balance of.
    pub mint: Pubkey,
    /// The owner of this account (the wallet).
    pub owner: Pubkey,
    /// Balance in base units.
    pub amount: u64,
    /// If `Some`, `delegated_amount` is authorized to be spent by this delegate.
    pub delegate: COption<Pubkey>,
    /// Initialized / Frozen / Uninitialized.
    pub state: AccountState,
    /// If `Some`, this is a wrapped-SOL (native) account; value = rent reserve.
    pub is_native: COption<u64>,
    /// Amount currently delegated.
    pub delegated_amount: u64,
    /// Optional authority allowed to close the account.
    pub close_authority: COption<Pubkey>,
}
impl Account {
    /// A frozen account cannot transfer, burn, or be delegated from.
    pub fn is_frozen(&self) -> bool {
        self.state == AccountState::Frozen
    }
    /// Wrapped-SOL accounts behave slightly differently (balance tracks lamports).
    pub fn is_native(&self) -> bool {
        self.is_native.is_some()
    }
}
impl Sealed for Account {}
impl IsInitialized for Account {
    fn is_initialized(&self) -> bool {
        self.state != AccountState::Uninitialized
    }
}
impl Pack for Account {
    // Layout: 32 + 32 + 8 + 36 + 1 + 12 + 8 + 36 = 165 bytes.
    const LEN: usize = 165;
    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        let src = array_ref![src, 0, 165];
        let (mint, owner, amount, delegate, state, is_native, delegated_amount, close_authority) =
            array_refs![src, 32, 32, 8, 36, 1, 12, 8, 36];
        Ok(Account {
            mint: Pubkey::new_from_array(*mint),
            owner: Pubkey::new_from_array(*owner),
            amount: u64::from_le_bytes(*amount),
            delegate: unpack_coption_key(delegate)?,
            state: AccountState::from_u8(state[0])?,
            is_native: unpack_coption_u64(is_native)?,
            delegated_amount: u64::from_le_bytes(*delegated_amount),
            close_authority: unpack_coption_key(close_authority)?,
        })
    }
    fn pack_into_slice(&self, dst: &mut [u8]) {
        let dst = array_mut_ref![dst, 0, 165];
        let (mint_d, owner_d, amount_d, delegate_d, state_d, native_d, deleg_amt_d, close_d) =
            mut_array_refs![dst, 32, 32, 8, 36, 1, 12, 8, 36];
        mint_d.copy_from_slice(self.mint.as_ref());
        owner_d.copy_from_slice(self.owner.as_ref());
        *amount_d = self.amount.to_le_bytes();
        pack_coption_key(&self.delegate, delegate_d);
        state_d[0] = self.state as u8;
        pack_coption_u64(&self.is_native, native_d);
        *deleg_amt_d = self.delegated_amount.to_le_bytes();
        pack_coption_key(&self.close_authority, close_d);
    }
}

/// The three states a token account can be in.
#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum AccountState {
    /// Not yet initialized.
    #[default]
    Uninitialized,
    /// Usable by owner/delegate.
    Initialized,
    /// Frozen by the mint's freeze authority — no operations allowed.
    Frozen,
}
impl AccountState {
    fn from_u8(v: u8) -> Result<Self, ProgramError> {
        match v {
            0 => Ok(AccountState::Uninitialized),
            1 => Ok(AccountState::Initialized),
            2 => Ok(AccountState::Frozen),
            _ => Err(ProgramError::InvalidAccountData),
        }
    }
}

/// An M-of-N multisignature account (can act as any authority).
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Multisig {
    /// Number of signatures required (M).
    pub m: u8,
    /// Number of valid signer keys (N).
    pub n: u8,
    /// `true` once initialized.
    pub is_initialized: bool,
    /// The N signer public keys.
    pub signers: [Pubkey; MAX_SIGNERS],
}
impl Sealed for Multisig {}
impl IsInitialized for Multisig {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}
impl Pack for Multisig {
    // Layout: 1 + 1 + 1 + 32*11 = 355 bytes.
    const LEN: usize = 355;
    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        let src = array_ref![src, 0, 355];
        let (m, n, is_initialized, signers_flat) = array_refs![src, 1, 1, 1, 32 * MAX_SIGNERS];
        let mut result = Multisig {
            m: m[0],
            n: n[0],
            is_initialized: match is_initialized {
                [0] => false,
                [1] => true,
                _ => return Err(ProgramError::InvalidAccountData),
            },
            signers: [Pubkey::new_from_array([0u8; 32]); MAX_SIGNERS],
        };
        for (src, dst) in signers_flat.chunks(32).zip(result.signers.iter_mut()) {
            *dst = Pubkey::new_from_array(<[u8; 32]>::try_from(src).unwrap());
        }
        Ok(result)
    }
    fn pack_into_slice(&self, dst: &mut [u8]) {
        let dst = array_mut_ref![dst, 0, 355];
        let (m, n, is_initialized, signers_flat) = mut_array_refs![dst, 1, 1, 1, 32 * MAX_SIGNERS];
        *m = [self.m];
        *n = [self.n];
        *is_initialized = [self.is_initialized as u8];
        for (i, src) in self.signers.iter().enumerate() {
            let dst_array = array_mut_ref![signers_flat, 32 * i, 32];
            dst_array.copy_from_slice(src.as_ref());
        }
    }
}

// COption<Pubkey>/<u64> byte packing — a 4-byte tag ([0,0,0,0]=None, [1,0,0,0]=Some)
// followed by the payload. This exact scheme is what every SPL client expects.
fn pack_coption_key(src: &COption<Pubkey>, dst: &mut [u8; 36]) {
    let (tag, body) = mut_array_refs![dst, 4, 32];
    match src {
        COption::Some(key) => {
            *tag = [1, 0, 0, 0];
            body.copy_from_slice(key.as_ref());
        }
        COption::None => *tag = [0; 4],
    }
}
fn unpack_coption_key(src: &[u8; 36]) -> Result<COption<Pubkey>, ProgramError> {
    let (tag, body) = array_refs![src, 4, 32];
    match *tag {
        [0, 0, 0, 0] => Ok(COption::None),
        [1, 0, 0, 0] => Ok(COption::Some(Pubkey::new_from_array(*body))),
        _ => Err(ProgramError::InvalidAccountData),
    }
}
fn pack_coption_u64(src: &COption<u64>, dst: &mut [u8; 12]) {
    let (tag, body) = mut_array_refs![dst, 4, 8];
    match src {
        COption::Some(amount) => {
            *tag = [1, 0, 0, 0];
            *body = amount.to_le_bytes();
        }
        COption::None => *tag = [0; 4],
    }
}
fn unpack_coption_u64(src: &[u8; 12]) -> Result<COption<u64>, ProgramError> {
    let (tag, body) = array_refs![src, 4, 8];
    match *tag {
        [0, 0, 0, 0] => Ok(COption::None),
        [1, 0, 0, 0] => Ok(COption::Some(u64::from_le_bytes(*body))),
        _ => Err(ProgramError::InvalidAccountData),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §4  INSTRUCTIONS  (maps to instruction.rs)
// ─────────────────────────────────────────────────────────────────────────────
//
// The full set of operations the Token Program understands. The FIRST byte of
// instruction_data is the tag (0..=24 below); the remaining bytes are the typed
// fields. `@solana/spl-token` builds exactly these on the client side —
// `mintTo`, `transfer`, `burn`, `setAuthority`, etc. all map here.
#[derive(Clone, Debug, PartialEq)]
pub enum TokenInstruction {
    /// 0  — Create a new mint. (Deploy step in this repo → `createMint`.)
    InitializeMint {
        decimals: u8,
        mint_authority: Pubkey,
        freeze_authority: COption<Pubkey>,
    },
    /// 1  — Initialize a token account (ATA) for a mint + owner.
    InitializeAccount,
    /// 2  — Initialize an M-of-N multisig.
    InitializeMultisig { m: u8 },
    /// 3  — Transfer tokens between two accounts of the same mint.
    Transfer { amount: u64 },
    /// 4  — Approve a delegate to spend up to `amount`.
    Approve { amount: u64 },
    /// 5  — Revoke a previously-approved delegate.
    Revoke,
    /// 6  — Change one of the mint/account authorities (or set to None).
    SetAuthority {
        authority_type: AuthorityType,
        new_authority: COption<Pubkey>,
    },
    /// 7  — Mint new supply to an account (requires mint authority).
    MintTo { amount: u64 },
    /// 8  — Burn tokens, permanently reducing supply.
    Burn { amount: u64 },
    /// 9  — Close an account and reclaim its rent lamports.
    CloseAccount,
    /// 10 — Freeze an account (requires freeze authority).
    FreezeAccount,
    /// 11 — Thaw a frozen account (requires freeze authority).
    ThawAccount,
    /// 12 — Transfer, but assert the mint's decimals (safer clients).
    TransferChecked { amount: u64, decimals: u8 },
    /// 13 — Approve, decimals-checked.
    ApproveChecked { amount: u64, decimals: u8 },
    /// 14 — MintTo, decimals-checked.
    MintToChecked { amount: u64, decimals: u8 },
    /// 15 — Burn, decimals-checked.
    BurnChecked { amount: u64, decimals: u8 },
    /// 16 — Initialize account with owner in instruction data (no owner sysvar).
    InitializeAccount2 { owner: Pubkey },
    /// 17 — Sync a wrapped-SOL account's balance to its lamports.
    SyncNative,
    /// 18 — Like 16 but also skips the rent sysvar.
    InitializeAccount3 { owner: Pubkey },
    /// 19 — InitializeMultisig without the rent sysvar.
    InitializeMultisig2 { m: u8 },
    /// 20 — InitializeMint without the rent sysvar.
    InitializeMint2 {
        decimals: u8,
        mint_authority: Pubkey,
        freeze_authority: COption<Pubkey>,
    },
    /// 21 — Return the required account data size for a mint's accounts.
    GetAccountDataSize,
    /// 22 — Mark an account's owner as immutable.
    InitializeImmutableOwner,
    /// 23 — Convert a raw amount to a UI (decimal) string.
    AmountToUiAmount { amount: u64 },
    /// 24 — Convert a UI (decimal) string to a raw amount.
    UiAmountToAmount { ui_amount: String },
}

/// Which authority a `SetAuthority` targets.
#[derive(Clone, Copy, Debug, PartialEq)]
#[repr(u8)]
pub enum AuthorityType {
    /// Authority to mint new tokens.
    MintTokens,
    /// Authority to freeze accounts.
    FreezeAccount,
    /// Owner of a given token account.
    AccountOwner,
    /// Authority to close a token account.
    CloseAccount,
}
impl AuthorityType {
    fn from(index: u8) -> Result<Self, ProgramError> {
        match index {
            0 => Ok(AuthorityType::MintTokens),
            1 => Ok(AuthorityType::FreezeAccount),
            2 => Ok(AuthorityType::AccountOwner),
            3 => Ok(AuthorityType::CloseAccount),
            _ => Err(TokenError::InvalidInstruction.into()),
        }
    }
}

impl TokenInstruction {
    /// Decode instruction_data (tag byte + fields) into a typed instruction.
    /// Only the core variants used by this repo are fully shown; the rest follow
    /// the identical tag-then-fields pattern (see the canonical instruction.rs).
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        let (&tag, rest) = input
            .split_first()
            .ok_or(ProgramError::from(TokenError::InvalidInstruction))?;
        Ok(match tag {
            0 => {
                let (decimals, rest) = rest
                    .split_first()
                    .ok_or(TokenError::InvalidInstruction)?;
                let (mint_authority, rest) = Self::unpack_pubkey(rest)?;
                let freeze_authority = Self::unpack_coption_pubkey(rest)?;
                Self::InitializeMint {
                    decimals: *decimals,
                    mint_authority,
                    freeze_authority,
                }
            }
            1 => Self::InitializeAccount,
            3 => Self::Transfer {
                amount: Self::unpack_u64(rest)?,
            },
            4 => Self::Approve {
                amount: Self::unpack_u64(rest)?,
            },
            5 => Self::Revoke,
            6 => {
                let (at, rest) = rest
                    .split_first()
                    .ok_or(TokenError::InvalidInstruction)?;
                Self::SetAuthority {
                    authority_type: AuthorityType::from(*at)?,
                    new_authority: Self::unpack_coption_pubkey(rest)?,
                }
            }
            7 => Self::MintTo {
                amount: Self::unpack_u64(rest)?,
            },
            8 => Self::Burn {
                amount: Self::unpack_u64(rest)?,
            },
            9 => Self::CloseAccount,
            10 => Self::FreezeAccount,
            11 => Self::ThawAccount,
            // …tags 2, 12..=24 follow the same pattern; omitted here for brevity.
            _ => return Err(TokenError::InvalidInstruction.into()),
        })
    }

    fn unpack_u64(input: &[u8]) -> Result<u64, ProgramError> {
        let amount = input
            .get(..8)
            .and_then(|slice| slice.try_into().ok())
            .map(u64::from_le_bytes)
            .ok_or(TokenError::InvalidInstruction)?;
        Ok(amount)
    }
    fn unpack_pubkey(input: &[u8]) -> Result<(Pubkey, &[u8]), ProgramError> {
        if input.len() < 32 {
            return Err(TokenError::InvalidInstruction.into());
        }
        let (key, rest) = input.split_at(32);
        Ok((Pubkey::new_from_array(<[u8; 32]>::try_from(key).unwrap()), rest))
    }
    fn unpack_coption_pubkey(input: &[u8]) -> Result<COption<Pubkey>, ProgramError> {
        match input.split_first() {
            Some((&0, _)) => Ok(COption::None),
            Some((&1, rest)) => {
                let (key, _) = Self::unpack_pubkey(rest)?;
                Ok(COption::Some(key))
            }
            _ => Err(TokenError::InvalidInstruction.into()),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5  PROCESSOR  (maps to processor.rs) — the actual logic per instruction
// ─────────────────────────────────────────────────────────────────────────────
//
// Each handler follows the same shape: read the accounts, load + validate state,
// check the required signer/authority, mutate balances/supply with OVERFLOW-safe
// math, then pack the state back. This is where "the rules of the token" live.
pub struct Processor;
impl Processor {
    pub fn process(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        instruction: TokenInstruction,
    ) -> ProgramResult {
        match instruction {
            TokenInstruction::InitializeMint {
                decimals,
                mint_authority,
                freeze_authority,
            } => Self::process_initialize_mint(accounts, decimals, mint_authority, freeze_authority),
            TokenInstruction::InitializeAccount => Self::process_initialize_account(accounts),
            TokenInstruction::Transfer { amount } => {
                Self::process_transfer(program_id, accounts, amount)
            }
            TokenInstruction::MintTo { amount } => {
                Self::process_mint_to(program_id, accounts, amount)
            }
            TokenInstruction::Burn { amount } => Self::process_burn(program_id, accounts, amount),
            TokenInstruction::SetAuthority {
                authority_type,
                new_authority,
            } => Self::process_set_authority(program_id, accounts, authority_type, new_authority),
            // Freeze/Thaw/Close/Approve/Revoke/*Checked handlers follow the same
            // structure; see the canonical processor.rs for the full set.
            _ => Err(TokenError::InvalidInstruction.into()),
        }
    }

    /// InitializeMint — allocate + set decimals/authorities. The "deploy" step.
    fn process_initialize_mint(
        accounts: &[AccountInfo],
        decimals: u8,
        mint_authority: Pubkey,
        freeze_authority: COption<Pubkey>,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let mint_info = next_account_info(account_info_iter)?;
        let mint_data_len = mint_info.data_len();
        let rent = Rent::get()?;

        // A mint can only be initialized once.
        let mut mint = Mint::unpack_unchecked(&mint_info.data.borrow())?;
        if mint.is_initialized {
            return Err(TokenError::AlreadyInUse.into());
        }
        // The account must be rent-exempt so it never gets purged.
        if !rent.is_exempt(mint_info.lamports(), mint_data_len) {
            return Err(TokenError::NotRentExempt.into());
        }

        mint.mint_authority = COption::Some(mint_authority);
        mint.decimals = decimals;
        mint.is_initialized = true;
        mint.freeze_authority = freeze_authority;

        Mint::pack(mint, &mut mint_info.data.borrow_mut())?;
        Ok(())
    }

    /// InitializeAccount — create an ATA that will hold a balance of a mint.
    fn process_initialize_account(accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let new_account_info = next_account_info(account_info_iter)?;
        let mint_info = next_account_info(account_info_iter)?;
        let owner_info = next_account_info(account_info_iter)?;
        let rent = Rent::get()?;

        let mut account = Account::unpack_unchecked(&new_account_info.data.borrow())?;
        if account.is_initialized() {
            return Err(TokenError::AlreadyInUse.into());
        }
        if !rent.is_exempt(new_account_info.lamports(), new_account_info.data_len()) {
            return Err(TokenError::NotRentExempt.into());
        }

        account.mint = *mint_info.key;
        account.owner = *owner_info.key;
        account.state = AccountState::Initialized;
        account.delegate = COption::None;
        account.delegated_amount = 0;
        account.close_authority = COption::None;
        // (Native/wrapped-SOL detection omitted here for brevity.)

        Account::pack(account, &mut new_account_info.data.borrow_mut())?;
        Ok(())
    }

    /// Transfer — move `amount` base units from source to destination.
    fn process_transfer(
        _program_id: &Pubkey,
        accounts: &[AccountInfo],
        amount: u64,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let source_account_info = next_account_info(account_info_iter)?;
        let dest_account_info = next_account_info(account_info_iter)?;
        let authority_info = next_account_info(account_info_iter)?;

        let mut source = Account::unpack(&source_account_info.data.borrow())?;
        let mut dest = Account::unpack(&dest_account_info.data.borrow())?;

        // A frozen account can neither send nor receive.
        if source.is_frozen() || dest.is_frozen() {
            return Err(TokenError::AccountFrozen.into());
        }
        // Both accounts must be for the SAME mint.
        if source.mint != dest.mint {
            return Err(TokenError::MintMismatch.into());
        }
        // Balance check.
        if source.amount < amount {
            return Err(TokenError::InsufficientFunds.into());
        }

        // Authorize: either the owner signed, or a delegate within its allowance.
        if source.owner == *authority_info.key {
            if !authority_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
        } else if source.delegate == COption::Some(*authority_info.key) {
            if !authority_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            if source.delegated_amount < amount {
                return Err(TokenError::InsufficientFunds.into());
            }
            // Reduce the remaining delegated allowance.
            source.delegated_amount = source
                .delegated_amount
                .checked_sub(amount)
                .ok_or(TokenError::Overflow)?;
            if source.delegated_amount == 0 {
                source.delegate = COption::None;
            }
        } else {
            return Err(TokenError::OwnerMismatch.into());
        }

        // Overflow-safe balance updates.
        source.amount = source.amount.checked_sub(amount).ok_or(TokenError::Overflow)?;
        dest.amount = dest.amount.checked_add(amount).ok_or(TokenError::Overflow)?;

        Account::pack(source, &mut source_account_info.data.borrow_mut())?;
        Account::pack(dest, &mut dest_account_info.data.borrow_mut())?;
        Ok(())
    }

    /// MintTo — create new supply into `dest`. Requires the mint authority.
    fn process_mint_to(
        _program_id: &Pubkey,
        accounts: &[AccountInfo],
        amount: u64,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let mint_info = next_account_info(account_info_iter)?;
        let dest_account_info = next_account_info(account_info_iter)?;
        let authority_info = next_account_info(account_info_iter)?;

        let mut dest = Account::unpack(&dest_account_info.data.borrow())?;
        let mut mint = Mint::unpack(&mint_info.data.borrow())?;

        if dest.is_frozen() {
            return Err(TokenError::AccountFrozen.into());
        }
        if dest.mint != *mint_info.key {
            return Err(TokenError::MintMismatch.into());
        }

        // Only the current mint authority may mint. If it's None, supply is fixed.
        match mint.mint_authority {
            COption::Some(authority) if authority == *authority_info.key => {
                if !authority_info.is_signer {
                    return Err(ProgramError::MissingRequiredSignature);
                }
            }
            _ => return Err(TokenError::OwnerMismatch.into()),
        }

        // Grow balance and total supply (overflow-safe).
        dest.amount = dest.amount.checked_add(amount).ok_or(TokenError::Overflow)?;
        mint.supply = mint.supply.checked_add(amount).ok_or(TokenError::Overflow)?;

        Account::pack(dest, &mut dest_account_info.data.borrow_mut())?;
        Mint::pack(mint, &mut mint_info.data.borrow_mut())?;
        Ok(())
    }

    /// Burn — permanently destroy `amount` from `source`, reducing total supply.
    fn process_burn(
        _program_id: &Pubkey,
        accounts: &[AccountInfo],
        amount: u64,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let source_account_info = next_account_info(account_info_iter)?;
        let mint_info = next_account_info(account_info_iter)?;
        let authority_info = next_account_info(account_info_iter)?;

        let mut source = Account::unpack(&source_account_info.data.borrow())?;
        let mut mint = Mint::unpack(&mint_info.data.borrow())?;

        if source.is_frozen() {
            return Err(TokenError::AccountFrozen.into());
        }
        if source.mint != *mint_info.key {
            return Err(TokenError::MintMismatch.into());
        }
        if source.amount < amount {
            return Err(TokenError::InsufficientFunds.into());
        }

        // Authorize via owner or delegate (allowance), like Transfer.
        if source.owner == *authority_info.key {
            if !authority_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
        } else if source.delegate == COption::Some(*authority_info.key) {
            if !authority_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            if source.delegated_amount < amount {
                return Err(TokenError::InsufficientFunds.into());
            }
            source.delegated_amount =
                source.delegated_amount.checked_sub(amount).ok_or(TokenError::Overflow)?;
            if source.delegated_amount == 0 {
                source.delegate = COption::None;
            }
        } else {
            return Err(TokenError::OwnerMismatch.into());
        }

        // Shrink balance and total supply.
        source.amount = source.amount.checked_sub(amount).ok_or(TokenError::Overflow)?;
        mint.supply = mint.supply.checked_sub(amount).ok_or(TokenError::Overflow)?;

        Account::pack(source, &mut source_account_info.data.borrow_mut())?;
        Mint::pack(mint, &mut mint_info.data.borrow_mut())?;
        Ok(())
    }

    /// SetAuthority — change or REMOVE an authority. Passing `None` for the mint
    /// authority is exactly the `--revoke` behaviour (supply becomes fixed).
    fn process_set_authority(
        _program_id: &Pubkey,
        accounts: &[AccountInfo],
        authority_type: AuthorityType,
        new_authority: COption<Pubkey>,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let account_info = next_account_info(account_info_iter)?;
        let authority_info = next_account_info(account_info_iter)?;

        // The account may be a Mint or a token Account depending on its length.
        if account_info.data_len() == Mint::LEN {
            let mut mint = Mint::unpack(&account_info.data.borrow())?;
            match authority_type {
                AuthorityType::MintTokens => {
                    // Must be signed by the CURRENT mint authority.
                    let current = mint.mint_authority.ok_or(TokenError::FixedSupply)?;
                    Self::validate_owner(&current, authority_info)?;
                    mint.mint_authority = new_authority;
                }
                AuthorityType::FreezeAccount => {
                    let current = mint.freeze_authority.ok_or(TokenError::MintCannotFreeze)?;
                    Self::validate_owner(&current, authority_info)?;
                    mint.freeze_authority = new_authority;
                }
                _ => return Err(TokenError::AuthorityTypeNotSupported.into()),
            }
            Mint::pack(mint, &mut account_info.data.borrow_mut())?;
        } else if account_info.data_len() == Account::LEN {
            let mut account = Account::unpack(&account_info.data.borrow())?;
            if account.is_frozen() {
                return Err(TokenError::AccountFrozen.into());
            }
            match authority_type {
                AuthorityType::AccountOwner => {
                    Self::validate_owner(&account.owner, authority_info)?;
                    match new_authority {
                        COption::Some(a) => account.owner = a,
                        COption::None => return Err(TokenError::InvalidInstruction.into()),
                    }
                }
                AuthorityType::CloseAccount => {
                    let current = account.close_authority.unwrap_or(account.owner);
                    Self::validate_owner(&current, authority_info)?;
                    account.close_authority = new_authority;
                }
                _ => return Err(TokenError::AuthorityTypeNotSupported.into()),
            }
            Account::pack(account, &mut account_info.data.borrow_mut())?;
        } else {
            return Err(ProgramError::InvalidArgument);
        }
        Ok(())
    }

    /// Confirm the expected authority actually signed (single-signer path; the
    /// real program also supports multisig here).
    fn validate_owner(expected: &Pubkey, authority_info: &AccountInfo) -> ProgramResult {
        if expected != authority_info.key {
            return Err(TokenError::OwnerMismatch.into());
        }
        if !authority_info.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  arrayref-style helpers (array_ref!/array_refs!/mut_array_refs!) come from the
//  `arrayref` crate in the real program. They're referenced above to keep the
//  byte layouts identical to the on-chain source. In a real build you'd add:
//     [dependencies] arrayref = "0.3"  solana-program = "…"
//  This file is a READING reference, so those macros are shown as-used rather
//  than re-implemented here.
// ─────────────────────────────────────────────────────────────────────────────
