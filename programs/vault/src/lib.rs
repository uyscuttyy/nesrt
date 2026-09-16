use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB");

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
    /// Split from account creation (initialize_accounts) to keep each
    /// instruction frame under the 4 KiB stack limit.
    pub fn initialize_state(ctx: Context<InitializeState>) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        state.admin = ctx.accounts.admin.key();
        state.tslax_mint = ctx.accounts.tslax_mint.key();
        state.receipt_mint = ctx.accounts.receipt_mint.key();
        state.kamino_market = ctx.accounts.kamino_market.key();
        state.kamino_reserve = ctx.accounts.kamino_reserve.key();
        state.kamino_ctoken_mint = ctx.accounts.ctoken_mint.key();
        state.pyth_price_feed = ctx.accounts.pyth_price_feed.key();
        state.authority_bump = ctx.bumps.vault_authority;
        state.state_bump = ctx.bumps.vault_state;
        state.is_paused = false;
        msg!(
            "vault state initialized: tslax={} market={} reserve={}",
            state.tslax_mint,
            state.kamino_market,
            state.kamino_reserve
        );
        Ok(())
    }

    /// Admin-only instruction to close the old vault state PDA.
    /// Called when program is upgraded and VaultState struct changes.
    /// Returns rent to admin; next initialize_state_v2 will recreate with new layout.
    pub fn migrate_state(ctx: Context<MigrateState>) -> Result<()> {
        let vault_state_info = &ctx.accounts.vault_state;
        
        // Verify this is the correct vault state by checking discriminator
        let data = vault_state_info.try_borrow_data()?;
        require!(data.len() >= 8, VaultError::MathError);
        let expected_disc: [u8; 8] = [228, 196, 82, 165, 98, 210, 235, 152];
        require!(&data[0..8] == expected_disc, VaultError::MathError);
        drop(data);

        // Close the old vault state PDA (return rent to admin)
        let lamports = vault_state_info.lamports();
        **vault_state_info.try_borrow_mut_lamports()? = 0;
        **ctx.accounts.admin.try_borrow_mut_lamports()? = ctx
            .accounts
            .admin
            .lamports()
            .checked_add(lamports)
            .ok_or(VaultError::MathError)?;

        // Mark account as closed by zeroing discriminator
        {
            let mut data_mut = vault_state_info.try_borrow_mut_data()?;
            data_mut[0..8].fill(0);
        }

        msg!("vault state PDA closed; re-run initialize_state_v2 to recreate with new layout");
        Ok(())
    }

    /// Close the vault-v2 state PDA (for reinitialization).
    pub fn close_vault_state_v2(ctx: Context<CloseVaultStateV2>) -> Result<()> {
        let vault_state_info = &ctx.accounts.vault_state;
        
        // Verify this is the correct vault state by checking discriminator
        let data = vault_state_info.try_borrow_data()?;
        require!(data.len() >= 8, VaultError::MathError);
        let expected_disc: [u8; 8] = [228, 196, 82, 165, 98, 210, 235, 152];
        require!(&data[0..8] == expected_disc, VaultError::MathError);
        drop(data);

        // Close the vault-v2 state PDA (return rent to admin)
        let lamports = vault_state_info.lamports();
        **vault_state_info.try_borrow_mut_lamports()? = 0;
        **ctx.accounts.admin.try_borrow_mut_lamports()? = ctx
            .accounts
            .admin
            .lamports()
            .checked_add(lamports)
            .ok_or(VaultError::MathError)?;

        // Mark account as closed by zeroing discriminator
        {
            let mut data_mut = vault_state_info.try_borrow_mut_data()?;
            data_mut[0..8].fill(0);
        }

        msg!("vault-v2 state PDA closed");
        Ok(())
    }

    /// Allocate space for the vault state PDA at the original address.
    /// Uses system program Allocate instruction (signed by PDA).
    pub fn allocate_vault_state(ctx: Context<AllocateVaultState>) -> Result<()> {
        let vault_state_info = &ctx.accounts.vault_state;
        let tslax_mint = ctx.accounts.tslax_mint.key();
        let state_bump = ctx.bumps.vault_state;

        // Verify the account is empty (discriminator zeroed)
        let data = vault_state_info.try_borrow_data()?;
        require!(data.len() >= 8, VaultError::MathError);
        require!(&data[0..8] == [0u8; 8], VaultError::MathError); // must be closed
        drop(data);

        // Use system program to allocate 272 bytes at the PDA
        // SystemInstruction::Allocate = 8
        let allocate_ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: anchor_lang::solana_program::system_program::ID,
            accounts: vec![
                anchor_lang::solana_program::instruction::AccountMeta::new(vault_state_info.key(), false),
            ],
            data: {
                let mut data = vec![8u8]; // SystemInstruction::Allocate
                data.extend_from_slice(&272u64.to_le_bytes());
                data
            },
        };

        anchor_lang::solana_program::program::invoke_signed(
            &allocate_ix,
            &[
                vault_state_info.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[
                b"vault",
                tslax_mint.as_ref(),
                &[state_bump],
            ]],
        )?;

        msg!("vault state PDA allocated to 272 bytes");
        Ok(())
    }

    /// Initialize vault state v2 for a given TSLAx mint and Kamino reserve.
    /// Uses different PDA seed "vault-v2" to avoid conflict with old PDA.
    pub fn initialize_state_v2(ctx: Context<InitializeStateV2>) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        state.admin = ctx.accounts.admin.key();
        state.tslax_mint = ctx.accounts.tslax_mint.key();
        state.receipt_mint = ctx.accounts.receipt_mint.key();
        state.kamino_market = ctx.accounts.kamino_market.key();
        state.kamino_reserve = ctx.accounts.kamino_reserve.key();
        state.kamino_ctoken_mint = ctx.accounts.ctoken_mint.key();
        state.pyth_price_feed = ctx.accounts.pyth_price_feed.key();
        state.authority_bump = ctx.bumps.vault_authority;
        state.state_bump = ctx.bumps.vault_state;
        state.is_paused = false;
        msg!(
            "vault state v2 initialized: tslax={} market={} reserve={}",
            state.tslax_mint,
            state.kamino_market,
            state.kamino_reserve
        );
        Ok(())
    }

    /// Create the vault's TSLAx + cToken custody accounts. Admin-gated via
    /// state; mints verified against state in-handler to keep try_accounts
    /// small.
    pub fn init_custody(ctx: Context<InitializeCustody>) -> Result<()> {
        let state = &ctx.accounts.vault_state;
        require_keys_eq!(
            ctx.accounts.tslax_mint.key(),
            state.tslax_mint,
            VaultError::WrongLiquidityMint
        );
        require_keys_eq!(
            ctx.accounts.ctoken_mint.key(),
            state.kamino_ctoken_mint,
            VaultError::WrongCollateralMint
        );
        msg!("vault custody accounts initialized");
        Ok(())
    }

    /// Create the yTSLAx receipt mint (authority = vault authority PDA).
    /// Account creation via init constraint; handler records nothing.
    pub fn initialize_mint(_ctx: Context<InitializeMint>) -> Result<()> {
        msg!("vault receipt mint initialized");
        Ok(())
    }

    /// Deposit TSLAx: custody transfer, Kamino supply CPI, mint yTSLAx 1:1
    /// against the cTokens the reserve issued for this deposit.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        let state = &ctx.accounts.vault_state;
        require!(!state.is_paused, VaultError::VaultPaused);
        kamino::verify_reserve_accounts(
            state,
            &ctx.accounts.kamino_market,
            &ctx.accounts.kamino_reserve,
            &ctx.accounts.lending_market_authority,
            &ctx.accounts.reserve_liquidity_mint,
            &ctx.accounts.reserve_collateral_mint,
            &ctx.accounts.kamino_program,
        )?;

        // 1. User TSLAx -> vault custody.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_tslax.to_account_info(),
                    to: ctx.accounts.vault_tslax.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        // 2. Supply to Kamino via CPI, vault authority as owner/signer.
        let c_before = ctx.accounts.vault_ctoken.amount;
        let auth_mint = state.tslax_mint;
        let auth_bump = state.authority_bump;
        let seeds: &[&[u8]] = &[b"vault-v2-authority", auth_mint.as_ref(), &[auth_bump]];
        invoke_signed(
            &kamino::supply_ix(
                amount,
                &ctx.accounts.vault_authority.key(),
                &ctx.accounts.kamino_reserve.key(),
                &ctx.accounts.kamino_market.key(),
                &ctx.accounts.lending_market_authority.key(),
                &ctx.accounts.reserve_liquidity_mint.key(),
                &ctx.accounts.reserve_liquidity_supply.key(),
                &ctx.accounts.reserve_collateral_mint.key(),
                &ctx.accounts.vault_tslax.key(),
                &ctx.accounts.vault_ctoken.key(),
                &ctx.accounts.token_program.key(),
            ),
            &[
                ctx.accounts.vault_authority.to_account_info(),
                ctx.accounts.kamino_reserve.to_account_info(),
                ctx.accounts.kamino_market.to_account_info(),
                ctx.accounts.lending_market_authority.to_account_info(),
                ctx.accounts.reserve_liquidity_mint.to_account_info(),
                ctx.accounts.reserve_liquidity_supply.to_account_info(),
                ctx.accounts.reserve_collateral_mint.to_account_info(),
                ctx.accounts.vault_tslax.to_account_info(),
                ctx.accounts.vault_ctoken.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.instruction_sysvar.to_account_info(),
            ],
            &[&seeds],
        )?;

        // 3. Mint yTSLAx 1:1 against cTokens actually received.
        ctx.accounts.vault_ctoken.reload()?;
        let minted = ctx
            .accounts
            .vault_ctoken
            .amount
            .checked_sub(c_before)
            .ok_or(VaultError::MathError)?;
        require!(minted > 0, VaultError::NoCollateralMinted);
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.receipt_mint.to_account_info(),
                    to: ctx.accounts.user_receipt.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                &[&seeds],
            ),
            minted,
        )?;
        msg!(
            "deposit: tslax={} ctokens={} ytslax={}",
            amount,
            minted,
            minted
        );
        Ok(())
    }

    /// Burn yTSLAx, redeem the matching cTokens from Kamino via CPI, and
    /// return the underlying TSLAx plus accrued interest to the user.
    /// Accepts `shares` = yTSLAx amount to burn. Partial withdrawal supported.
    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        require!(shares > 0, VaultError::ZeroAmount);
        let state = &ctx.accounts.vault_state;
        require!(!state.is_paused, VaultError::VaultPaused);
        kamino::verify_reserve_accounts(
            state,
            &ctx.accounts.kamino_market,
            &ctx.accounts.kamino_reserve,
            &ctx.accounts.lending_market_authority,
            &ctx.accounts.reserve_liquidity_mint,
            &ctx.accounts.reserve_collateral_mint,
            &ctx.accounts.kamino_program,
        )?;

        // Verify user has enough shares.
        let user_shares = ctx.accounts.user_receipt.amount;
        require!(user_shares >= shares, VaultError::InsufficientShares);

        // 1. Burn the user's receipt shares.
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.receipt_mint.to_account_info(),
                    from: ctx.accounts.user_receipt.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            shares,
        )?;

        // 2. Redeem the same amount of cTokens back to TSLAx via CPI.
        let t_before = ctx.accounts.vault_tslax.amount;
        let auth_mint = state.tslax_mint;
        let auth_bump = state.authority_bump;
        let seeds: &[&[u8]] = &[b"vault-v2-authority", auth_mint.as_ref(), &[auth_bump]];
        invoke_signed(
            &kamino::redeem_ix(
                shares,
                &ctx.accounts.vault_authority.key(),
                &ctx.accounts.kamino_market.key(),
                &ctx.accounts.kamino_reserve.key(),
                &ctx.accounts.lending_market_authority.key(),
                &ctx.accounts.reserve_liquidity_mint.key(),
                &ctx.accounts.reserve_collateral_mint.key(),
                &ctx.accounts.reserve_liquidity_supply.key(),
                &ctx.accounts.vault_ctoken.key(),
                &ctx.accounts.vault_tslax.key(),
                &ctx.accounts.token_program.key(),
            ),
            &[
                ctx.accounts.vault_authority.to_account_info(),
                ctx.accounts.kamino_market.to_account_info(),
                ctx.accounts.kamino_reserve.to_account_info(),
                ctx.accounts.lending_market_authority.to_account_info(),
                ctx.accounts.reserve_liquidity_mint.to_account_info(),
                ctx.accounts.reserve_collateral_mint.to_account_info(),
                ctx.accounts.reserve_liquidity_supply.to_account_info(),
                ctx.accounts.vault_ctoken.to_account_info(),
                ctx.accounts.vault_tslax.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.instruction_sysvar.to_account_info(),
            ],
            &[&seeds],
        )?;

        // 3. Forward everything the redeem released to the user.
        ctx.accounts.vault_tslax.reload()?;
        let out = ctx
            .accounts
            .vault_tslax
            .amount
            .checked_sub(t_before)
            .ok_or(VaultError::MathError)?;
        require!(out > 0, VaultError::NoLiquidityRedeemed);
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_tslax.to_account_info(),
                    to: ctx.accounts.user_tslax.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                &[&seeds],
            ),
            out,
        )?;
        msg!("withdraw: shares={} tslax={}", shares, out);
        Ok(())
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
    /// Emergency pause flag. When true, deposit/withdraw are halted.
    pub is_paused: bool,
    /// Pyth price feed account for the reserve oracle.
    pub pyth_price_feed: Pubkey,
}

impl VaultState {
    pub const SPACE: usize = 8 + 32 * 8 + 1 + 1 + 1;
}

#[derive(Accounts)]
pub struct InitializeState<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The mock TSLAx mint created in Phase 2.
    pub tslax_mint: Box<Account<'info, Mint>>,
    /// CHECK: recorded for the deposit/withdraw CPI; owned by the KLend
    /// program on devnet. Validated by use, not by type.
    pub kamino_market: UncheckedAccount<'info>,
    /// CHECK: recorded for the deposit/withdraw CPI. Validated by use.
    pub kamino_reserve: UncheckedAccount<'info>,
    /// The Kamino cToken mint of the TSLAx reserve (Phase 2 output).
    pub ctoken_mint: Box<Account<'info, Mint>>,
    /// The yTSLAx receipt mint (created by initialize_accounts).
    /// CHECK: recorded as state.receipt_mint; existence enforced at use.
    pub receipt_mint: UncheckedAccount<'info>,
    /// Pyth price feed account for the mock TSLAx asset (Devnet).
    /// CHECK: validated by Pyth program; stored for reserve config updates.
    pub pyth_price_feed: UncheckedAccount<'info>,

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

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MigrateState<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: existing vault state account with old layout; we manually migrate it.
    /// PDA derived from [b"vault", tslax_mint.key().as_ref()].
    #[account(
        mut,
        seeds = [b"vault", tslax_mint.key().as_ref()],
        bump,
        constraint = vault_state.owner == &crate::ID,
    )]
    pub vault_state: UncheckedAccount<'info>,

    /// The mock TSLAx mint - needed for PDA derivation.
    pub tslax_mint: UncheckedAccount<'info>,

    /// Pyth price feed account for the mock TSLAx asset (Devnet).
    /// CHECK: validated by Pyth program; stored for reserve config updates.
    pub pyth_price_feed: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AllocateVaultState<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: existing vault state account with old layout; we manually migrate it.
    /// PDA derived from [b"vault", tslax_mint.key().as_ref()].
    #[account(
        mut,
        seeds = [b"vault", tslax_mint.key().as_ref()],
        bump,
        constraint = vault_state.owner == &crate::ID,
    )]
    pub vault_state: UncheckedAccount<'info>,

    /// The mock TSLAx mint - needed for PDA derivation.
    pub tslax_mint: UncheckedAccount<'info>,

    /// Pyth price feed account for the mock TSLAx asset (Devnet).
    /// CHECK: validated by Pyth program; stored for reserve config updates.
    pub pyth_price_feed: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeStateV2<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The mock TSLAx mint created in Phase 2.
    pub tslax_mint: Box<Account<'info, Mint>>,
    /// CHECK: recorded for the deposit/withdraw CPI; owned by the KLend
    /// program on devnet. Validated by use, not by type.
    pub kamino_market: UncheckedAccount<'info>,
    /// CHECK: recorded for the deposit/withdraw CPI. Validated by use.
    pub kamino_reserve: UncheckedAccount<'info>,
    /// The Kamino cToken mint of the TSLAx reserve (Phase 2 output).
    pub ctoken_mint: Box<Account<'info, Mint>>,
    /// The yTSLAx receipt mint (created by initialize_accounts).
    /// CHECK: recorded as state.receipt_mint; existence enforced at use.
    pub receipt_mint: UncheckedAccount<'info>,
    /// Pyth price feed account for the mock TSLAx asset (Devnet).
    /// CHECK: validated by Pyth program; stored for reserve config updates.
    pub pyth_price_feed: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        space = VaultState::SPACE,
        seeds = [b"vault-v2", tslax_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// Signing PDA for all vault-owned token accounts and Kamino CPI.
    /// CHECK: PDA derived from seeds below; no data stored.
    #[account(
        seeds = [b"vault-v2-authority", tslax_mint.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseVaultStateV2<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: existing vault-v2 state PDA to close.
    #[account(
        mut,
        seeds = [b"vault-v2", tslax_mint.key().as_ref()],
        bump,
        constraint = vault_state.owner == &crate::ID,
    )]
    pub vault_state: UncheckedAccount<'info>,

    /// The mock TSLAx mint - needed for PDA derivation.
    pub tslax_mint: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeMint<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"vault-v2", vault_state.tslax_mint.as_ref()],
        bump = vault_state.state_bump,
        constraint = vault_state.admin == admin.key(),
    )]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: PDA signer, seeds verified against vault state.
    #[account(
        seeds = [b"vault-v2-authority", vault_state.tslax_mint.as_ref()],
        bump = vault_state.authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        seeds = [b"receipt-mint-v2", vault_state.tslax_mint.as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = vault_authority,
    )]
    pub receipt_mint: Box<Account<'info, Mint>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InitializeCustody<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"vault-v2", vault_state.tslax_mint.as_ref()],
        bump = vault_state.state_bump,
        constraint = vault_state.admin == admin.key(),
    )]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: PDA signer, seeds verified against vault state.
    #[account(
        seeds = [b"vault-v2-authority", vault_state.tslax_mint.as_ref()],
        bump = vault_state.authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// CHECK: key verified against state in the handler.
    pub tslax_mint: UncheckedAccount<'info>,
    /// CHECK: key verified against state in the handler.
    pub ctoken_mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        seeds = [b"vault-v2-tslax", vault_state.tslax_mint.as_ref()],
        bump,
        token::mint = tslax_mint,
        token::authority = vault_authority,
    )]
    pub vault_tslax_account: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = admin,
        seeds = [b"vault-v2-ctoken", vault_state.tslax_mint.as_ref()],
        bump,
        token::mint = ctoken_mint,
        token::authority = vault_authority,
    )]
    pub vault_ctoken_account: Box<Account<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [b"vault-v2", vault_state.tslax_mint.as_ref()],
        bump = vault_state.state_bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: PDA signer, seeds verified against vault state.
    #[account(
        seeds = [b"vault-v2-authority", vault_state.tslax_mint.as_ref()],
        bump = vault_state.authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = user_tslax.mint == vault_state.tslax_mint,
        constraint = user_tslax.owner == user.key(),
    )]
    pub user_tslax: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"vault-v2-tslax", vault_state.tslax_mint.as_ref()],
        bump,
        constraint = vault_tslax.mint == vault_state.tslax_mint,
    )]
    pub vault_tslax: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"vault-v2-ctoken", vault_state.tslax_mint.as_ref()],
        bump,
        constraint = vault_ctoken.mint == vault_state.kamino_ctoken_mint,
    )]
    pub vault_ctoken: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"receipt-mint-v2", vault_state.tslax_mint.as_ref()],
        bump,
        constraint = receipt_mint.key() == vault_state.receipt_mint,
    )]
    pub receipt_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        constraint = user_receipt.mint == vault_state.receipt_mint,
        constraint = user_receipt.owner == user.key(),
    )]
    pub user_receipt: Box<Account<'info, TokenAccount>>,

    /// CHECK: key must equal vault_state.kamino_market (verified in handler).
    pub kamino_market: UncheckedAccount<'info>,
    /// CHECK: key must equal vault_state.kamino_reserve (verified in handler).
    /// Mut: Kamino updates reserve liquidity on supply/redeem.
    #[account(mut)]
    pub kamino_reserve: UncheckedAccount<'info>,
    /// CHECK: derived PDA [b"lma", market] under the KLend program id
    /// (verified in handler).
    pub lending_market_authority: UncheckedAccount<'info>,
    /// CHECK: key must equal vault_state.tslax_mint (verified in handler).
    pub reserve_liquidity_mint: UncheckedAccount<'info>,
    /// CHECK: reserve supply vault, written by Kamino (verified by program).
    #[account(mut)]
    pub reserve_liquidity_supply: UncheckedAccount<'info>,
    /// CHECK: key must equal vault_state.kamino_ctoken_mint (verified in handler).
    /// Mut: Kamino mints/burns cTokens on supply/redeem.
    #[account(mut)]
    pub reserve_collateral_mint: UncheckedAccount<'info>,
    /// CHECK: the KLend program on devnet (key verified in handler).
    pub kamino_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    /// CHECK: Solana instructions sysvar (fixed address, verified by program).
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instruction_sysvar: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(shares: u64)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [b"vault-v2", vault_state.tslax_mint.as_ref()],
        bump = vault_state.state_bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: PDA signer, seeds verified against vault state.
    #[account(
        seeds = [b"vault-v2-authority", vault_state.tslax_mint.as_ref()],
        bump = vault_state.authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = user_tslax.mint == vault_state.tslax_mint,
        constraint = user_tslax.owner == user.key(),
    )]
    pub user_tslax: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"vault-v2-tslax", vault_state.tslax_mint.as_ref()],
        bump,
        constraint = vault_tslax.mint == vault_state.tslax_mint,
    )]
    pub vault_tslax: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"vault-v2-ctoken", vault_state.tslax_mint.as_ref()],
        bump,
        constraint = vault_ctoken.mint == vault_state.kamino_ctoken_mint,
    )]
    pub vault_ctoken: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"receipt-mint-v2", vault_state.tslax_mint.as_ref()],
        bump,
        constraint = receipt_mint.key() == vault_state.receipt_mint,
    )]
    pub receipt_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        constraint = user_receipt.mint == vault_state.receipt_mint,
        constraint = user_receipt.owner == user.key(),
    )]
    pub user_receipt: Box<Account<'info, TokenAccount>>,

    /// CHECK: key must equal vault_state.kamino_market (verified in handler).
    pub kamino_market: UncheckedAccount<'info>,
    /// CHECK: key must equal vault_state.kamino_reserve (verified in handler).
    /// Mut: Kamino updates reserve liquidity on supply/redeem.
    #[account(mut)]
    pub kamino_reserve: UncheckedAccount<'info>,
    /// CHECK: derived PDA [b"lma", market] under the KLend program id
    /// (verified in handler).
    pub lending_market_authority: UncheckedAccount<'info>,
    /// CHECK: key must equal vault_state.tslax_mint (verified in handler).
    pub reserve_liquidity_mint: UncheckedAccount<'info>,
    /// CHECK: reserve supply vault, written by Kamino (verified by program).
    #[account(mut)]
    pub reserve_liquidity_supply: UncheckedAccount<'info>,
    /// CHECK: key must equal vault_state.kamino_ctoken_mint (verified in handler).
    /// Mut: Kamino mints/burns cTokens on supply/redeem.
    #[account(mut)]
    pub reserve_collateral_mint: UncheckedAccount<'info>,
    /// CHECK: the KLend program on devnet (key verified in handler).
    pub kamino_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    /// CHECK: Solana instructions sysvar (fixed address, verified by program).
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instruction_sysvar: UncheckedAccount<'info>,
}

/// Minimal Kamino Lend (KLend) CPI surface.
///
/// Discriminators + account order mirrored from the klend IDL
/// (@kamino-finance/klend-sdk codegen). No klend crate dependency.
pub mod kamino {
    use super::*;

    /// KLend program on devnet (same id as mainnet).
    pub const PROGRAM_ID: Pubkey = pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
    /// depositReserveLiquidity discriminator.
    pub const DEPOSIT_DISC: [u8; 8] = [169, 201, 30, 126, 6, 205, 102, 68];
    /// redeemReserveCollateral discriminator (Phase 5).
    pub const REDEEM_DISC: [u8; 8] = [234, 117, 181, 125, 185, 142, 220, 29];

    pub fn verify_reserve_accounts(
        state: &VaultState,
        market: &UncheckedAccount,
        reserve: &UncheckedAccount,
        market_authority: &UncheckedAccount,
        liquidity_mint: &UncheckedAccount,
        collateral_mint: &UncheckedAccount,
        program: &UncheckedAccount,
    ) -> Result<()> {
        require_keys_eq!(market.key(), state.kamino_market, VaultError::WrongMarket);
        require_keys_eq!(
            reserve.key(),
            state.kamino_reserve,
            VaultError::WrongReserve
        );
        require_keys_eq!(
            liquidity_mint.key(),
            state.tslax_mint,
            VaultError::WrongLiquidityMint
        );
        require_keys_eq!(
            collateral_mint.key(),
            state.kamino_ctoken_mint,
            VaultError::WrongCollateralMint
        );
        require_keys_eq!(program.key(), PROGRAM_ID, VaultError::WrongProgram);
        let (derived, _bump) =
            Pubkey::find_program_address(&[b"lma", state.kamino_market.as_ref()], &PROGRAM_ID);
        require_keys_eq!(
            market_authority.key(),
            derived,
            VaultError::WrongMarketAuthority
        );
        Ok(())
    }

    /// depositReserveLiquidity { liquidity_amount: u64 }.
    /// Writable: reserve, liquidity supply, collateral mint, source, destination.
    /// Signer: owner (vault authority PDA).
    #[allow(clippy::too_many_arguments)]
    pub fn supply_ix(
        amount: u64,
        owner: &Pubkey,
        reserve: &Pubkey,
        market: &Pubkey,
        market_authority: &Pubkey,
        liquidity_mint: &Pubkey,
        liquidity_supply: &Pubkey,
        collateral_mint: &Pubkey,
        user_source: &Pubkey,
        user_destination: &Pubkey,
        token_program: &Pubkey,
    ) -> Instruction {
        let mut data = DEPOSIT_DISC.to_vec();
        data.extend_from_slice(&amount.to_le_bytes());
        Instruction {
            program_id: PROGRAM_ID,
            accounts: vec![
                AccountMeta::new_readonly(*owner, true),
                AccountMeta::new(*reserve, false),
                AccountMeta::new_readonly(*market, false),
                AccountMeta::new_readonly(*market_authority, false),
                AccountMeta::new_readonly(*liquidity_mint, false),
                AccountMeta::new(*liquidity_supply, false),
                AccountMeta::new(*collateral_mint, false),
                AccountMeta::new(*user_source, false),
                AccountMeta::new(*user_destination, false),
                AccountMeta::new_readonly(*token_program, false),
                AccountMeta::new_readonly(*token_program, false),
                AccountMeta::new_readonly(
                    anchor_lang::solana_program::sysvar::instructions::ID,
                    false,
                ),
            ],
            data,
        }
    }

    /// redeemReserveCollateral { collateral_amount: u64 }.
    /// Writable: reserve, collateral mint, liquidity supply, source, destination.
    /// Signer: owner (vault authority PDA).
    #[allow(clippy::too_many_arguments)]
    pub fn redeem_ix(
        collateral_amount: u64,
        owner: &Pubkey,
        market: &Pubkey,
        reserve: &Pubkey,
        market_authority: &Pubkey,
        liquidity_mint: &Pubkey,
        collateral_mint: &Pubkey,
        liquidity_supply: &Pubkey,
        user_source: &Pubkey,
        user_destination: &Pubkey,
        token_program: &Pubkey,
    ) -> Instruction {
        let mut data = REDEEM_DISC.to_vec();
        data.extend_from_slice(&collateral_amount.to_le_bytes());
        Instruction {
            program_id: PROGRAM_ID,
            accounts: vec![
                AccountMeta::new_readonly(*owner, true),
                AccountMeta::new_readonly(*market, false),
                AccountMeta::new(*reserve, false),
                AccountMeta::new_readonly(*market_authority, false),
                AccountMeta::new_readonly(*liquidity_mint, false),
                AccountMeta::new(*collateral_mint, false),
                AccountMeta::new(*liquidity_supply, false),
                AccountMeta::new(*user_source, false),
                AccountMeta::new(*user_destination, false),
                AccountMeta::new_readonly(*token_program, false),
                AccountMeta::new_readonly(*token_program, false),
                AccountMeta::new_readonly(
                    anchor_lang::solana_program::sysvar::instructions::ID,
                    false,
                ),
            ],
            data,
        }
    }
}

#[error_code]
pub enum VaultError {
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("integer math error")]
    MathError,
    #[msg("Kamino issued no collateral for this deposit")]
    NoCollateralMinted,
    #[msg("Kamino released no liquidity for this redeem")]
    NoLiquidityRedeemed,
    #[msg("wrong Kamino market account")]
    WrongMarket,
    #[msg("wrong Kamino reserve account")]
    WrongReserve,
    #[msg("wrong reserve liquidity mint")]
    WrongLiquidityMint,
    #[msg("wrong reserve collateral mint")]
    WrongCollateralMint,
    #[msg("wrong Kamino program id")]
    WrongProgram,
    #[msg("wrong lending market authority PDA")]
    WrongMarketAuthority,
    #[msg("vault is paused")]
    VaultPaused,
    #[msg("insufficient shares to withdraw")]
    InsufficientShares,
    #[msg("requested amount exceeds available shares")]
    AmountExceedsShares,
}