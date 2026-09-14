use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

declare_id!("Vau1tTSLAxYieldVault11111111111111111111111");

/// TSLAx Yield Vault (Devnet MVP).
///
/// Custodies user TSLAx in a vault PDA and routes it into a Kamino Lend
/// reserve via CPI. Receipt token yTSLAx tracks each depositor's share.
///
/// Phase 3: state + PDAs + initialize. Deposit (Phase 4) / withdraw (Phase 5).
#[program]
pub mod vault {
    use super::*;

    /// Initialize vault state for a given TSLAx mint and Kamino reserve.
    /// Creates the yTSLAx receipt mint (authority = vault authority PDA) and
    /// the vault's TSLAx + cToken custody accounts.
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        state.admin = ctx.accounts.admin.key();
        state.tslax_mint = ctx.accounts.tslax_mint.key();
        state.receipt_mint = ctx.accounts.receipt_mint.key();
        state.kamino_market = ctx.accounts.kamino_market.key();
        state.kamino_reserve = ctx.accounts.kamino_reserve.key();
        state.kamino_ctoken_mint = ctx.accounts.ctoken_mint.key();
        state.authority_bump = ctx.bumps.vault_authority;
        state.state_bump = ctx.bumps.vault_state;
        msg!(
            "vault initialized: tslax={} market={} reserve={}",
            state.tslax_mint,
            state.kamino_market,
            state.kamino_reserve
        );
        Ok(())
    }

    /// Deposit TSLAx, supply to Kamino via CPI, mint yTSLAx receipts.
    /// Full implementation in Phase 4.
    pub fn deposit(_ctx: Context<Deposit>, _amount: u64) -> Result<()> {
        unimplemented!("Phase 4: deposit + Kamino supply CPI")
    }

    /// Burn yTSLAx, redeem from Kamino via CPI, return TSLAx + interest.
    /// Full implementation in Phase 5.
    pub fn withdraw(_ctx: Context<Withdraw>, _shares: u64) -> Result<()> {
        unimplemented!("Phase 5: withdraw + Kamino redeem CPI")
    }
}

/// Persistent vault configuration, PDA seeds: [b"vault", tslax_mint].
#[account]
pub struct VaultState {
    /// Admin authority (can update reserve config).
    pub admin: Pubkey,
    /// The mock TSLAx SPL mint users deposit.
    pub tslax_mint: Pubkey,
    /// yTSLAx receipt mint (vault authority PDA is mint authority).
    pub receipt_mint: Pubkey,
    /// Kamino lending market this vault routes into.
    pub kamino_market: Pubkey,
    /// Kamino TSLAx reserve within the market.
    pub kamino_reserve: Pubkey,
    /// Kamino cToken mint of the TSLAx reserve (vault's yield position).
    pub kamino_ctoken_mint: Pubkey,
    /// Bump for the vault authority PDA (signs token + CPI ops).
    pub authority_bump: u8,
    /// Bump for this state PDA.
    pub state_bump: u8,
}

impl VaultState {
    pub const SPACE: usize = 8 + 32 * 6 + 1 + 1;

    /// Seeds that let the vault authority PDA sign (token transfers, CPI).
    pub fn authority_seeds(&self) -> [&[u8]; 3] {
        [
            b"vault-authority",
            self.tslax_mint.as_ref(),
            &[self.authority_bump],
        ]
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The mock TSLAx mint created in Phase 2.
    pub tslax_mint: Account<'info, Mint>,
    /// CHECK: recorded for the deposit/withdraw CPI; owned by the KLend
    /// program on devnet. Validated by use, not by type.
    pub kamino_market: UncheckedAccount<'info>,
    /// CHECK: recorded for the deposit/withdraw CPI. Validated by use.
    pub kamino_reserve: UncheckedAccount<'info>,
    /// The Kamino cToken mint of the TSLAx reserve (Phase 2 output).
    pub ctoken_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        space = VaultState::SPACE,
        seeds = [b"vault", tslax_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// Signing PDA for all vault-owned token accounts and Kamino CPI.
    /// CHECK: PDA derived from seeds below; no data stored.
    #[account(
        seeds = [b"vault-authority", tslax_mint.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        seeds = [b"receipt-mint", tslax_mint.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = vault_authority,
    )]
    pub receipt_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [b"vault-tslax", tslax_mint.key().as_ref()],
        bump,
        token::mint = tslax_mint,
        token::authority = vault_authority,
    )]
    pub vault_tslax_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = admin,
        seeds = [b"vault-ctoken", tslax_mint.key().as_ref()],
        bump,
        token::mint = ctoken_mint,
        token::authority = vault_authority,
    )]
    pub vault_ctoken_account: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}
