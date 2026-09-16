/// Admin-only instruction to close the old vault state PDA.
    /// Called when program is upgraded and VaultState struct changes.
    /// Returns rent to admin; next initialize_state will recreate with new layout.
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

        msg!("vault state PDA closed; re-run initialize_state with pyth_price_feed to recreate with new layout");
        Ok(())
    }