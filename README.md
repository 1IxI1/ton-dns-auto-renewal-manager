# TON DNS Auto-Renewal Manager

A tool for automatic TON DNS domain renewal using CRON contracts and Wallet V5 extensions.

## What is Auto-Renewal?

Auto-renewal is a smart contract system that automatically renews your TON DNS domains before they expire. It consists of two main components:

1. **CRON Contract**: A smart contract that stores funds and executes periodic renewal operations
2. **Wallet V5 Extension**: An integration mechanism that allows the CRON contract to send renewal messages on behalf of your wallet

### How it Works

1. You deploy a CRON contract with:
   - List of domains to renew
   - Renewal period (e.g., every 11 months)
   - Reward for CRON providers
   - Funds for multiple years of renewals

2. The CRON contract is added as an extension to your Wallet V5, which allows it to:
   - Send renewal messages to your domains
   - Use funds only for domain renewal (cannot withdraw or send elsewhere)

3. When it's time to renew:
   - CRON providers check the contract
   - If renewal time has come, they trigger the contract
   - Contract sends renewal messages to domains
   - Provider receives a small reward

## Installation

```bash
# Clone the repository
git clone https://github.com/1ixi1/ton-dns-auto-renewal-manager.git
cd ton-dns-auto-renewal-manager

# Install dependencies
yarn install

# Set up environment
export WALLET_MNEMONIC="your mnemonic phrase here"
export TONCENTER_API_KEY="your api key here" # optional
export NETWORK="testnet" # or "mainnet"
```

## Usage

### Starting the Manager

```bash
yarn start
```

### Basic Operations

1. **View Your Domains**
   ```bash
   # Select option 1 in the main menu
   # Shows:
   # - List of your domains
   # - Expiration dates
   # - Renewal status
   ```

2. **Create Auto-Renewal**
   ```bash
   # Select option 3 in the main menu
   # Steps:
   # 1. Select domains to renew
   # 2. Confirm cost
   # 3. Wait for contract deployment
   ```

3. **Manage Auto-Renewal**
   ```bash
   # Select option 4 in the main menu
   # Options:
   # - Change domain list
   # - Top up contract
   # - Delete contract
   ```

### Technical Details

#### Contract Actions

1. **Deploy Action**
   ```typescript
   // Creates deploy message with state init
   const deployAction = {
       type: 'sendMsg',
       mode: SendMode.PAY_GAS_SEPARATELY,
       outMsg: {
           info: { type: 'internal', ... },
           init: stateInit,
           body: deployBody
       }
   };
   ```

2. **Extension Actions**
   ```typescript
   // Add extension to wallet
   const addExtensionAction = {
       type: 'add_extension',
       address: cronAddress
   };

   // Remove extension from wallet
   const removeExtensionAction = {
       type: 'remove_extension',
       address: cronAddress
   };
   ```

3. **Destroy Action**
   ```typescript
   // Send destroy message to CRON
   const destroyAction = {
       type: 'sendMsg',
       mode: SendMode.PAY_GAS_SEPARATELY,
       outMsg: {
           info: { type: 'internal', ... },
           body: beginCell()
               .storeUint(0, 32)
               .storeStringTail("destroy")
               .endCell()
       }
   };
   ```

## Integration Guide

To integrate auto-renewal into your application:

1. **Initialize Contract**
   ```typescript
   import { createCronContract } from './manager';

   const cron = createCronContract(
       walletAddress,    // owner wallet
       domainAddresses, // domains to renew
       period,          // renewal period in seconds
       reward,          // reward for providers
       years           // contract duration
   );
   ```

2. **Deploy and Add Extension**
   ```typescript
   // Create actions
   const deployAction = createDeployAction(
       cron.address, 
       deployAmount,
       cron.stateInit, 
       cron.deployBody
   );
   const extensionAction = createAddExtensionAction(cron.address);

   // Send transaction
   const message = createRequestMessage(
       false,      // external message
       walletId,   // subwallet ID
       validUntil, // expiration
       seqno,      // wallet seqno
       { 
           wallet: [deployAction],
           extended: [extensionAction] 
       }
   );
   ```

3. **Update Domain List**
   ```typescript
   // Redeploy contract with new domains
   await redeployCronContract(
       oldAddress,     // current contract
       newDomains,     // new domain list
       salt,           // preserve salt
       nextCallTime,   // preserve timing
       period,         // renewal period
       redeployAmount  // funds to transfer
   );
   ```

4. **Top Up Contract**
   ```typescript
   // Send funds for additional years
   const topUpAction = {
       type: 'sendMsg',
       mode: SendMode.PAY_GAS_SEPARATELY,
       outMsg: {
           info: {
               type: 'internal',
               dest: cronAddress,
               value: { coins: topUpAmount }
           },
           body: emptyBody
       }
   };
   ```

## Operation Costs

All amounts in TON:

- **Contract Deployment**: 0.1 TON
- **CRON Reward**: 0.005 TON per renewal
- **Domain Renewal**: 0.005 TON per domain
- **Annual Costs**:
  - 1 domain: ~0.031 TON
  - 10 domains: ~0.11 TON
  - 250 domains: ~2.1 TON

## Security

- All operations are performed through smart contracts
- Funds are stored in CRON contract
- Access only through Wallet V5
- Automatic domain ownership verification
- CRON contract can only send renewal messages to specified domains
