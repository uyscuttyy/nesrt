use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("7fssoWBo1sjse4es9moMpMZm6Hpa9Kzb7U5KXXpYpp4g");

#[program]
pub mod mock_lender {
    use super::*;

    /// Initialize a new lending pool for TSLAx
    pub fn initialize_pool(ctx: Context<InitializePool>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.tslax_mint = ctx.accounts.tslax_mint.key();
        pool.vault = ctx.accounts.vault.key();
        pool.shares_mint = ctx.accounts.shares_mint.key();
        pool.total_deposits = 0;
        pool.total_shares = 0;
        pool.yield_accrued = 0;
        pool.bump = ctx.bumps.pool;
        
        msg!("Mock lender pool initialized: pool={} vault={}", pool.key(), pool.vault);
        Ok(())
    }

    /// Deposit TSLAx into the pool, receive shares (cTokens equivalent)
    /// This mimics Kamino's depositReserveLiquidity
    pub fn deposit_reserve_liquidity(ctx: Context<DepositReserveLiquidity>, amount: u64) -> Result<()> {
        require!(amount > 0, MockLenderError::ZeroAmount);
        
        // Pool PDA signs for minting (it IS the pool authority; no separate account).
        let pool_info = ctx.accounts.pool.to_account_info();
        let pool_bump = ctx.accounts.pool.bump;
        let tslax_key = ctx.accounts.tslax_mint.key();
        let pool = &mut ctx.accounts.pool;
        
        // Transfer TSLAx from user to pool vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_source.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        // Calculate shares minted (1:1 for simplicity, like cTokens)
        let shares = if pool.total_shares == 0 {
            amount
        } else {
            // share = amount * total_shares / total_deposits
            (amount as u128)
                .checked_mul(pool.total_shares as u128)
                .ok_or(MockLenderError::MathError)?
                .checked_div(pool.total_deposits as u128)
                .ok_or(MockLenderError::MathError)? as u64
        };
        
        require!(shares > 0, MockLenderError::ZeroAmount);

        // Mint shares to user destination (cToken equivalent).
        // Authority is the pool PDA itself (passed as `pool`, signs via seeds),
        // so no separate pool_authority account is needed (it would alias pool).
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.shares_mint.to_account_info(),
                    to: ctx.accounts.user_destination.to_account_info(),
                    authority: pool_info,
                },
                &[&[
                    b"pool",
                    tslax_key.as_ref(),
                    &[pool_bump],
                ]],
            ),
            shares,
        )?;

        pool.total_deposits = pool.total_deposits.checked_add(amount).ok_or(MockLenderError::MathError)?;
        pool.total_shares = pool.total_shares.checked_add(shares).ok_or(MockLenderError::MathError)?;
        
        msg!("Deposit: amount={} shares={} total_deposits={} total_shares={}", 
             amount, shares, pool.total_deposits, pool.total_shares);
        Ok(())
    }

    /// Redeem shares for TSLAx (principal + yield)
    /// This mimics Kamino's redeemReserveCollateral
    pub fn redeem_reserve_collateral(ctx: Context<RedeemReserveCollateral>, shares: u64) -> Result<()> {
        require!(shares > 0, MockLenderError::ZeroAmount);
        
        // Pool PDA signs for the vault transfer (it IS the pool authority).
        let pool_info = ctx.accounts.pool.to_account_info();
        let pool_bump = ctx.accounts.pool.bump;
        let tslax_key = ctx.accounts.tslax_mint.key();
        let pool = &mut ctx.accounts.pool;
        require!(pool.total_shares >= shares, MockLenderError::InsufficientShares);
        
        // Calculate liquidity amount (principal + yield share)
        // amount = shares * (total_deposits + yield_accrued) / total_shares
        let total_value = pool.total_deposits
            .checked_add(pool.yield_accrued)
            .ok_or(MockLenderError::MathError)?;
        
        let amount = (shares as u128)
            .checked_mul(total_value as u128)
            .ok_or(MockLenderError::MathError)?
            .checked_div(pool.total_shares as u128)
            .ok_or(MockLenderError::MathError)? as u64;
        
        require!(amount > 0, MockLenderError::ZeroAmount);
        require!(ctx.accounts.vault.amount >= amount, MockLenderError::InsufficientLiquidity);

        // Burn shares from user
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.shares_mint.to_account_info(),
                    from: ctx.accounts.user_source.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            shares,
        )?;

        // Transfer TSLAx from vault to user destination (pool PDA signs).
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_destination.to_account_info(),
                    authority: pool_info,
                },
                &[&[
                    b"pool",
                    tslax_key.as_ref(),
                    &[pool_bump],
                ]],
            ),
            amount,
        )?;

        // Calculate principal portion for bookkeeping
        let principal_portion = (shares as u128)
            .checked_mul(pool.total_deposits as u128)
            .ok_or(MockLenderError::MathError)?
            .checked_div(pool.total_shares.max(1) as u128)
            .ok_or(MockLenderError::MathError)? as u64;
        
        let yield_portion = amount.saturating_sub(principal_portion);
        
        pool.total_deposits = pool.total_deposits.saturating_sub(principal_portion);
        pool.total_shares = pool.total_shares.checked_sub(shares).ok_or(MockLenderError::MathError)?;
        pool.yield_accrued = pool.yield_accrued.saturating_sub(yield_portion);
        
        msg!("Redeem: shares={} amount={} principal={} yield={} total_deposits={} total_shares={} yield_accrued={}",
             shares, amount, principal_portion, yield_portion, pool.total_deposits, pool.total_shares, pool.yield_accrued);
        Ok(())
    }

    /// Debug probe: no accounts, just logs. Used to verify CPI reachability.
    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        msg!("pong");
        Ok(())
    }

    /// Admin instruction to drip yield into the pool (simulates borrow interest)
    /// Instantly increases the pool's yield_accrued and total value
    pub fn drip_yield(ctx: Context<DripYield>, yield_amount: u64) -> Result<()> {        require!(yield_amount > 0, MockLenderError::ZeroAmount);
        
        let pool = &mut ctx.accounts.pool;
        require_keys_eq!(ctx.accounts.authority.key(), pool.authority, MockLenderError::Unauthorized);
        
        // Transfer TSLAx from admin to pool vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.admin_source.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            yield_amount,
        )?;

        pool.yield_accrued = pool.yield_accrued.checked_add(yield_amount).ok_or(MockLenderError::MathError)?;
        
        msg!("Yield dripped: amount={} total_yield_accrued={}", yield_amount, pool.yield_accrued);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// The TSLAx mint
    pub tslax_mint: Box<Account<'info, Mint>>,
    
    /// Pool state PDA
    #[account(
        init,
        payer = authority,
        space = Pool::SPACE,
        seeds = [b"pool", tslax_mint.key().as_ref()],
        bump,
    )]
    pub pool: Box<Account<'info, Pool>>,
    
    /// Pool's TSLAx vault (ATA owned by pool PDA)
    #[account(
        init,
        payer = authority,
        associated_token::mint = tslax_mint,
        associated_token::authority = pool,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    
    /// Shares mint (cToken equivalent) - pool PDA is mint authority
    #[account(
        init,
        payer = authority,
        mint::decimals = 6,
        mint::authority = pool,
        mint::freeze_authority = pool,
        seeds = [b"shares", tslax_mint.key().as_ref()],
        bump,
    )]
    pub shares_mint: Box<Account<'info, Mint>>,
    
    /// Pool authority PDA (signs for vault and shares mint)
    /// CHECK: This is the pool PDA itself
    #[account(
        seeds = [b"pool", tslax_mint.key().as_ref()],
        bump,
    )]
    pub pool_authority: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct DepositReserveLiquidity<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// The TSLAx mint
    pub tslax_mint: Box<Account<'info, Mint>>,
    
    /// Pool state
    #[account(
        mut,
        seeds = [b"pool", tslax_mint.key().as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,
    
    /// User's TSLAx source account
    #[account(
        mut,
        constraint = user_source.mint == tslax_mint.key(),
        constraint = user_source.owner == user.key(),
    )]
    pub user_source: Box<Account<'info, TokenAccount>>,
    
    /// Pool vault (receives TSLAx)
    #[account(
        mut,
        constraint = vault.key() == pool.vault,
        constraint = vault.mint == tslax_mint.key(),
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    
    /// Shares mint
    #[account(
        mut,
        constraint = shares_mint.key() == pool.shares_mint,
    )]
    pub shares_mint: Box<Account<'info, Mint>>,
    
    /// User's shares destination (cToken equivalent).
    /// Vault-compatible: plain mut account (created off-chain), NOT init,
    /// so the vault's custody ATA can receive shares on every deposit.
    /// The pool PDA itself (passed as `pool`) signs the mint; no separate
    /// pool_authority account (it would alias `pool` and break CPI dedup).
    #[account(
        mut,
        constraint = user_destination.mint == pool.shares_mint,
    )]
    pub user_destination: Box<Account<'info, TokenAccount>>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RedeemReserveCollateral<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// The TSLAx mint
    pub tslax_mint: Box<Account<'info, Mint>>,
    
    /// Pool state
    #[account(
        mut,
        seeds = [b"pool", tslax_mint.key().as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,
    
    /// User's shares source (cToken equivalent)
    #[account(
        mut,
        constraint = user_source.mint == pool.shares_mint,
        constraint = user_source.owner == user.key(),
    )]
    pub user_source: Box<Account<'info, TokenAccount>>,
    
    /// Pool vault (sends TSLAx)
    #[account(
        mut,
        constraint = vault.key() == pool.vault,
        constraint = vault.mint == tslax_mint.key(),
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    
    /// Shares mint
    #[account(
        mut,
        constraint = shares_mint.key() == pool.shares_mint,
    )]
    pub shares_mint: Box<Account<'info, Mint>>,
    
    /// User's TSLAx destination
    #[account(
        mut,
        constraint = user_destination.mint == tslax_mint.key(),
        constraint = user_destination.owner == user.key(),
    )]
    pub user_destination: Box<Account<'info, TokenAccount>>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Ping {}

#[derive(Accounts)]
pub struct DripYield<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// The TSLAx mint
    pub tslax_mint: Box<Account<'info, Mint>>,
    
    /// Pool state
    #[account(
        mut,
        seeds = [b"pool", tslax_mint.key().as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,
    
    /// Admin's TSLAx source
    #[account(
        mut,
        constraint = admin_source.mint == tslax_mint.key(),
        constraint = admin_source.owner == authority.key(),
    )]
    pub admin_source: Box<Account<'info, TokenAccount>>,
    
    /// Pool vault (receives yield)
    #[account(
        mut,
        constraint = vault.key() == pool.vault,
        constraint = vault.mint == tslax_mint.key(),
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Pool {
    pub authority: Pubkey,
    pub tslax_mint: Pubkey,
    pub vault: Pubkey,
    pub shares_mint: Pubkey,
    pub total_deposits: u64,
    pub total_shares: u64,
    pub yield_accrued: u64,
    pub bump: u8,
}

impl Pool {
    pub const SPACE: usize = 8 + 32 * 4 + 8 * 3 + 1;
}

#[error_code]
pub enum MockLenderError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Math error")]
    MathError,
    #[msg("Insufficient shares")]
    InsufficientShares,
    #[msg("Insufficient liquidity in vault")]
    InsufficientLiquidity,
    #[msg("Unauthorized")]
    Unauthorized,
}