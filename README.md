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

## Auto-Renewal Modes

### Classic Mode (Prepaid)
The traditional approach where you fund the CRON contract for a specific number of years upfront.

**Pros:**
- Predictable costs
- No need to maintain wallet balance
- Works offline

**Cons:**
- Requires upfront funding
- Need to manually top up when funds run out

### Infinity Mode (Self-Funding) ♾️
A revolutionary approach that automatically funds the CRON contract from your wallet balance, eliminating the need for upfront funding.

**How Infinity Mode Works:**

1. **Initial Setup**: Deploy with minimal initial balance (just enough for one renewal cycle)
2. **Smart Funding**: Each renewal cycle automatically includes a self-funding mechanism
3. **Continuous Operation**: Contract runs indefinitely as long as your wallet has sufficient balance

**Technical Implementation:**
- Uses a special **TopUpper** contract to avoid changing the cron code
- TopUpper calculates the CRON contract address and forwards funds
- Self-funding message is added to the end of each renewal action list
- No manual intervention required

**Pros:**
- No upfront funding needed
- Automatic continuous operation
- Pay-as-you-go model
- Perfect for long-term domain management

**Cons:**
- Requires maintaining wallet balance
- Slightly higher per-cycle cost due to additional messages

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
   # 2. Choose mode:
   #    - Enter years (1, 2, 5, etc.) for Classic mode
   #    - Enter 0 for Infinity mode
   # 3. Confirm cost and deployment
   ```

3. **Manage Auto-Renewal**
   ```bash
   # Select option 4 in the main menu
   # Options:
   # - Change domain list
   # - Top up contract (Classic mode only)
   # - Delete contract
   ```

### Mode Selection Examples

#### Classic Mode
```bash
⏰ Enter number of years to fund (0 for Infinity mode): 3

✅ Mode: Classic mode - 3 year(s) prepaid
💰 Total cost: 0.093 TON for 3 year(s)
```

#### Infinity Mode
```bash
⏰ Enter number of years to fund (0 for Infinity mode): 0

♾️  Mode: Infinity mode - self-funding from wallet balance
💰 Initial cost: 0.031 TON
💡 This contract will renew domains as long as your wallet has balance
💡 Each renewal cycle will cost approximately:
   - 0.031 TON (contract fees)
   - 0.005 TON (domain renewal fees)
   - other fees
So in total: ~0.036 TON per year
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

#### Infinity Mode Implementation

**TopUpper Contract Integration:**
```typescript
// Create CalcAndTopup message for TopUpper
const calcAndTopupMessage = beginCell()
    .storeUint(0x56f6110e, 32) // CalcAndTopup opcode
    .storeUint(nextCallTime, 32) // firstCallTime
    .storeUint(period, 32) // repeatEvery  
    .storeUint(id, 32) // salt
    .storeCoins(reward) // reward
    .storeAddress(walletAddress) // ownerAddress
    .storeRef(renewalActionsCell) // renewalActionsCell
    .storeCoins(topupAmount) // topupAmount
    .storeCoins(cronW5CallMsgValue) // msgToWalletAmount
    .endCell();
```
**TopUpper Contract:** \
`0:678EBE29AF20F72B404ADBD8D87D12CB11F391DF8F488601ADE336B430F13960` - in both mainnet and testnet. Sources are verified.


**Self-Funding Flow:**
1. CRON contract sends renewal actions + TopUpper message
2. TopUpper calculates CRON address from message data
3. TopUpper forwards funds to CRON contract
4. CRON contract executes domain renewals
5. Process repeats automatically

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
       years,           // contract duration (0 for infinity)
       id,              // unique identifier
       nextCallTime,    // first execution time
       infinityMode     // true for infinity mode
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
       redeployAmount, // funds to transfer
       infinityMode    // preserve mode
   );
   ```

4. **Top Up Contract (Classic Mode Only)**
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

### Classic Mode
- **Contract Deployment**: 0.1 TON
- **CRON Reward**: 0.005 TON per renewal
- **Domain Renewal**: 0.005 TON per domain
- **Annual Costs**:
  - 1 domain: ~0.031 TON
  - 10 domains: ~0.11 TON
  - 250 domains: ~2.1 TON

### Infinity Mode
- **Initial Deployment**: 0.1 TON
- **Per-Cycle Costs**:
  - Contract fees: ~0.031 TON
  - Domain renewal: 0.005 TON per domain
  - TopUpper integration: ~0.005 TON
  - **Total per year**: ~0.036 TON for 1 domain
- **No upfront funding required**
- **Automatic continuous operation**

## Security

- All operations are performed through smart contracts
- Funds are stored in CRON contract (Classic) or wallet (Infinity)
- Access only through Wallet V5
- Automatic domain ownership verification
- CRON contract can only send renewal messages to specified domains
- TopUpper contract is audited and deployed on mainnet
- Self-funding mechanism is transparent and verifiable

## Troubleshooting

### Common Issues

1. **"Contract exhausted" in Infinity Mode**
   - Ensure your wallet has sufficient balance
   - Check that the contract is properly configured

2. **"Invalid number of years"**
   - Use positive integers for Classic mode
   - Use 0 for Infinity mode

3. **Top-up not working in Infinity Mode**
   - Infinity mode contracts don't support manual top-up
   - Simply add TON to your wallet - the contract will resume its work in the next cycle

### Best Practices

1. **For Classic Mode**: Fund for 2-3 years to minimize manual intervention
2. **For Infinity Mode**: ALWAYS keep required TON amount in your w5 wallet for continuous operation (`2.5 TON` max for 250 domains)
3. **Domain Selection**: Group domains with similar expiration dates for efficiency
4. **Network Selection**: Use testnet for testing, mainnet for production
