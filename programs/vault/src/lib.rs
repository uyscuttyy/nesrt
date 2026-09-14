use anchor_lang::prelude::*;

declare_id!("Vau1tTSLAxYieldVault11111111111111111111111");

/// TSLAx Yield Vault (Devnet MVP).
///
/// Phase 1 scaffold: program state and PDA layout only.
/// Deposit/withdraw logic with Kamino CPI lands in Phases 3-5.
#[program]
pub mod vault {
    use super::*;

    /// Initialize vault state for a given TSLAx mint and Kamino reserve.
    /// Full implementation in Phase 3.
    pub fn initialize_vault(_ctx: Context<InitializeVault>) -> Result<()> {
        unimplemented!("Phase 3: initialize vault state")
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
    /// yTSLAx receipt mint (vault program is mint authority).
    pub receipt_mint: Pubkey,
    /// Kamino lending market this vault routes into.
    pub kamino_market: Pubkey,
    /// Kamino TSLAx reserve within the market.
    pub kamino_reserve: Pubkey,
    /// PDA bump for the vault authority.
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: validated on use; full constraints in Phase 3.
    pub tslax_mint: UncheckedAccount<'info>,
    /// CHECK: validated on use; full constraints in Phase 3.
    pub kamino_market: UncheckedAccount<'info>,
    /// CHECK: validated on use; full constraints in Phase 3.
    pub kamino_reserve: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + 32 + 32 + 32 + 32 + 1,
        seeds = [b"vault", tslax_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: Account<'info, VaultState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    // Full account constraints in Phase 4.
    /// CHECK: validated in Phase 4.
    pub vault_state: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    // Full account constraints in Phase 5.
    /// CHECK: validated in Phase 5.
    pub vault_state: UncheckedAccount<'info>,
}
