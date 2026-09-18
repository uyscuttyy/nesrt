use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    sysvar::instructions::Instructions,
};
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB");

/// TSLAx Yield Vault (Devnet MVP).
///
/// Custodies user TSLAx in a vault PDA and routes it into a Mock Lender
/// reserve via CPI. Receipt token nTSLA tracks each depositor's share.
#[program]
pub mod vault {
    use super::*;

    /// Initialize vault state for a given TSLAx mint and Mock Lender pool.
    pub fn initialize_state(ctx: Context<InitializeState>) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        state.admin = ctx.accounts.admin.key();
        state.tslax_mint = ctx.accounts.tslax_mint.key();
        state.receipt_mint = ctx.accounts.receipt_mint.key();
        state.mock_lender_pool = ctx.accounts.mock_lender_pool.key();
        state.mock_lender_shares_mint = ctx.accounts.mock_lender_shares_mint.key();
        state.pyth_price_feed = ctx.accounts.pyth_price_feed.key();
        state.authority_bump = ctx.bumps.vault_authority;
        state.state_bump = ctx.bumps.vault_state;
        state.is_paused = false;
        state.protocol_fee_bps = 1000;
        msg!(
            "vault state initialized: tslax={} pool={} shares={}",
            state.tslax_mint,
            state.mock_lender_pool,
            state.mock_lender_shares_mint
        );
        Ok(())
    }

    /// Admin-only instruction to close the old vault state PDA.
    pub fn migrate_state(ctx: Context<MigrateState>) -> Result<()> {
        let vault_state_info = &ctx.accounts.vault_state;
        let data = vault_state_info.try_borrow_data()?;
        require!(data.len() >= 8, VaultError::MathError);
        let expected_disc: [u8; 8] = [228, 196, 82, 165, 98, 210, 235, 152];
        require!(&data[0..8] == expected_disc, VaultError::MathError);
        drop(data);

        let lamports = vault_state_info.lamports();
        **vault_state_info.try_borrow_mut_lamports()? = 0;
        **ctx.accounts.admin.try_borrow_mut_lamports()? = ctx
            .accounts
            .admin
            .lamports()
            .checked_add(lamports)
            .ok_or(VaultError::MathError)?;

        let mut data_mut = vault_state_info.try_borrow_mut_data()?;
        data_mut[0..8].fill(0);

        msg!("vault state PDA closed; re-run initialize_state_v2 to recreate with new layout");
        Ok(())
    }

    pub fn close_vault_state_v2(ctx: Context<CloseVaultStateV2>) -> Result<()> {
        let vault_state_info = &ctx.accounts.vault_state;
        let data = vault_state_info.try_borrow_data()?;
        require!(data.len() >= 8, VaultError::MathError);
        let expected_disc: [u8; 8] = [228, 196, 82, 165, 98, 210, 235, 152];
        require!(&data[0..8] == expected_disc, VaultError::MathError);
        drop(data);

        let lamports = vault_state_info.lamports();
        **vault_state_info.try_borrow_mut_lamports()? = 0;
        **ctx.accounts.admin.try_borrow_mut_lamports()? = ctx
            .accounts
            .admin
            .lamports()
            .checked_add(lamports)
            .ok_or(VaultError::MathError)?;

        let mut data_mut = vault_state_info.try_borrow_mut_data()?;
        data_mut[0..8].fill(0);

        msg!("vault state v2 PDA closed; re-run initialize_state_v2 to recreate");
        Ok(())
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        require_keys_eq!(
            ctx.accounts.admin.key(),
            state.admin,
            VaultError::WrongAdmin
        );
        state.is_paused = paused;
        msg!("vault paused={}", paused);
        Ok(())
    }

    pub fn set_admin(ctx: Context<SetAdmin>, new_admin: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        require_keys_eq!(
            ctx.accounts.admin.key(),
            state.admin,
            VaultError::WrongAdmin
        );
        state.admin = new_admin;
        msg!(
            "vault admin updated: old={} new={}",
            ctx.accounts.admin.key(),
            new_admin
        );
        Ok(())
    }

    pub fn update_kamino_config(        ctx: Context<UpdateKaminoConfig>,
        new_kamino_market: Pubkey,
        new_kamino_reserve: Pubkey,
        new_kamino_ctoken_mint: Pubkey,
        new_kamino_pyth_feed: Pubkey,
    ) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        require_keys_eq!(
            ctx.accounts.admin.key(),
            state.admin,
            VaultError::WrongAdmin
        );
        state.kamino_market = new_kamino_market;
        state.kamino_reserve = new_kamino_reserve;
        state.kamino_ctoken_mint = new_kamino_ctoken_mint;
        state.pyth_price_feed = new_kamino_pyth_feed;
        msg!(
            "kamino config updated: market={} reserve={} ctoken={} pyth={}",
            new_kamino_market,
            new_kamino_reserve,
            new_kamino_ctoken_mint,
            new_kamino_pyth_feed
        );
        Ok(())
    }

    /// Admin-only: point the vault at a (new) mock lender pool + shares mint.
    /// Needed when the lending program is redeployed (pool PDA changes).
    pub fn update_mock_pool(
        ctx: Context<UpdateMockPool>,
        new_pool: Pubkey,
        new_shares_mint: Pubkey,
    ) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        require_keys_eq!(
            ctx.accounts.admin.key(),
            state.admin,
            VaultError::WrongAdmin
        );
        state.mock_lender_pool = new_pool;
        state.mock_lender_shares_mint = new_shares_mint;
        msg!(
            "mock pool updated: pool={} shares={}",
            new_pool,
            new_shares_mint
        );
        Ok(())
    }

    /// Admin-only: create the treasury token PDA that receives the 10% fee.
    pub fn init_treasury(ctx: Context<InitTreasury>) -> Result<()> {
        msg!(
            "treasury initialized: {}",
            ctx.accounts.treasury.key()
        );
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        let state = &ctx.accounts.vault_state;
        require!(!state.is_paused, VaultError::VaultPaused);

        // Verify mock lender accounts
        require_keys_eq!(
            ctx.accounts.mock_lender_pool.key(),
            state.mock_lender_pool,
            VaultError::WrongMarket
        );
        require_keys_eq!(
            ctx.accounts.mock_lender_shares_mint.key(),
            state.mock_lender_shares_mint,
            VaultError::WrongCollateralMint
        );
        require_keys_eq!(
            ctx.accounts.tslax_mint.key(),
            state.tslax_mint,
            VaultError::WrongLiquidityMint
        );

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

        // 2. Supply to Mock Lender via CPI, vault authority as owner/signer.
        // Vault-scoped: source = vault TSLAx custody (already funded in step 1),
        // destination = vault shares custody, pool vault receives the liquidity.
        // NOTE: mock_program must be an explicit account of this instruction:
        // without lift_cpi_caller_restriction the runtime resolves CPI callees
        // from the caller's instruction accounts ("Unknown program" otherwise).
        let shares_before = ctx.accounts.vault_shares.amount;
        let auth_mint = state.tslax_mint;
        let auth_bump = state.authority_bump;
        let seeds: &[&[u8]] = &[b"vault-v2-authority", auth_mint.as_ref(), &[auth_bump]];
        require_keys_eq!(
            ctx.accounts.mock_program.key(),
            mock_lender::PROGRAM_ID,
            VaultError::WrongMarket
        );
        invoke_signed(
            &mock_lender::deposit_ix(
                amount,
                &ctx.accounts.vault_authority.key(),
                &ctx.accounts.tslax_mint.key(),
                &ctx.accounts.mock_lender_pool.key(),
                &ctx.accounts.vault_tslax.key(),
                &ctx.accounts.pool_vault.key(),
                &ctx.accounts.mock_lender_shares_mint.key(),
                &ctx.accounts.vault_shares.key(),
                &ctx.accounts.token_program.key(),
            ),
            &[
                ctx.accounts.vault_authority.to_account_info(),
                ctx.accounts.tslax_mint.to_account_info(),
                ctx.accounts.mock_lender_pool.to_account_info(),
                ctx.accounts.vault_tslax.to_account_info(),
                ctx.accounts.pool_vault.to_account_info(),
                ctx.accounts.mock_lender_shares_mint.to_account_info(),
                ctx.accounts.vault_shares.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
            &[seeds],
        )?;

        // 3. Verify Mock Lender minted shares for this deposit.
        ctx.accounts.vault_shares.reload()?;
        let shares_after = ctx.accounts.vault_shares.amount;
        let shares_minted = shares_after
            .checked_sub(shares_before)
            .ok_or(VaultError::MathError)?;
        require!(shares_minted > 0, VaultError::NoCollateralMinted);

        // 4. Mint nTSLA 1:1 against shares received.
        let receipt_mint_account = ctx.accounts.receipt_mint.to_account_info();
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: receipt_mint_account,
                    to: ctx.accounts.user_receipt.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                &[seeds],
            ),
            shares_minted,
        )?;

        msg!(
            "deposit: amount={} shares_minted={} ntsla_minted={}",
            amount, shares_minted, shares_minted
        );

        // 5. Update vault state accounting (principal + shares).
        let state = &mut ctx.accounts.vault_state;
        state.total_deposits = state
            .total_deposits
            .checked_add(amount)
            .ok_or(VaultError::MathError)?;
        state.total_shares = state
            .total_shares
            .checked_add(shares_minted)
            .ok_or(VaultError::MathError)?;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        require!(shares > 0, VaultError::ZeroAmount);
        let state = &ctx.accounts.vault_state;
        require!(!state.is_paused, VaultError::VaultPaused);

        // Verify mock lender accounts
        require_keys_eq!(
            ctx.accounts.mock_lender_pool.key(),
            state.mock_lender_pool,
            VaultError::WrongMarket
        );
        require_keys_eq!(
            ctx.accounts.mock_lender_shares_mint.key(),
            state.mock_lender_shares_mint,
            VaultError::WrongCollateralMint
        );
        require_keys_eq!(
            ctx.accounts.mock_program.key(),
            mock_lender::PROGRAM_ID,
            VaultError::WrongMarket
        );

        // 1. Burn nTSLA from user.
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

        // 2. Redeem from Mock Lender via CPI into vault custody.
        // Vault-scoped: burn vault shares, pool vault sends TSLAx to vault custody.
        let vault_tslax_before = ctx.accounts.vault_tslax.amount;
        let auth_mint = state.tslax_mint;
        let auth_bump = state.authority_bump;
        let seeds: &[&[u8]] = &[b"vault-v2-authority", auth_mint.as_ref(), &[auth_bump]];
        invoke_signed(
            &mock_lender::redeem_ix(
                shares,
                &ctx.accounts.vault_authority.key(),
                &ctx.accounts.tslax_mint.key(),
                &ctx.accounts.mock_lender_pool.key(),
                &ctx.accounts.vault_shares.key(),
                &ctx.accounts.pool_vault.key(),
                &ctx.accounts.mock_lender_shares_mint.key(),
                &ctx.accounts.vault_tslax.key(),
                &ctx.accounts.token_program.key(),
            ),
            &[
                ctx.accounts.vault_authority.to_account_info(),
                ctx.accounts.tslax_mint.to_account_info(),
                ctx.accounts.mock_lender_pool.to_account_info(),
                ctx.accounts.vault_shares.to_account_info(),
                ctx.accounts.pool_vault.to_account_info(),
                ctx.accounts.mock_lender_shares_mint.to_account_info(),
                ctx.accounts.vault_tslax.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
            &[seeds],
        )?;

        // 3. Verify Mock Lender delivered TSLAx to vault custody (balance grows).
        ctx.accounts.vault_tslax.reload()?;
        let vault_tslax_after = ctx.accounts.vault_tslax.amount;
        let tslax_redeemed = vault_tslax_after
            .checked_sub(vault_tslax_before)
            .ok_or(VaultError::MathError)?;
        require!(tslax_redeemed > 0, VaultError::NoLiquidityRedeemed);

        // 4. Calculate yield portion and skim 10% to treasury.
        let principal_portion = (shares as u128)
            .checked_mul(state.total_deposits as u128)
            .ok_or(VaultError::MathError)?
            .checked_div(state.total_shares.max(1) as u128)
            .ok_or(VaultError::MathError)? as u64;

        let yield_portion = tslax_redeemed.saturating_sub(principal_portion);
        let treasury_fee = yield_portion
            .checked_mul(state.protocol_fee_bps as u64)
            .ok_or(VaultError::MathError)?
            .checked_div(10000)
            .ok_or(VaultError::MathError)?;

        if treasury_fee > 0 {
            // Transfer fee from vault custody to treasury
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault_tslax.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                    },
                    &[seeds],
                ),
                treasury_fee,
            )?;
        }

        // 5. Pay the user their share (redeemed less the treasury fee).
        let user_payout = tslax_redeemed
            .checked_sub(treasury_fee)
            .ok_or(VaultError::MathError)?;
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_tslax.to_account_info(),
                    to: ctx.accounts.user_tslax.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                &[seeds],
            ),
            user_payout,
        )?;

        // 6. Update vault state accounting.
        let state = &mut ctx.accounts.vault_state;
        state.total_deposits = state.total_deposits.saturating_sub(principal_portion);
        state.total_shares = state
            .total_shares
            .checked_sub(shares)
            .ok_or(VaultError::MathError)?;
        state.total_yield_skimmed = state
            .total_yield_skimmed
            .checked_add(treasury_fee)
            .ok_or(VaultError::MathError)?;

        msg!(
            "withdraw: shares={} tslax_out={} principal={} yield={} treasury_fee={}",
            shares, user_payout, principal_portion, yield_portion, treasury_fee
        );
        Ok(())
    }

    pub fn crank_yield(ctx: Context<CrankYield>) -> Result<()> {
        let state = &ctx.accounts.vault_state;
        require!(!state.is_paused, VaultError::VaultPaused);

        // Invoke mock_lender's drip_yield to simulate yield accrual
        let auth_mint = state.tslax_mint;
        let auth_bump = state.authority_bump;
        let seeds: &[&[u8]] = &[b"vault-v2-authority", auth_mint.as_ref(), &[auth_bump]];
        
        let drip_amount = 100_000_000u64; // 100 TSLAx (6 decimals) per crank
        
        let ix = Instruction {
            program_id: mock_lender::PROGRAM_ID,
            accounts: vec![
                AccountMeta::new_readonly(ctx.accounts.admin.key(), true),
                AccountMeta::new(state.mock_lender_pool, false),
                AccountMeta::new(ctx.accounts.admin_tslax.key(), false),
                AccountMeta::new(ctx.accounts.mock_lender_vault.key(), false),
                AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
            ],
            data: {
                let mut data = mock_lender::DRIP_DISC.to_vec(); // drip_yield discriminator
                data.extend_from_slice(&drip_amount.to_le_bytes());
                data
            },
        };

        invoke_signed(
            &ix,
            &[
                ctx.accounts.admin.to_account_info(),
                ctx.accounts.mock_lender_pool.to_account_info(),
                ctx.accounts.admin_tslax.to_account_info(),
                ctx.accounts.mock_lender_vault.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
            &[seeds],
        )?;

        msg!("crank_yield: dripped={}", drip_amount);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeState<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = VaultState::SPACE,
        seeds = [b"vault-v2", tslax_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    #[account(
        init,
        payer = admin,
        space = 8,
        seeds = [b"vault-v2-authority", tslax_mint.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        mint::decimals = 6,
        mint::authority = vault_authority,
        mint::freeze_authority = vault_authority,
        seeds = [b"receipt", tslax_mint.key().as_ref()],
        bump,
    )]
    pub receipt_mint: Box<Account<'info, Mint>>,

    pub tslax_mint: Box<Account<'info, Mint>>,

    pub mock_lender_pool: UncheckedAccount<'info>,
    pub mock_lender_shares_mint: UncheckedAccount<'info>,
    pub pyth_price_feed: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct MigrateState<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault-v2", tslax_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: UncheckedAccount<'info>,

    pub tslax_mint: Box<Account<'info, Mint>>,
}

#[derive(Accounts)]
pub struct CloseVaultStateV2<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault-v2", tslax_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: UncheckedAccount<'info>,

    pub tslax_mint: Box<Account<'info, Mint>>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault-v2", tslax_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    pub tslax_mint: Box<Account<'info, Mint>>,
}

#[derive(Accounts)]
pub struct SetAdmin<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault-v2", tslax_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    pub tslax_mint: Box<Account<'info, Mint>>,
}

#[derive(Accounts)]
pub struct UpdateKaminoConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault-v2", tslax_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    pub tslax_mint: Box<Account<'info, Mint>>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault-v2", tslax_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    #[account(
        mut,
        seeds = [b"vault-v2-authority", tslax_mint.key().as_ref()],
        bump = vault_state.authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = user_tslax.mint == tslax_mint.key(),
        constraint = user_tslax.owner == user.key(),
    )]
    pub user_tslax: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = vault_tslax.mint == tslax_mint.key(),
        constraint = vault_tslax.owner == vault_authority.key(),
    )]
    pub vault_tslax: Box<Account<'info, TokenAccount>>,

    pub tslax_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub mock_lender_pool: UncheckedAccount<'info>,

    #[account(mut)]
    pub mock_lender_shares_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        constraint = vault_shares.mint == mock_lender_shares_mint.key(),
        constraint = vault_shares.owner == vault_authority.key(),
    )]
    pub vault_shares: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = receipt_mint.key() == vault_state.receipt_mint,
    )]
    pub receipt_mint: Box<Account<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = receipt_mint,
        associated_token::authority = user,
    )]
    pub user_receipt: Box<Account<'info, TokenAccount>>,

    /// Mock pool's TSLAx vault (receives liquidity on deposit).
    #[account(mut)]
    pub pool_vault: Box<Account<'info, TokenAccount>>,

    /// Mock lender program: must be present so the runtime can resolve the
    /// CPI callee from this instruction's accounts.
    /// CHECK: verified against mock_lender::PROGRAM_ID in the handler.
    pub mock_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
    /// CHECK: instructions sysvar
    pub instruction_sysvar: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct UpdateMockPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault-v2", tslax_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    pub tslax_mint: Box<Account<'info, Mint>>,
}

#[derive(Accounts)]
pub struct InitTreasury<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"vault-v2", tslax_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    #[account(
        seeds = [b"vault-v2-authority", tslax_mint.key().as_ref()],
        bump = vault_state.authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    pub tslax_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = admin,
        seeds = [b"vault-treasury", tslax_mint.key().as_ref()],
        bump,
        token::mint = tslax_mint,
        token::authority = vault_authority,
    )]
    pub treasury: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault-v2", tslax_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    #[account(
        mut,
        seeds = [b"vault-v2-authority", tslax_mint.key().as_ref()],
        bump = vault_state.authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = user_tslax.mint == tslax_mint.key(),
        constraint = user_tslax.owner == user.key(),
    )]
    pub user_tslax: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = vault_tslax.mint == tslax_mint.key(),
        constraint = vault_tslax.owner == vault_authority.key(),
    )]
    pub vault_tslax: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = receipt_mint.key() == vault_state.receipt_mint,
    )]
    pub receipt_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        constraint = user_receipt.mint == vault_state.receipt_mint,
        constraint = user_receipt.owner == user.key(),
    )]
    pub user_receipt: Box<Account<'info, TokenAccount>>,

    pub tslax_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub mock_lender_pool: UncheckedAccount<'info>,

    #[account(mut)]
    pub mock_lender_shares_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        constraint = vault_shares.mint == mock_lender_shares_mint.key(),
        constraint = vault_shares.owner == vault_authority.key(),
    )]
    pub vault_shares: Box<Account<'info, TokenAccount>>,

    /// Mock pool's TSLAx vault (sends liquidity on redeem).
    #[account(mut)]
    pub pool_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"vault-treasury", tslax_mint.key().as_ref()],
        bump,
    )]
    pub treasury: Box<Account<'info, TokenAccount>>,

    /// Mock lender program: must be present so the runtime can resolve the
    /// CPI callee from this instruction's accounts.
    /// CHECK: verified against mock_lender::PROGRAM_ID in the handler.
    pub mock_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    /// CHECK: instructions sysvar
    pub instruction_sysvar: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CrankYield<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault-v2", tslax_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    #[account(
        mut,
        seeds = [b"vault-v2-authority", tslax_mint.key().as_ref()],
        bump = vault_state.authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    pub tslax_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub mock_lender_pool: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = admin_tslax.mint == tslax_mint.key(),
        constraint = admin_tslax.owner == admin.key(),
    )]
    pub admin_tslax: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = mock_lender_vault.mint == tslax_mint.key(),
    )]
    pub mock_lender_vault: Box<Account<'info, TokenAccount>>,

    /// Mock lender program: must be present so the runtime can resolve the
    /// CPI callee from this instruction's accounts.
    /// CHECK: the drip CPI targets mock_lender::PROGRAM_ID.
    pub mock_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    /// CHECK: instructions sysvar
    pub instruction_sysvar: UncheckedAccount<'info>,
}

#[account]
pub struct VaultState {
    pub admin: Pubkey,
    pub tslax_mint: Pubkey,
    pub receipt_mint: Pubkey,
    pub mock_lender_pool: Pubkey,
    pub mock_lender_shares_mint: Pubkey,
    pub pyth_price_feed: Pubkey,
    pub authority_bump: u8,
    pub state_bump: u8,
    pub is_paused: bool,
    pub protocol_fee_bps: u16,
    pub total_deposits: u64,
    pub total_shares: u64,
    pub total_yield_skimmed: u64,
    pub kamino_market: Pubkey,
    pub kamino_reserve: Pubkey,
    pub kamino_ctoken_mint: Pubkey,
}

impl VaultState {
    pub const SPACE: usize = 8 + 32 * 9 + 1 + 1 + 1 + 2 + 8 * 3;
}

#[error_code]
pub enum VaultError {
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("integer math error")]
    MathError,
    #[msg("Mock lender issued no shares for this deposit")]
    NoCollateralMinted,
    #[msg("Mock lender released no liquidity for this redeem")]
    NoLiquidityRedeemed,
    #[msg("wrong Mock Lender pool account")]
    WrongMarket,
    #[msg("wrong Mock Lender reserve account")]
    WrongReserve,
    #[msg("wrong Mock Lender collateral mint")]
    WrongCollateralMint,
    #[msg("wrong liquidity mint")]
    WrongLiquidityMint,
    #[msg("vault is paused")]
    VaultPaused,
    #[msg("wrong admin")]
    WrongAdmin,
    #[msg("vault state already exists")]
    AlreadyInitialized,
}

/// Mock Lender CPI surface.
///
/// Discriminators + account order for the mock_lender program.
pub mod mock_lender {
    use super::*;

    pub const PROGRAM_ID: Pubkey = pubkey!("7fssoWBo1sjse4es9moMpMZm6Hpa9Kzb7U5KXXpYpp4g");
    pub const DEPOSIT_DISC: [u8; 8] = [169, 201, 30, 126, 6, 205, 102, 68];
    pub const REDEEM_DISC: [u8; 8] = [234, 117, 181, 125, 185, 142, 220, 29];
    pub const DRIP_DISC: [u8; 8] = [239, 228, 57, 16, 123, 244, 173, 146];

    /// Vault-scoped deposit into mock_lender:
    /// owner = vault authority (PDA signer), source = vault TSLAx custody,
    /// vault = mock pool vault, destination = vault shares custody (pre-created).
    /// Account order must match mock DepositReserveLiquidity.
    pub fn deposit_ix(
        amount: u64,
        owner: &Pubkey,
        tslax_mint: &Pubkey,
        pool: &Pubkey,
        vault_source: &Pubkey,
        pool_vault: &Pubkey,
        shares_mint: &Pubkey,
        vault_destination: &Pubkey,
        token_program: &Pubkey,
    ) -> Instruction {
        let mut data = DEPOSIT_DISC.to_vec();
        data.extend_from_slice(&amount.to_le_bytes());
        Instruction {
            program_id: PROGRAM_ID,
            accounts: vec![
                // owner must be writable: mock declares user #[account(mut)].
                AccountMeta::new(*owner, true),
                AccountMeta::new_readonly(*tslax_mint, false),
                AccountMeta::new(*pool, false),
                AccountMeta::new(*vault_source, false),
                AccountMeta::new(*pool_vault, false),
                AccountMeta::new(*shares_mint, false),
                AccountMeta::new(*vault_destination, false),
                AccountMeta::new_readonly(*token_program, false),
            ],
            data,
        }
    }

    /// Vault-scoped redeem from mock_lender:
    /// burns vault shares, pool vault sends TSLAx back to vault custody.
    /// Account order must match mock RedeemReserveCollateral.
    pub fn redeem_ix(
        shares: u64,
        owner: &Pubkey,
        tslax_mint: &Pubkey,
        pool: &Pubkey,
        vault_shares_source: &Pubkey,
        pool_vault: &Pubkey,
        shares_mint: &Pubkey,
        vault_destination: &Pubkey,
        token_program: &Pubkey,
    ) -> Instruction {
        let mut data = REDEEM_DISC.to_vec();
        data.extend_from_slice(&shares.to_le_bytes());
        Instruction {
            program_id: PROGRAM_ID,
            accounts: vec![
                // owner must be writable: mock declares user #[account(mut)].
                AccountMeta::new(*owner, true),
                AccountMeta::new_readonly(*tslax_mint, false),
                AccountMeta::new(*pool, false),
                AccountMeta::new(*vault_shares_source, false),
                AccountMeta::new(*pool_vault, false),
                AccountMeta::new(*shares_mint, false),
                AccountMeta::new(*vault_destination, false),
                AccountMeta::new_readonly(*token_program, false),
            ],
            data,
        }
    }
}