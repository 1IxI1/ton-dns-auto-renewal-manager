import { WalletContractV5R1, external, beginCell, storeMessage } from '@ton/ton';
import { mnemonicToPrivateKey, sign } from '@ton/crypto';
import { Address, Cell, toNano, SendMode, OutAction, StateInit, storeStateInit, contractAddress, fromNano, Dictionary, loadMessage } from '@ton/core';
import * as readline from 'readline';
import { storeWalletActions, WalletActions, ExtensionAdd, ExtensionRemove } from './wallet-v5-test';
import { storeOutList } from '@ton/core';

// Auto-renewal configuration
const BACKUP_DAYS = 7; // fixed backup days
const CRON_REWARD_AMOUNT = toNano("0.005"); // TON reward for providers
const CRON_RENEW_AMOUNT = toNano("0.005"); // for msg to domain
const SECONDS_IN_YEAR = 365 * 24 * 60 * 60;
const SECONDS_IN_DAY = 24 * 60 * 60;
const CRON_INIT_FEE = toNano("0.1");

// Network configuration 
const NETWORK = process.env.NETWORK || "testnet"; // mainnet or testnet

// TonCenter configuration  
const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY || ""; // Optional
const TONCENTER_URL = `https://${NETWORK == 'testnet' ? 'testnet.' : ''}toncenter.com/api/v2`;
const TONCENTER_V3_URL = `https://${NETWORK == 'testnet' ? 'testnet.' : ''}toncenter.com/api/v3`;

const CRON_CODE_HEX = 'b5ee9c7241020a0100028d000114ff00f4a413f4bcf2c80b01020120020902014803080236d0f891f240d72c21720e9d64e302d72c2000000004e302840ff2f0040601fc30ed44d0d200d31fd31fd31ffa00fa40d4d3ffd70b0908f2d193f8276f10821005f5e100bef2e0c825c200f2e0caf89223c705f2e0cbc000f2e0cc06c000f2e0cd25d0d70b0520c01801c010b1f2e064ed4420d76501f90026c0009636f82325a006dec8cf8317cb1f15cb1f13cb1f01fa02ce13cc21cf0bff22cf0b09c9050088ed5482080f42408d0860000000000000000000000000000000000000000000000000000000000383123f24c8cf8508ce01fa028210d027efe5cf0b8acbffcb09c971fb0001f28b764657374726f798c7058e6af897820afaf080be8e5fed44d0d20031d31f31d31f31d31f31fa0031fa4031d431d3ffd70b0982080f42408d0860000000000000000000000000000000000000000000000000000000000383123f24c8cf8508ce01fa028210d027efe5cf0b8a12cbffcb09c971fb00dee30d0700f4ed44d0d20031d31f31d31f31d31f31fa0031fa40d431d3ffd70b09f89223c705f2e19182080f42408d0860000000000000000000000000000000000000000000000000000000000383123f24c8cf8508ce01fa028210d027efe5cf0b8a12cbffcb09c971fb00c8cf8508ce8210bbe27821cf0b8ec98100a0fb00004ba060b7da89a1a60063a63fa63fa63e63f401ae99a1020223ae43f40061f04ede20a2254142b100dcf2840fed44d0d600d31f20d31fd31f31fa00d74cf8235005bef2e19206d72c2108a3816c16f2f404fa403020d72c053121fa4430c000b0f2e190f800f8235005a003c8ce13cb1f12cec9ed5422c2008e16c8cf850812ce58fa0282102e04891acf0b8ac973fb00926c21e273fb0057a59bfe';
const CRON_CODE = Cell.fromBoc(Buffer.from(CRON_CODE_HEX, 'hex'))[0];
const CRON_CODE_HASH = CRON_CODE.hash().toString('base64');

const DNS_ITEM_CODE_HASH = NETWORK == 'testnet' ? "Pwq5JTFwyGqu6/6rst4LwtNbTIVKmOo33Czf/ej06BE=" : "i1/8nr/TkGTY1fVuRlnIJrt1k5I/XKSHKL5NYK9vUfk=";
const DNS_COLLECTION_ADDRESS = NETWORK == 'testnet' ? "kQDjPtM6QusgMgWfl9kMcG-EALslbTITnKcH8VZK1pnH3f3K" : "EQC3dNlesgVD8YbAazcauIrXBPfiVhMMr5YYk2in0Mtsz0Bz";

const TOPUPPER_ADDRESS = Address.parse('0:678EBE29AF20F72B404ADBD8D87D12CB11F391DF8F488601ADE336B430F13960');

// all of that is upper estimate
function calcCronStorageFee(n: number): bigint {
    return toNano(0.005) + toNano(0.0005) * BigInt(n);
}
// don't take gas price from config, since we topup in advance
function calcCronComputeFee(n: number): bigint {
    return toNano(0.005) + toNano(0.0003) * BigInt(n);
}
function calcW5ComputeFee(n: number): bigint {
    return toNano(0.005) + toNano(0.0003) * BigInt(n);
}
function calcCronFwdFee(n: number): bigint {
    return toNano(0.002) + toNano(0.0004) * BigInt(n);
}
function calcW5FwdFee(n: number): bigint {
    return toNano(0.002) + toNano(0.0005) * BigInt(n);
}
function calcFwdFees(n: number): bigint {
    return calcCronFwdFee(n) + calcW5FwdFee(n);
}
function calcRenewMsgsAmount(n: number): bigint {
    return (toNano(0.001) + CRON_RENEW_AMOUNT) * BigInt(n);
}
function calcCronCostPerYEAR(n: number): bigint {
    return calcCronStorageFee(n) + calcCronComputeFee(n) + calcW5ComputeFee(n) + calcFwdFees(n) + calcRenewMsgsAmount(n) + CRON_REWARD_AMOUNT;
}
function calcCronInfinityModeBalance(n: number): bigint {
    // cost for one execution cycle in infinity mode - only what's needed on cron side
    // 2 of fwd fee and storage fee because of TopUpper call
    const walletCallAmount = calcW5ComputeFee(n);
    return ((calcCronStorageFee(n) + calcCronFwdFee(n)) * 2n) + calcCronComputeFee(n) + CRON_REWARD_AMOUNT + walletCallAmount;
}
function calcCronW5CallMsgValue(n: number): bigint {
    // msg value for `cron -> w5` calls
    // on cron, already spent calcCronStorageFee(n) + calcCronComputeFee(n) + calcCronFwdFee(n) + CRON_REWARD_AMOUNT
    return calcW5ComputeFee(n) + calcW5FwdFee(n) + calcRenewMsgsAmount(n); 
}

interface Domain {
    address: Address;
    name: string;
    expirationDate: Date;
}

interface CronContract {
    address: Address;
    nextCallTime: number;
    reward: bigint;
    ownerAddress: Address;
    domainsCount: number;
    initialized: boolean;
    balance: bigint;
    createdAt: number; // salt is timestamp
    repeatEvery: number;
    infinityMode: boolean; // true if self-funding mode
}

// Sleep function for rate limiting
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Console input helper
function question(query: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise(resolve => {
        rl.question(query, answer => {
            rl.close();
            resolve(answer);
        });
    });
}

// Retry function for API calls
async function withRetry<T>(
    operation: () => Promise<T>, 
    maxRetries: number = 3, 
    delay: number = 2000
): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 1) {
                console.log(`   🔄 Retry attempt ${attempt}/${maxRetries}`);
                await sleep(delay * attempt); // Exponential backoff
            } else {
                await sleep(delay); // Initial delay
            }
            return await operation();
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }
            if (error instanceof Error && error.message.includes('429')) {
                console.log(`   ⚠️  Rate limited, waiting ${delay * attempt}ms before retry...`);
            } else {
                console.log(`   ⚠️  Request failed, retrying in ${delay * attempt}ms...`);
            }
        }
    }
    throw new Error('All retry attempts failed');
}

// Get API headers with optional API key
function getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json'
    };
    if (TONCENTER_API_KEY) {
        headers['X-API-Key'] = TONCENTER_API_KEY;
    }
    return headers;
}

// TonCenter API helpers
async function sendBocToNetwork(bocBase64: string): Promise<any> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json"
    };
    
    if (TONCENTER_API_KEY) {
        headers["X-API-Key"] = TONCENTER_API_KEY;
    }
    
    const url = NETWORK === "testnet" 
        ? "https://testnet.toncenter.com/api/v2/sendBoc"
        : "https://toncenter.com/api/v2/sendBoc";
    
    return await withRetry(async () => {
        console.log('   ⏳ Waiting 2s for rate limiting...');
        const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({ boc: bocBase64 })
        });
        
        const result = await response.json();
        return { response, result };
    }, 3, 2000);
}

// Get domains owned by wallet
async function getDomainsByOwner(ownerAddress: Address): Promise<Domain[]> {
    const headers: Record<string, string> = {};
    if (TONCENTER_API_KEY) {
        headers["X-API-Key"] = TONCENTER_API_KEY;
    }

    return await withRetry(async () => {
        // first get list of domains
        const url = `${TONCENTER_V3_URL}/nft/items?collection_address=${DNS_COLLECTION_ADDRESS}&owner_address=${ownerAddress.toString()}&limit=1000`;
        
        const response = await fetch(url, { headers });
        const result = await response.json();
        if (!result.nft_items) {
            return [];
        }

        // collect domain addresses for batch processing
        const domainItems: { address: Address; name: string }[] = [];
        for (const item of result.nft_items) {
            try {
                if (item.content?.domain) {
                    domainItems.push({
                        address: Address.parse(item.address),
                        name: item.content.domain
                    });
                }
            } catch (error) {
                console.warn(`Failed to parse domain ${item.address}:`, error);
            }
        }

        if (domainItems.length === 0) {
            return [];
        }

        // get account states for all domains in batch
        const addresses = domainItems.map(d => d.address.toString());
        const accountStates = await getDomainAccountStates(addresses);
        
        // parse expiration dates from data_boc
        const domains: Domain[] = [];
        for (const item of domainItems) {
            try {
                const account = accountStates.get(item.address.toRawString().toUpperCase());
                if (account && account.data_boc) {
                    const expiration = parseDomainExpiration(account.data_boc);
                    if (expiration) {
                        domains.push({
                            address: item.address,
                            name: item.name,
                            expirationDate: expiration
                        });
                    }
                }
            } catch (error) {
                console.warn(`Failed to process domain ${item.address.toString()}:`, error);
            }
        }
        
        return domains;
    }, 3, 1000);
}

// Get account states for domain contracts
async function getDomainAccountStates(addresses: string[]): Promise<Map<string, any>> {
    return await withRetry(async () => {
        const results = new Map<string, any>();
        
        const params = new URLSearchParams({
            'address': addresses.join(','),
            'include_boc': 'true',
            'limit': '1000'
        });
        
        const url = `${TONCENTER_V3_URL}/accountStates?${params}`;
        // console.log(url)
        
        const response = await fetch(url, {
            headers: getHeaders()
        });
        
        const result = await response.json();
        
        if (result.accounts) {
            for (const account of result.accounts) {
                if (account.status === 'active' && account.data_boc && account.code_hash == DNS_ITEM_CODE_HASH) {
                    results.set(account.address, account);
                }
            }
        }
        return results;
    }, 3, 1000);
}

// Parse all domain data from data_boc according to dns-item.fc schema
function parseDomainData(dataBoc: string): {
    index: bigint;
    collectionAddress: Address;
    ownerAddress: Address;
    content: Cell;
    domain: string;
    auction: Cell | null;
    lastFillUpTime: number;
} | null {
    try {
        // dns-item.fc store_data schema:
        // .store_uint(index, 256)
        // .store_slice(collection_address)  
        // .store_slice(owner_address)
        // .store_ref(content)
        // .store_ref(domain)
        // .store_dict(auction)
        // .store_uint(last_fill_up_time, 64)
        const dataCell = Cell.fromBase64(dataBoc);
        const slice = dataCell.beginParse();
        
        const index = slice.loadUintBig(256);
        const collectionAddress = slice.loadAddress();
        const ownerAddress = slice.loadAddress();
        const content = slice.loadRef();
        const domain = slice.loadRef().beginParse().loadStringTail();
        const auction = slice.loadMaybeRef(); // auction is stored as maybe ref
        const lastFillUpTime = slice.loadUint(64);
        return {
            index,
            collectionAddress,
            ownerAddress,
            content,
            domain,
            auction,
            lastFillUpTime
        };
    } catch (error) {
        console.warn('Failed to parse domain data:', error);
        return null;
    }
}

// Parse domain expiration from data_boc using common parser
function parseDomainExpiration(dataBoc: string): Date | null {
    const domainData = parseDomainData(dataBoc);
    if (!domainData) return null;
    
    // expiration = last_fill_up_time + 1 year
    return new Date((domainData.lastFillUpTime + SECONDS_IN_YEAR) * 1000);
}

// Get contract balance
async function getContractBalance(address: Address): Promise<bigint> {
    return await withRetry(async () => {
        const params = new URLSearchParams({
            'address': address.toString(),
            'include_boc': 'false'
        });
        
        const url = `${TONCENTER_V3_URL}/accountStates?${params}`;
        
        const response = await fetch(url, {
            headers: getHeaders()
        });
        
        const result = await response.json();
        
        if (result.accounts && result.accounts.length > 0) {
            return BigInt(result.accounts[0].balance || 0);
        }
        return BigInt(0);
    }, 3, 1000);
}

async function getWalletState(address: Address): Promise<{
    seqno: number;
    balance: bigint;
    extensions: Cell | null;
}> {
    const params = new URLSearchParams({
        'address': address.toString(),
        'include_boc': 'true'
    });
    
    const url = `${TONCENTER_V3_URL}/accountStates?${params}`;
    // console.log(url)
    const response = await fetch(url, {
        headers: getHeaders()
    });
    const result = await response.json();
    if (!result.accounts) {
        throw new Error('Wallet state is not found');
    }
    const account = result.accounts[0];

    if (account.status !== 'active' || !account.data_boc) {
        throw new Error('Wallet state is not active or data_boc is not found');
    }
    
    const data = Cell.fromBase64(account.data_boc).beginParse();
    const isSignatureAllowed = data.loadBoolean();
    const seqno = data.loadUint(32);
    const subwalletId = data.loadUint(32);
    const publicKey = data.loadUintBig(256);
    const extensions = data.loadMaybeRef();
    return {
        seqno,
        balance: account.balance,
        extensions
    };
}

// Create CRON contract 
function createCronContract(
    walletAddress: Address,
    domainAddresses: Address[],
    period: number,
    reward: bigint,
    years: number,
    id: number = 777,
    nextCallTime: number = 0,
    infinityMode: boolean = false
): { address: Address; stateInit: StateInit; deployBody: Cell, deployMsgAmount: bigint } {
    // create domain renewal actions
    const renewalMessages: OutAction[] = domainAddresses.map(domainAddr => 
    {
        return {
            type: 'sendMsg',
            mode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
            outMsg: {
                info: {
                type: 'internal',
                dest: domainAddr,
                value: { coins: CRON_RENEW_AMOUNT },
                bounce: true,
                ihrDisabled: true,
                bounced: false,
                ihrFee: BigInt(0),
                forwardFee: BigInt(0),
                createdLt: BigInt(0),
                createdAt: 0
            },
                body: beginCell().storeUint(0, 32).endCell()
            }
        };
    });

    const cronCost = infinityMode ? calcCronInfinityModeBalance(domainAddresses.length) : calcCronCostPerYEAR(domainAddresses.length) * BigInt(years);
    const cronW5CallMsgValue = infinityMode ? calcW5ComputeFee(domainAddresses.length) : calcCronW5CallMsgValue(domainAddresses.length);
    const deployMsgAmount = cronCost + CRON_INIT_FEE; // no bad of additional 0.1 TON in infinity mode

    let walletMessages = renewalMessages;
    let finalRequestMessageBody: Cell;
    let finalMsgToWallet: Cell;
    let address: Address;
    let stateInit: StateInit;

    if (infinityMode) {
        // For infinity mode, use TopUpper to resolve chicken-and-egg problem

        // Create renewal actions cell (just domain renewals)
        const renewalActionsCell = beginCell()
            .store(storeOutList(renewalMessages))
            .endCell();

        // Create CalcAndTopup message for TopUpper
        const topupAmount = calcCronInfinityModeBalance(domainAddresses.length);
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

        // Create message to TopUpper
        const topUpperMessage: OutAction = {
            type: 'sendMsg',
            mode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
            outMsg: {
                info: {
                    type: 'internal',
                    dest: TOPUPPER_ADDRESS,
                    value: { coins: topupAmount },
                    bounce: true,
                    ihrDisabled: true,
                    bounced: false,
                    ihrFee: BigInt(0),
                    forwardFee: BigInt(0),
                    createdLt: BigInt(0),
                    createdAt: 0
                },
                body: calcAndTopupMessage
            }
        };

        // Add TopUpper message STRICTLY AT THE END (will be in first ref)
        walletMessages = [...renewalMessages, topUpperMessage];

        // Create final request message
        finalRequestMessageBody = beginCell()
            .storeUint(0x6578746E, 32) // extension_action_request op
            .storeUint(0, 64) // query_id
            .store(storeWalletActions({ // out actions + extended actions
                wallet: walletMessages,
                extended: []
            }))
            .endCell();

        // Make it a full msg
        finalMsgToWallet = beginCell()
            .storeUint(0x10, 6) // non bouncable
            .storeAddress(walletAddress)
            .storeCoins(cronW5CallMsgValue)
            .storeUint(1, 1 + 4 + 4 + 64 + 32 + 1 + 1)
            .storeRef(finalRequestMessageBody)
            .endCell();
        
        // Create cron contract data and calculate address
        let data = beginCell()
            .storeUint(0, 1) // not initialized
            .storeUint(nextCallTime, 32) // next execution
            .storeUint(period, 32) // repeat every
            .storeUint(id, 32) // salt (creation timestamp)
            .storeCoins(reward)
            .storeAddress(walletAddress)
            .storeRef(finalMsgToWallet)
            .storeUint(0, 256) // init state hash
            .storeUint(0, 10) // init state depth
            .endCell();

        stateInit = {
            code: CRON_CODE,
            data: data
        };
        address = contractAddress(0, stateInit);

    } else {
        // Classic mode - original logic
        finalRequestMessageBody = beginCell()
            .storeUint(0x6578746E, 32) // extension_action_request op
            .storeUint(0, 64) // query_id
            .store(storeWalletActions({ // out actions + extended actions
                wallet: walletMessages,
                extended: []
            }))
            .endCell();

        finalMsgToWallet = beginCell()
            .storeUint(0x10, 6) // non bouncable
            .storeAddress(walletAddress)
            .storeCoins(cronW5CallMsgValue)
            .storeUint(1, 1 + 4 + 4 + 64 + 32 + 1 + 1)
            .storeRef(finalRequestMessageBody)
            .endCell();

        let data = beginCell()
            .storeUint(0, 1) // not initialized
            .storeUint(nextCallTime, 32) // next execution
            .storeUint(period, 32) // repeat every
            .storeUint(id, 32) // salt (creation timestamp)
            .storeCoins(reward)
            .storeAddress(walletAddress)
            .storeRef(finalMsgToWallet)
            .storeUint(0, 256) // init state hash
            .storeUint(0, 10) // init state depth
            .endCell();

        stateInit = {
            code: CRON_CODE,
            data: data
        };
        address = contractAddress(0, stateInit);
    }

    // deploy body with opcode from cron-ui
    const deployBody = beginCell()
        .storeUint(0x2e41d3ac, 32) // deploy opcode
        .endCell();

    return { address, stateInit, deployBody, deployMsgAmount };
}

// Helper functions for creating wallet actions
function createDeployAction(cronAddress: Address, deployAmount: bigint, stateInit: StateInit, deployBody: Cell): OutAction {
    return {
        type: 'sendMsg',
        mode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
        outMsg: {
            info: {
                type: 'internal',
                dest: cronAddress,
                value: { coins: deployAmount },
                bounce: true,
                ihrDisabled: true,
                bounced: false,
                ihrFee: BigInt(0),
                forwardFee: BigInt(0),
                createdLt: BigInt(0),
                createdAt: 0
            },
            init: stateInit,
            body: deployBody
        }
    };
}

function createDestroyAction(cronAddress: Address): OutAction {
    const destroyMessage = beginCell()
        .storeUint(0, 32)
        .storeStringTail("destroy")
        .endCell();
    
    return {
        type: 'sendMsg',
        mode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
        outMsg: {
            info: {
                type: 'internal',
                dest: cronAddress,
                value: { coins: toNano("0.1") },
                bounce: false,
                ihrDisabled: true,
                bounced: false,
                ihrFee: BigInt(0),
                forwardFee: BigInt(0),
                createdLt: BigInt(0),
                createdAt: 0
            },
            body: destroyMessage
        }
    };
}

function createAddExtensionAction(extensionAddress: Address): ExtensionAdd {
    return {
        type: 'add_extension',
        address: extensionAddress
    };
}

function createRemoveExtensionAction(extensionAddress: Address): ExtensionRemove {
    return {
        type: 'remove_extension',
        address: extensionAddress
    };
}

// Create request message like WalletV5Test.requestMessage
function createRequestMessage(
    isInternal: boolean,
    walletId: bigint, 
    validUntil: number,
    seqno: number,
    actions: WalletActions
): Cell {
    const op = isInternal ? 0x73696e74 : 0x7369676e; // internal_signed or external_signed
    
    return beginCell()
        .storeUint(op, 32)
        .storeUint(walletId, 32)
        .storeUint(validUntil, 32)  
        .storeUint(seqno, 32)
        .store(storeWalletActions(actions))
        .endCell();
}

// Global state
interface AppState {
    wallet: any;
    keyPair: any;
    walletId: bigint;
    domains: Domain[];
    cronContracts: CronContract[];
}

let appState: AppState | null = null;

async function initializeApp(): Promise<AppState> {
    console.log('🚀 Auto-Renewal Manager for W5 Wallet');
    console.log('=====================================');
    
    // Check environment
    const mnemonic = process.env.WALLET_MNEMONIC;
    if (!mnemonic) {
        console.error('❌ Error: WALLET_MNEMONIC environment variable is required');
        console.log('   Set it like: export WALLET_MNEMONIC="word1 word2 ... word24"');
        process.exit(1);
    }
    
    console.log(`🌐 Network: ${NETWORK}`);
    console.log(`📅 Backup days: ${BACKUP_DAYS}`);
    console.log(`💰 CRON reward: ${fromNano(CRON_REWARD_AMOUNT)} TON`);
    
    // Initialize TON client
    const endpoint = NETWORK === "testnet" 
        ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
        : 'https://toncenter.com/api/v2/jsonRPC';
    
    console.log('🔗 Initializing TON client...');
    await sleep(1000);
        
    // Get wallet from mnemonic
    const keyPair = await mnemonicToPrivateKey(mnemonic.split(' '));
    
    const wallet = WalletContractV5R1.create({
        publicKey: keyPair.publicKey,
        workchain: 0
    });
    
    const walletId = BigInt(0x7fffff11); // default W5R1 subwallet
    
    console.log(`💼 Wallet address: ${wallet.address.toString()}`);
    
    // Get wallet state
    console.log('📊 Getting wallet state...');
    const {seqno, balance} = await getWalletState(wallet.address);
    
    console.log(`   Seqno: ${seqno}`);
    console.log(`   Balance: ${fromNano(balance)} TON`);
    
    if (balance < toNano("1")) {
        console.warn('⚠️  Warning: Low balance, transaction might fail');
    }
    
    // Get domains owned by wallet
    console.log('🔍 Getting domains owned by wallet...');
    const domains = await getDomainsByOwner(wallet.address);
    
    console.log(`   Found ${domains.length} domains`);
    
    return {
        wallet,
        keyPair,
        walletId,
        domains,
        cronContracts: []
    };
}

async function getCronContracts(walletAddress: Address): Promise<CronContract[]> {
    console.log('🔍 Getting CRON contracts from wallet extensions...');
    
    const {extensions} = await getWalletState(walletAddress);
    
    if (!extensions) {
        console.log('   No extensions found');
        return [];
    }
    
    // Parse extensions dict using DApp logic
    const extensionAddresses: Address[] = [];
    try {
        const extensionsDict = extensions.beginParse().loadDictDirect(
            Dictionary.Keys.BigUint(256),
            Dictionary.Values.BigInt(1)
        );
        
        if (extensionsDict) {
            const keys = extensionsDict.keys();
            for (const key of keys) {
                try {
                    // key is bigint, convert to hex string with proper padding
                    const keyHex = key.toString(16).padStart(64, '0');
                    const extensionAddress = Address.parseRaw(`0:${keyHex}`);
                    extensionAddresses.push(extensionAddress);
                } catch (error) {
                    console.warn('Failed to parse extension address:', error);
                }
            }
        }
        
        console.log(`   Found ${extensionAddresses.length} extensions`);
    } catch (error) {
        console.warn('Failed to parse extensions dict:', error);
        return [];
    }
    
    if (extensionAddresses.length === 0) {
        console.log('   No extensions found');
        return [];
    }
    
    // Filter extensions to find CRON contracts
    const cronContracts: CronContract[] = [];
    
    // Get account states for all extensions
    const accountStates = await getCronAccountStates(extensionAddresses.map(a => a.toString()));
    
    accountStates.forEach((account, addressStr) => {
        try {
            if (account.code_hash === CRON_CODE_HASH) {
                const address = Address.parse(addressStr);
                const cronData = parseCronData(account.data_boc);
                
                if (cronData && cronData.initialized) {
                    // Parse the message to count domains
                    const domains = parseDomainsFromCronMessage(cronData.message);
                    // Check if it's infinity mode by looking for self-funding message
                    const infinityMode = checkInfinityModeFromCronMessage(cronData.message);
                    
                    cronContracts.push({
                        address,
                        nextCallTime: cronData.nextCallTime,
                        reward: cronData.reward,
                        ownerAddress: cronData.ownerAddress,
                        domainsCount: domains.length,
                        initialized: cronData.initialized,
                        balance: BigInt(account.balance || 0),
                        createdAt: cronData.salt,
                        repeatEvery: cronData.repeatEvery,
                        infinityMode
                    });
                }
            }
        } catch (error) {
            console.warn(`Failed to process extension ${addressStr}:`, error);
        }
    });
    
    console.log(`   Found ${cronContracts.length} CRON contracts`);
    return cronContracts;
}

async function getCronAccountStates(addresses: string[]): Promise<Map<string, any>> {
    if (addresses.length === 0) return new Map();
    
    return await withRetry(async () => {
        const results = new Map<string, any>();
        
        const params = new URLSearchParams({
            'address': addresses.join(','),
            'include_boc': 'true',
            'limit': '1000'
        });
        
        const url = `${TONCENTER_V3_URL}/accountStates?${params}`;
        
        const response = await fetch(url, {
            headers: getHeaders()
        });
        
        const result = await response.json();
        
        if (result.accounts) {
            for (const account of result.accounts) {
                if (account.status === 'active' && account.data_boc && account.code_hash === CRON_CODE_HASH) {
                    results.set(account.address, account);
                }
            }
        }
        return results;
    }, 3, 1000);
}

function parseDomainsFromCronMessage(message: Cell): Address[] {
    try {
        let domains: Address[] = []
        let domainsSet = new Set<string>()
        let i = 0
        const parseRefs = (message: Cell) => { 
            message.refs.forEach(ref => {
                // console.log("Processing ref #" + i)
                i++
                const s = ref.beginParse()
                try {
                    // const m = loadMessage(s)
                    if (s.loadUint(6) == 0x18) {
                        const destAddress = s.loadAddress();
                        // Skip TopUpper address - it's not a domain
                        if (!destAddress.equals(TOPUPPER_ADDRESS)) {
                            if (!domainsSet.has(destAddress.toString())) {
                                domains.push(destAddress);
                                domainsSet.add(destAddress.toString());
                            }
                        }
                    }
                } catch {}

                parseRefs(ref)
            })
        }
        parseRefs(message)
        return domains
    } catch (error) {
        console.warn('Failed to parse domains from CRON message:', error);
        return [];
    }
}

function checkInfinityModeFromCronMessage(message: Cell): boolean {
    try {
        let foundTopUpperMessage = false;
        let i = 0;
        const parseRefs = (message: Cell) => { 
            message.refs.forEach(ref => {
                // console.log("Processing ref #" + i)
                i++
                const s = ref.beginParse()
                try {
                    // check if this is a message to TopUpper address
                    if (s.loadUint(6) == 0x18) {
                        const destAddress = s.loadAddress();
                        if (destAddress.equals(TOPUPPER_ADDRESS)) {
                            foundTopUpperMessage = true;
                        }
                    }
                } catch {}

                parseRefs(ref)
            })
        }
        parseRefs(message)
        return foundTopUpperMessage;
    } catch (error) {
        console.warn('Failed to check infinity mode from CRON message:', error);
        return false;
    }
}

function parseCronData(dataBoc: string): { 
    nextCallTime: number; 
    reward: bigint; 
    ownerAddress: Address; 
    initialized: boolean;
    message: Cell;
    salt: number;
    repeatEvery: number;
} | null {
    try {
        const dataCell = Cell.fromBase64(dataBoc);
        const slice = dataCell.beginParse();
        
        const initialized = slice.loadUint(1);
        const nextCallTime = slice.loadUint(32);
        const repeatEvery = slice.loadUint(32);
        const salt = slice.loadUint(32);
        const reward = slice.loadCoins();
        const ownerAddress = slice.loadAddress();
        const message = slice.loadRef();
        
        return {
            nextCallTime,
            reward,
            ownerAddress,
            initialized: initialized === 1,
            message,
            salt,
            repeatEvery
        };
    } catch (error) {
        return null;
    }
}

// Send destroy message to CRON contract
async function destroyCronContract(cronAddress: Address): Promise<void> {
    if (!appState) throw new Error('App not initialized');
    
    console.log(`🗑️ Destroying CRON contract ${cronAddress.toString()}...`);
    
    const {seqno} = await getWalletState(appState.wallet.address);
    
    const destroyAction = createDestroyAction(cronAddress);
    const removeAction = createRemoveExtensionAction(cronAddress);
    
    const validUntil = Math.floor(Date.now() / 1000) + 3600;
    
    const unsignedMessage = createRequestMessage(
        false,
        appState.walletId,
        validUntil,
        seqno,
        { 
            wallet: [destroyAction],
            extended: [removeAction] 
        }
    );
    
    const signature = sign(unsignedMessage.hash(), appState.keyPair.secretKey);
    
    const signedMessage = beginCell()
        .storeSlice(unsignedMessage.asSlice())
        .storeBuffer(signature)
        .endCell();
    
    const externalMessage = external({
        to: appState.wallet.address,
        body: signedMessage
    });
    
    const externalMessageCell = beginCell()
        .store(storeMessage(externalMessage))
        .endCell();
    
    const finalBocBase64 = externalMessageCell.toBoc().toString('base64');
    
    console.log('🚀 Sending destroy message...');
    const { response, result } = await sendBocToNetwork(finalBocBase64);
    
    if (result.ok) {
        console.log('✅ Destroy message sent successfully!');
        if (result.result?.hash) {
            console.log(`   Transaction hash: ${result.result.hash}`);
        }
    } else {
        console.log('❌ Destroy failed!');
        console.log(`   Error: ${result.error || 'Unknown error'}`);
        throw new Error(`Destroy failed: ${result.error}`);
    }
}

// Redeploy CRON contract in a single transaction
async function redeployCronContract(
    oldCronAddress: Address,
    selectedDomains: Domain[],
    salt: number,
    nextCallTime: number,
    period: number,
    redeployAmount: bigint,
    infinityMode: boolean = false
): Promise<void> {
    if (!appState) throw new Error('App not initialized');
    
    // Create new CRON contract with same parameters
    const domainAddresses = selectedDomains.map(d => d.address);
    const years = infinityMode ? 0 : 1; // for infinity mode, use 0, otherwise 1 for compat
    const newCron = createCronContract(appState.wallet.address, domainAddresses, period, CRON_REWARD_AMOUNT, years, salt, nextCallTime, infinityMode);
    
    console.log(`📍 New CRON address: ${newCron.address.toString()}`);
    
    const {seqno} = await getWalletState(appState.wallet.address);
    
    // Create all actions for single transaction
    const destroyAction = createDestroyAction(oldCronAddress);
    const deployAction = createDeployAction(newCron.address, redeployAmount, newCron.stateInit, newCron.deployBody);
    const removeExtensionAction = createRemoveExtensionAction(oldCronAddress);
    const addExtensionAction = createAddExtensionAction(newCron.address);
    
    const validUntil = Math.floor(Date.now() / 1000) + 3600;
    
    console.log('\n📝 Creating redeploy transaction...');
    console.log(`   Valid until: ${validUntil} (${new Date(validUntil * 1000).toISOString()})`);
    console.log(`   Total cost: ${fromNano(redeployAmount)} TON`);
    
    // Create unsigned message with all actions
    const unsignedMessage = createRequestMessage(
        false,
        appState.walletId,
        validUntil,
        seqno,
        { 
            wallet: [destroyAction, deployAction],
            extended: [removeExtensionAction, addExtensionAction] 
        }
    );
    
    console.log(`🔐 Message hash: ${unsignedMessage.hash().toString('hex')}`);
    
    // Sign message
    console.log('✍️  Signing message...');
    const signature = sign(unsignedMessage.hash(), appState.keyPair.secretKey);
    
    // Create signed message
    const signedMessage = beginCell()
        .storeSlice(unsignedMessage.asSlice())
        .storeBuffer(signature)
        .endCell();
    
    // Create external message
    const externalMessage = external({
        to: appState.wallet.address,
        body: signedMessage
    });
    
    const externalMessageCell = beginCell()
        .store(storeMessage(externalMessage))
        .endCell();
    
    const finalBocBase64 = externalMessageCell.toBoc().toString('base64');
    
    console.log(`📦 Final BOC size: ${externalMessageCell.toBoc().length} bytes`);
    
    // Send to network
    console.log('\n🚀 Redeploying CRON contract...');
    const { response, result } = await sendBocToNetwork(finalBocBase64);
    
    console.log(`📡 Response: ${response.status} ${response.statusText}`);
    
    if (result.ok) {
        console.log('✅ CRON contract redeployed successfully!');
        
        if (result.result?.hash) {
            console.log(`   Transaction hash: ${result.result.hash}`);
        }
        
        console.log('');
        console.log('📊 Summary:');
        console.log(`   Old CRON address: ${oldCronAddress.toString()}`);
        console.log(`   New CRON address: ${newCron.address.toString()}`);
        console.log(`   Domains: ${selectedDomains.length}`);
        console.log('');
        console.log('⏳ Please wait 10-20 seconds for transaction confirmation');
        console.log(`🔍 Check status: https://testnet.tonscan.org/address/${appState.wallet.address.toString()}`);
    } else {
        console.log('❌ Redeploy failed!');
        console.log(`   Error: ${result.error || 'Unknown error'}`);
        console.log(`   Code: ${result.code || 'N/A'}`);
        
        throw new Error(`Redeploy failed: ${result.error}`);
    }
}

// Top up CRON contract with funds for additional years
async function topUpCronContract(cronAddress: Address, years: number, domainsCount: number): Promise<void> {
    if (!appState) throw new Error('App not initialized');
    
    const topUpAmount = calcCronCostPerYEAR(domainsCount) * BigInt(years);
    
    console.log(`💰 Topping up CRON contract for ${years} year(s)...`);
    console.log(`   Amount: ${fromNano(topUpAmount)} TON`);
    
    const {seqno} = await getWalletState(appState.wallet.address);
    
    const topUpAction: OutAction = {
        type: 'sendMsg',
        mode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
        outMsg: {
            info: {
                type: 'internal',
                dest: cronAddress,
                value: { coins: topUpAmount },
                bounce: true,
                ihrDisabled: true,
                bounced: false,
                ihrFee: BigInt(0),
                forwardFee: BigInt(0),
                createdLt: BigInt(0),
                createdAt: 0
            },
            body: beginCell().storeUint(0, 32).endCell() // empty message body
        }
    };
    
    const validUntil = Math.floor(Date.now() / 1000) + 3600;
    
    const unsignedMessage = createRequestMessage(
        false,
        appState.walletId,
        validUntil,
        seqno,
        { 
            wallet: [topUpAction],
            extended: [] 
        }
    );
    
    const signature = sign(unsignedMessage.hash(), appState.keyPair.secretKey);
    
    const signedMessage = beginCell()
        .storeSlice(unsignedMessage.asSlice())
        .storeBuffer(signature)
        .endCell();
    
    const externalMessage = external({
        to: appState.wallet.address,
        body: signedMessage
    });
    
    const externalMessageCell = beginCell()
        .store(storeMessage(externalMessage))
        .endCell();
    
    const finalBocBase64 = externalMessageCell.toBoc().toString('base64');
    
    console.log('🚀 Sending top-up...');
    const { response, result } = await sendBocToNetwork(finalBocBase64);
    
    if (result.ok) {
        console.log('✅ Top-up sent successfully!');
        if (result.result?.hash) {
            console.log(`   Transaction hash: ${result.result.hash}`);
        }
    } else {
        console.log('❌ Top-up failed!');
        console.log(`   Error: ${result.error || 'Unknown error'}`);
        throw new Error(`Top-up failed: ${result.error}`);
    }
}

async function deployAutoRenewalWithParams(
    selectedDomains: Domain[], 
    deployAmount?: bigint,
    customSalt?: number,
    customNextCallTime?: number,
    customPeriod?: number,
    years: number = 1,
    infinityMode: boolean = false
): Promise<void> {
    if (!appState) throw new Error('App not initialized');
        
        // Calculate period and first renewal date
        customPeriod = 100; // DEBUG
        customNextCallTime = 0; // DEBUG
        const period = customPeriod ?? (SECONDS_IN_YEAR - BACKUP_DAYS * SECONDS_IN_DAY);
        const earliestExpiration = selectedDomains.reduce((earliest, domain) => {
            return domain.expirationDate < earliest ? domain.expirationDate : earliest;
        }, selectedDomains[0].expirationDate);
        
        // Use custom salt or current timestamp
        const salt = customSalt ?? Math.floor(Date.now() / 1000);
        
        // Calculate nextCallTime - use custom or calculate from earliest expiration
        const nextCallTime = customNextCallTime ?? (Math.floor(earliestExpiration.getTime() / 1000) - BACKUP_DAYS * SECONDS_IN_DAY);
        
        const firstRenewalDate = new Date(nextCallTime * 1000);
        
        // Calculate exact period in months and days
        const periodDays = period / SECONDS_IN_DAY;
        const months = Math.floor(periodDays / 30.44); // average days per month
        const days = Math.round(periodDays % 30.44);
        
        console.log(`\n⏰ First renewal scheduled for: ${firstRenewalDate.toLocaleDateString()}`);
        console.log(`🔄 Renewal period: ${periodDays} days (${months} months ${days} days)`);
        
        // Create CRON contract
        const domainAddresses = selectedDomains.map(d => d.address);
        
        console.log('\n🏗️  Creating CRON contract...');
        const cron = createCronContract(appState.wallet.address, domainAddresses, period, CRON_REWARD_AMOUNT, years, salt, nextCallTime, infinityMode);
        
        console.log(`📍 CRON address: ${cron.address.toString()}`);
    
    // Get current wallet state
    const {seqno} = await getWalletState(appState.wallet.address);
        
        // Determine deploy amount - use custom amount if provided, otherwise calculate
        const actualDeployAmount = deployAmount ?? cron.deployMsgAmount;
        
        // Create deploy and add_extension actions
        const deployAction = createDeployAction(cron.address, actualDeployAmount, cron.stateInit, cron.deployBody);
        const extensionAction = createAddExtensionAction(cron.address);
        
        const validUntil = Math.floor(Date.now() / 1000) + 3600; // 1 hour
        
        console.log('\n📝 Creating deployment transaction...');
        console.log(`   Valid until: ${validUntil} (${new Date(validUntil * 1000).toISOString()})`);
    console.log(`   Total cost: ${fromNano(actualDeployAmount)} TON`);
        
        // Create unsigned message with both deploy and add_extension
        const unsignedMessage = createRequestMessage(
            false, // external message
        appState.walletId,
            validUntil,
            seqno,
            { 
                wallet: [deployAction],
                extended: [extensionAction] 
            }
        );
        
        console.log(`🔐 Message hash: ${unsignedMessage.hash().toString('hex')}`);
        
        // Sign message 
        console.log('✍️  Signing message...');
    const signature = sign(unsignedMessage.hash(), appState.keyPair.secretKey);
        
        // Create signed message
        const signedMessage = beginCell()
            .storeSlice(unsignedMessage.asSlice())
            .storeBuffer(signature)
            .endCell();
        
        // Create external message
        const externalMessage = external({
        to: appState.wallet.address,
            body: signedMessage
        });
        
        const externalMessageCell = beginCell()
            .store(storeMessage(externalMessage))
            .endCell();
        
        const finalBocBase64 = externalMessageCell.toBoc().toString('base64');
        
        console.log(`📦 Final BOC size: ${externalMessageCell.toBoc().length} bytes`);
        
        // Send to network
        console.log('\n🚀 Deploying auto-renewal to TON network...');
        const { response, result } = await sendBocToNetwork(finalBocBase64);
        
        console.log(`📡 Response: ${response.status} ${response.statusText}`);
        
        if (result.ok) {
            // console.log('✅ Auto-renewal deployed successfully!');
            console.log('🎉 CRON contract deployed and added as extension');
            
            if (result.result?.hash) {
                console.log(`   Transaction hash: ${result.result.hash}`);
            }
            
            console.log('');
            console.log('📊 Summary:');
            console.log(`   CRON address: ${cron.address.toString()}`);
            console.log(`   Mode: ${infinityMode ? 'Infinity' : 'Classic'}`);
            console.log(`   Domains: ${selectedDomains.length}`);
            console.log(`   First renewal: ${firstRenewalDate.toLocaleDateString()}`);
            console.log(`   Period: ${months} months ${days} days`);
            if (!infinityMode) {
                console.log(`   Years funded: ${years}`);
            }
            console.log('');
            console.log('⏳ Please wait 10-20 seconds for transaction confirmation');
        console.log(`🔍 Check status: https://testnet.tonscan.org/address/${appState.wallet.address.toString()}`);
            
        } else {
            console.log('❌ Transaction failed!');
            console.log(`   Error: ${result.error || 'Unknown error'}`);
            console.log(`   Code: ${result.code || 'N/A'}`);
            
        throw new Error(`Transaction failed: ${result.error}`);
    }
}

async function showMainMenu(): Promise<void> {
    console.log('\n' + '='.repeat(50));
    console.log('🎛️  Auto-Renewal Manager Menu');
    console.log('='.repeat(50));
    console.log('1. 📋 View domains');
    console.log('2. 🤖 View auto-renewal contracts');
    console.log('3. ➕ Create new auto-renewal');
    console.log('4. ✏️  Edit auto-renewal');
    console.log('5. 🗑️  Delete auto-renewal (batch)');
    console.log('6. 🔄 Refresh data');
    console.log('7. 🚪 Exit');
    console.log('='.repeat(50));
    
    const choice = await question('Select option (1-7): ');
    
    switch (choice.trim()) {
        case '1':
            await showDomains();
            break;
        case '2':
            await showCronContracts();
            break;
        case '3':
            await createAutoRenewal();
            break;
        case '4':
            await editAutoRenewal();
            break;
        case '5':
            await deleteAutoRenewal();
            break;
        case '6':
            await refreshData();
            break;
        case '7':
            console.log('👋 Goodbye!');
            process.exit(0);
            break;
        default:
            console.log('❌ Invalid option. Please try again.');
            break;
    }
    
    await showMainMenu();
}

async function showDomains(): Promise<void> {
    if (!appState) return;
    
    console.log('\n📋 Your TON Domains');
    console.log('='.repeat(50));
    
    if (appState.domains.length === 0) {
        console.log('❌ No domains found for this wallet');
        return;
    }
    
    appState.domains.sort((a, b) => a.name.localeCompare(b.name));
    appState.domains.forEach((domain, index) => {
        const expiration = domain.expirationDate.toLocaleDateString();
        const daysUntilExpiry = Math.ceil((domain.expirationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        
        let status = '✅';
        if (daysUntilExpiry < 30) status = '⚠️';
        if (daysUntilExpiry < 7) status = '🚨';
        
        console.log(`${status} ${index + 1}. ${domain.name}`);
        console.log(`   Expires: ${expiration} (${daysUntilExpiry} days)`);
        console.log(`   Address: ${domain.address.toString()}`);
        console.log('');
    });
}

async function showCronContracts(): Promise<void> {
    if (!appState) return;
    
    console.log('\n🤖 Auto-Renewal Contracts');
    console.log('='.repeat(50));
    
    // Refresh CRON contracts
    appState.cronContracts = await getCronContracts(appState.wallet.address);
    
    if (appState.cronContracts.length === 0) {
        console.log('❌ No auto-renewal contracts found');
        console.log('💡 Use option 3 to create a new auto-renewal contract');
        return;
    }
    
    // Sort by creation time (newest first)
    appState.cronContracts.sort((a, b) => b.createdAt - a.createdAt);
    
    appState.cronContracts.forEach((cron, index) => {
        const nextCall = new Date(cron.nextCallTime * 1000);
        const createdAt = new Date(cron.createdAt * 1000);
        
        // Calculate remaining years based on mode
        let remainingYears = 0;
        let isActive = false;
        let status = '';
        
        if (cron.infinityMode) {
            // For infinity mode, check if there's enough balance for at least one cycle
            const oneCycleCost = calcCronInfinityModeBalance(cron.domainsCount);
            isActive = cron.balance >= oneCycleCost;
            status = isActive ? '♾️  Active (Infinity)' : '❌ Broken (Infinity)';
        } else {
            // For classic mode, calculate remaining years
            const yearCost = calcCronCostPerYEAR(cron.domainsCount);
            remainingYears = yearCost > 0 ? Math.floor(Number(cron.balance) / Number(yearCost)) : 0;
            isActive = remainingYears > 0;
            status = isActive ? '✅ Active (Classic)' : '❌ Exhausted';
        }

        const mode = cron.infinityMode ? 'Infinity' : 'Classic';
        const balanceDisplay = cron.infinityMode 
            ? `${fromNano(cron.balance)} TON` 
            : `${fromNano(cron.balance)} TON (~${remainingYears} years remaining)`;

        console.log(`${index + 1}. CRON Contract ${status}`);
        console.log(`   Address: ${cron.address.toString()}`);
        console.log(`   Created: ${createdAt.toLocaleString()}`);
        console.log(`   Mode: ${mode}`);
        console.log(`   Balance: ${balanceDisplay}`);
        console.log(`   Reward: ${fromNano(cron.reward)} TON`);
        console.log(`   Domains: ~${cron.domainsCount} domains`);
        console.log(`   Next execution: ${nextCall.toLocaleString()}`);
        console.log(`   Owner: ${cron.ownerAddress.toString()}`);
        console.log('');
    });
}

async function createAutoRenewal(): Promise<void> {
    if (!appState) return;
    
    console.log('\n➕ Create New Auto-Renewal');
    console.log('='.repeat(50));
    
    if (appState.domains.length === 0) {
        console.log('❌ No domains found. Cannot create auto-renewal.');
        return;
    }
    
    // Show domains and let user select
    console.log('📋 Available domains:');
    appState.domains.sort((a, b) => a.name.localeCompare(b.name));
    appState.domains.forEach((domain, index) => {
            const expiration = domain.expirationDate.toLocaleDateString();
            console.log(`   ${index + 1}. ${domain.name} (expires: ${expiration})`);
        });
        
    const input = await question('\n🎯 Enter domain numbers (e.g., 1,3,5 or 1-5,7,10): ');
        
    const selectedIndices = parseIndexRanges(input, appState.domains.length);
        
        if (selectedIndices.length === 0) {
        console.log('❌ No valid domains selected');
        return;
        }
        
    const selectedDomains = selectedIndices.map(i => appState!.domains[i]);
        console.log(`\n✅ Selected ${selectedDomains.length} domains:`);
        selectedDomains.forEach(domain => {
            console.log(`   - ${domain.name}`);
        });
    
    // Ask for number of years
    const yearsInput = await question('\n⏰ Enter number of years to fund (0 for Infinity mode): ');
    const years = parseInt(yearsInput.trim());
    
    if (isNaN(years) || years < 0) {
        console.log('❌ Invalid number of years');
        return;
    }
    
    const infinityMode = years === 0;
    
    // Calculate costs based on mode
    let totalCost: bigint;
    let modeDescription: string;
    
    const n = selectedDomains.length;
    if (infinityMode) {
        totalCost = calcCronInfinityModeBalance(n) + CRON_INIT_FEE;
        modeDescription = "Infinity mode - self-funding from wallet balance";
        console.log(`\n♾️  Mode: ${modeDescription}`);
        console.log(`💰 Initial cost: ${fromNano(totalCost)} TON`);
        console.log('💡 This contract will renew domains as long as your wallet has balance');
        console.log('💡 Each renewal cycle will cost approximately:');
        console.log(`   - ${fromNano(calcCronInfinityModeBalance(n))} TON (contract fees)`);
        console.log(`   - ${fromNano(calcRenewMsgsAmount(n))} TON (domain renewal fees)`);
        console.log(`   - other fees`);
        console.log(`So in total: ~${fromNano(calcCronInfinityModeBalance(n) + calcRenewMsgsAmount(n) + calcW5ComputeFee(n) + calcFwdFees(n))} TON per year`);
    } else {
        totalCost = calcCronCostPerYEAR(n) * BigInt(years) + CRON_INIT_FEE;
        modeDescription = `Classic mode - ${years} year(s) prepaid`;
        console.log(`\n✅ Mode: ${modeDescription}`);
        console.log(`💰 Total cost: ${fromNano(totalCost)} TON for ${years} year(s)`);
    }
    
    const confirm = await question('\n❓ Proceed with deployment? (y/N): ');
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
        console.log('❌ Deployment cancelled');
        return;
    }
    
    try {
        await deployAutoRenewalWithParams(selectedDomains, undefined, undefined, undefined, undefined, years, infinityMode);
        console.log('✅ Auto-renewal deployed successfully!');
        
        // Refresh data
        await refreshData();
    } catch (error) {
        console.error('❌ Failed to deploy auto-renewal:', error);
    }
}

async function editAutoRenewal(): Promise<void> {
    if (!appState) return;
    
    console.log('\n✏️  Edit Auto-Renewal');
    console.log('='.repeat(50));
    
    // Refresh CRON contracts
    appState.cronContracts = await getCronContracts(appState.wallet.address);
    
    if (appState.cronContracts.length === 0) {
        console.log('❌ No auto-renewal contracts found');
        return;
    }
    
    // Sort by creation time (newest first)
    appState.cronContracts.sort((a, b) => b.createdAt - a.createdAt);
    
    // Show available contracts
    console.log('📋 Available auto-renewal contracts:');
    appState.cronContracts.forEach((cron, index) => {
        const nextCall = new Date(cron.nextCallTime * 1000);
        const isActive = cron.nextCallTime > Math.floor(Date.now() / 1000);
        const status = isActive ? '✅ Active' : '⏸️  Inactive';
        
        // Calculate remaining years
        const yearCost = calcCronCostPerYEAR(cron.domainsCount);
        const remainingYears = yearCost > 0 ? Math.floor(Number(cron.balance) / Number(yearCost)) : 0;
        
        console.log(`   ${index + 1}. ${status} - ${cron.domainsCount} domains - ${fromNano(cron.balance)} TON (~${remainingYears} years)`);
        console.log(`      Address: ${cron.address.toString()}`);
        console.log(`      Next execution: ${nextCall.toLocaleString()}`);
        console.log('');
    });
    
    const contractChoice = await question('🎯 Select contract number: ');
    const contractIndex = parseInt(contractChoice.trim()) - 1;
    
    if (contractIndex < 0 || contractIndex >= appState.cronContracts.length) {
        console.log('❌ Invalid contract number');
        return;
    }
    
    const selectedContract = appState.cronContracts[contractIndex];
    
    // Get and display domains from this contract
    console.log(`\n📋 Domains in contract ${selectedContract.address.toString()}:`);
    console.log('='.repeat(50));
    
    // Get CRON contract data and parse domains
    const accountStates = await getCronAccountStates([selectedContract.address.toString()]);
    const account = accountStates.get(selectedContract.address.toRawString().toUpperCase());
    
    if (!account || !account.data_boc) {
        console.log(`❌ No contract data found: ${account}`);
        return;
    }
    
    const cronData = parseCronData(account.data_boc);
    if (!cronData) {
        console.log('❌ Failed to parse contract data');
        return;
    }
    
    // Parse domain addresses from the message
    const domainAddresses = parseDomainsFromCronMessage(cronData.message);
    console.log(`   Found ${domainAddresses.length} domains in contract`);
    
    if (domainAddresses.length === 0) {
        console.log('❌ No domains found in this contract');
        return;
    }
    
    // Get domain data using existing function
    const domainAccountStates = await getDomainAccountStates(domainAddresses.map(a => a.toString()));
    
    domainAddresses.forEach((domainAddr, index) => {
        try {
            const account = domainAccountStates.get(domainAddr.toRawString().toUpperCase());
            if (account && account.data_boc) {
                const domainData = parseDomainData(account.data_boc);
                if (domainData) {
                    const isOwned = domainData.ownerAddress.equals(appState!.wallet.address);
                    const expirationDate = new Date((domainData.lastFillUpTime + SECONDS_IN_YEAR) * 1000);
                    const expiration = expirationDate.toLocaleDateString();
                    const daysUntilExpiry = Math.ceil((expirationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                    const ownershipStatus = isOwned ? '' : ' (missing)';
                    
                    let status = '✅';
                    if (daysUntilExpiry < 30) status = '⚠️';
                    if (daysUntilExpiry < 7) status = '🚨';
                    
                    console.log(`${status} ${index + 1}. ${domainData.domain}${ownershipStatus}`);
                    console.log(`   Expires: ${expiration} (${daysUntilExpiry} days)`);
                    console.log(`   Address: ${domainAddr.toString()}`);
                    if (!isOwned) {
                        console.log(`   ⚠️  This domain is no longer owned by your wallet`);
                    }
                    console.log('');
                    return;
                }
            }
            
            // Fallback for unknown domains
            console.log(`❓ ${index + 1}. Unknown domain (missing)`);
            console.log(`   Address: ${domainAddr.toString()}`);
            console.log(`   ⚠️  Could not parse domain data`);
            console.log('');
        } catch (error) {
            console.log(`❌ ${index + 1}. Error parsing domain (missing)`);
            console.log(`   Address: ${domainAddr.toString()}`);
            console.log('');
        }
    });
    
    // Show options
    console.log('\n🛠️  Edit Options:');
    console.log('='.repeat(30));
    console.log('1. 📝 Change domain list');
    console.log('2. 💰 Top up contract');
    console.log('3. 🗑️  Delete contract');
    console.log('4. 🔙 Back to main menu');
    
    const choice = await question('\nSelect option (1-4): ');
    
    switch (choice.trim()) {
        case '1':
            await changeDomainList(selectedContract);
            break;
        case '2':
            await topUpContract(selectedContract);
            break;
        case '3':
            await deleteContract(selectedContract);
            break;
        case '4':
            return;
        default:
            console.log('❌ Invalid option');
            break;
    }
}

// Change domain list in contract (destroy old + deploy new with same id)
async function changeDomainList(selectedContract: CronContract): Promise<void> {
    if (!appState) return;
    
    console.log('\n📝 Change Domain List');
    console.log('='.repeat(30));
    
    // Show owned domains that can be added
    console.log('📋 Your available domains:');
    appState.domains.sort((a, b) => a.name.localeCompare(b.name));
    appState.domains.forEach((domain, index) => {
        const expiration = domain.expirationDate.toLocaleDateString();
        console.log(`   ${index + 1}. ${domain.name} (expires: ${expiration})`);
    });
    
    const input = await question('\n🎯 Enter new domain numbers (e.g., 1,3,5 or 1-5,7,10): ');
    
    const selectedIndices = parseIndexRanges(input, appState.domains.length);
    
    if (selectedIndices.length === 0) {
        console.log('❌ No valid domains selected');
        return;
    }
    
    const selectedDomains = selectedIndices.map(i => appState!.domains[i]);
    console.log(`\n✅ Selected ${selectedDomains.length} domains:`);
    selectedDomains.forEach(domain => {
        console.log(`   - ${domain.name}`);
    });
    
    try {
        // Get old contract balance before destroying
        console.log('\n💰 Getting old contract balance...');
        const oldBalance = await getContractBalance(selectedContract.address);
        console.log(`   Old contract balance: ${fromNano(oldBalance)} TON`);

        // Calculate costs for new contract
        const newContractCost = oldBalance + toNano("0.1");
        
        console.log(`\n💰 Cost breakdown:`);
        console.log(`   Old contract balance: ${fromNano(oldBalance)} TON`);
        console.log(`   Update fees: 0.1 TON`);
        console.log(`   Minimum wallet balance for update: ${fromNano(newContractCost)} TON`);
        console.log(`   To be deducted after all: ~ 0.11 TON`);
        
        const confirm = await question('\n❓ Proceed with redeployment? (y/N): ');
        if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
            console.log('❌ Redeployment cancelled');
            return;
        }
        
        // Parse current contract to get salt and nextCallTime
        const accountStates = await getCronAccountStates([selectedContract.address.toString()]);
        const account = accountStates.get(selectedContract.address.toRawString().toUpperCase());
        let salt = Math.floor(Date.now() / 1000); // default to current time
        let nextCallTime = 0; // default
        
        if (account && account.data_boc) {
            const cronData = parseCronData(account.data_boc);
            if (cronData) {
                // preserve salt and nextCallTime from old contract
                salt = cronData.salt;
                nextCallTime = cronData.nextCallTime;
            }
        }
        if (nextCallTime == 0) {
            console.log('❌ Next call time is 0, failed to parse old contract');
        }
        
        // Redeploy contract in single transaction
        console.log('\n🔄 Redeploying contract with new domain list...');
        await redeployCronContract(
            selectedContract.address,
            selectedDomains,
            salt,
            nextCallTime,
            selectedContract.repeatEvery,
            newContractCost,
            selectedContract.infinityMode
        );
        
        console.log('✅ Contract updated successfully!');
        
        // Refresh data
        await refreshData();
    } catch (error) {
        console.error('❌ Failed to update contract:', error);
    }
}

// Top up selected contract
async function topUpContract(selectedContract: CronContract): Promise<void> {
    console.log('\n💰 Top Up Contract');
    console.log('='.repeat(20));
    
    if (selectedContract.infinityMode) {
        console.log('♾️  This is an Infinity mode contract');
        console.log('💡 Infinity mode contracts are funded from your wallet balance automatically');
        console.log('💡 No manual top-up is needed - just keep TON in your wallet');
        console.log('');
        console.log('📊 Current status:');
        const oneCycleCost = calcCronInfinityModeBalance(selectedContract.domainsCount);
        const canRunCycles = selectedContract.balance >= oneCycleCost ? Math.floor(Number(selectedContract.balance) / Number(oneCycleCost)) : 0;
        console.log(`   Contract balance: ${fromNano(selectedContract.balance)} TON`);
        console.log(`   One cycle cost: ${fromNano(oneCycleCost)} TON`);
        console.log(`   Can run: ${canRunCycles} cycles with current balance`);
        return;
    }
    
    const yearsInput = await question('📅 Enter number of years to add: ');
    const years = parseInt(yearsInput.trim());
    
    if (isNaN(years) || years <= 0) {
        console.log('❌ Invalid number of years');
        return;
    }
    
    const totalCost = calcCronCostPerYEAR(selectedContract.domainsCount) * BigInt(years);
    console.log(`💰 Cost: ${fromNano(totalCost)} TON for ${years} year(s)`);
    
    const confirm = await question('\n❓ Proceed with top-up? (y/N): ');
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
        console.log('❌ Top-up cancelled');
        return;
    }
    
    try {
        await topUpCronContract(selectedContract.address, years, selectedContract.domainsCount);
        console.log('✅ Contract topped up successfully!');
    } catch (error) {
        console.error('❌ Failed to top up contract:', error);
    }
}

// Delete selected contract
async function deleteContract(selectedContract: CronContract): Promise<void> {
    console.log('\n🗑️  Delete Contract');
    console.log('='.repeat(18));
    console.log(`Contract: ${selectedContract.address.toString()}`);
    console.log(`Domains: ${selectedContract.domainsCount}`);
    console.log(`Reward: ${fromNano(selectedContract.reward)} TON`);
    
    console.log('\n⚠️  WARNING: This will permanently delete the auto-renewal contract!');
    console.log('⚠️  Any remaining funds will be returned to your wallet.');
    
    const confirm = await question('\n❓ Are you sure you want to delete this contract? (y/N): ');
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
        console.log('❌ Deletion cancelled');
        return;
    }
    
    try {
        await destroyCronContract(selectedContract.address);
        console.log('✅ Contract deleted successfully!');
        
        // Refresh data
        console.log('🔄 Refreshing data...');
        await refreshData();
    } catch (error) {
        console.error('❌ Failed to delete contract:', error);
    }
}

// Helper function to parse index ranges
function parseIndexRanges(input: string, maxLength: number): number[] {
    const selectedIndices: number[] = [];
    
    for (const part of input.split(',')) {
        const trimmed = part.trim();
        
        if (trimmed.includes('-')) {
            const [start, end] = trimmed.split('-').map(s => parseInt(s.trim()));
            if (!isNaN(start) && !isNaN(end) && start <= end) {
                for (let i = start; i <= end; i++) {
                    const index = i - 1;
                    if (index >= 0 && index < maxLength && !selectedIndices.includes(index)) {
                        selectedIndices.push(index);
                    }
                }
            }
        } else {
            const num = parseInt(trimmed);
            if (!isNaN(num)) {
                const index = num - 1;
                if (index >= 0 && index < maxLength && !selectedIndices.includes(index)) {
                    selectedIndices.push(index);
                }
            }
        }
    }
    
    return selectedIndices;
}

// Batch destroy multiple CRON contracts
async function batchDestroyCronContracts(cronContracts: CronContract[]): Promise<void> {
    if (!appState) throw new Error('App not initialized');
    if (cronContracts.length === 0) return;
    
    console.log(`\n🗑️  Destroying ${cronContracts.length} CRON contracts...`);
    
    const {seqno} = await getWalletState(appState.wallet.address);
    
    // create actions for each contract
    const walletActions: OutAction[] = [];
    const extendedActions: (ExtensionAdd | ExtensionRemove)[] = [];
    
    for (const cron of cronContracts) {
        console.log(`   📍 ${cron.address.toString()} (${cron.domainsCount} domains)`);
        walletActions.push(createDestroyAction(cron.address));
        extendedActions.push(createRemoveExtensionAction(cron.address));
    }
    
    const validUntil = Math.floor(Date.now() / 1000) + 3600;
    
    const unsignedMessage = createRequestMessage(
        false,
        appState.walletId,
        validUntil,
        seqno,
        { 
            wallet: walletActions,
            extended: extendedActions
        }
    );
    
    const signature = sign(unsignedMessage.hash(), appState.keyPair.secretKey);
    
    const signedMessage = beginCell()
        .storeSlice(unsignedMessage.asSlice())
        .storeBuffer(signature)
        .endCell();
    
    const externalMessage = external({
        to: appState.wallet.address,
        body: signedMessage
    });
    
    const externalMessageCell = beginCell()
        .store(storeMessage(externalMessage))
        .endCell();
    
    const finalBocBase64 = externalMessageCell.toBoc().toString('base64');
    
    console.log('🚀 Sending batch destroy message...');
    const { response, result } = await sendBocToNetwork(finalBocBase64);
    
    if (result.ok) {
        console.log('✅ Batch destroy message sent successfully!');
        if (result.result?.hash) {
            console.log(`   Transaction hash: ${result.result.hash}`);
        }
        console.log(`   Destroyed ${cronContracts.length} contracts`);
    } else {
        console.log('❌ Batch destroy failed!');
        console.log(`   Error: ${result.error || 'Unknown error'}`);
        throw new Error(`Batch destroy failed: ${result.error}`);
    }
}

async function deleteAutoRenewal(): Promise<void> {
    if (!appState) return;
    
    console.log('\n🗑️  Delete Auto-Renewal Contracts');
    console.log('='.repeat(50));
    
    // Refresh CRON contracts
    appState.cronContracts = await getCronContracts(appState.wallet.address);
    
    if (appState.cronContracts.length === 0) {
        console.log('❌ No auto-renewal contracts found');
        return;
    }
    
    // Sort by creation time (newest first) to match display order
    appState.cronContracts.sort((a, b) => b.createdAt - a.createdAt);
    
    // Show available contracts
    console.log('📋 Available auto-renewal contracts:');
    appState.cronContracts.forEach((cron, index) => {
        const nextCall = new Date(cron.nextCallTime * 1000);
        const createdAt = new Date(cron.createdAt * 1000);
        
        // Calculate status based on mode
        let status = '';
        if (cron.infinityMode) {
            const oneCycleCost = calcCronInfinityModeBalance(cron.domainsCount);
            const isActive = cron.balance >= oneCycleCost;
            status = isActive ? '♾️  Active (Infinity)' : '❌ Broken (Infinity)';
        } else {
            const yearCost = calcCronCostPerYEAR(cron.domainsCount);
            const remainingYears = yearCost > 0 ? Math.floor(Number(cron.balance) / Number(yearCost)) : 0;
            const isActive = remainingYears > 0;
            status = isActive ? '✅ Active (Classic)' : '❌ Exhausted';
        }
        
        const mode = cron.infinityMode ? 'Infinity' : 'Classic';
        
        console.log(`   ${index + 1}. ${status}`);
        console.log(`      Address: ${cron.address.toString()}`);
        console.log(`      Created: ${createdAt.toLocaleString()}`);
        console.log(`      Mode: ${mode}`);
        console.log(`      Balance: ${fromNano(cron.balance)} TON`);
        console.log(`      Domains: ~${cron.domainsCount} domains`);
        console.log(`      Next execution: ${nextCall.toLocaleString()}`);
        console.log('');
    });
    
    const input = await question('\n🎯 Enter contract numbers to delete (e.g., 1,3,5 or 2-4,6): ');
    
    const selectedIndices = parseIndexRanges(input, appState.cronContracts.length);
    
    if (selectedIndices.length === 0) {
        console.log('❌ No valid contracts selected');
        return;
    }
    
    const selectedContracts = selectedIndices.map(i => appState!.cronContracts[i]);
    
    console.log(`\n📋 Selected ${selectedContracts.length} contracts to delete:`);
    selectedContracts.forEach((cron, index) => {
        const mode = cron.infinityMode ? 'Infinity' : 'Classic';
        console.log(`   ${index + 1}. ${cron.address.toString()} (${mode}, ${cron.domainsCount} domains)`);
    });
    
    // Calculate total balance to be returned
    const totalBalance = selectedContracts.reduce((sum, cron) => sum + cron.balance, BigInt(0));
    console.log(`\n💰 Total balance to be returned: ${fromNano(totalBalance)} TON`);
    
    console.log('\n⚠️  WARNING: This will permanently delete the selected auto-renewal contracts!');
    console.log('⚠️  All remaining funds will be returned to your wallet.');
    
    const confirm = await question('\n❓ Are you sure you want to delete these contracts? (y/N): ');
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
        console.log('❌ Deletion cancelled');
        return;
    }
    
    try {
        await batchDestroyCronContracts(selectedContracts);
        console.log('✅ Contracts deleted successfully!');
        
        // Refresh data
        console.log('🔄 Refreshing data...');
        await refreshData();
    } catch (error) {
        console.error('❌ Failed to delete contracts:', error);
    }
}

async function deployAutoRenewal(selectedDomains: Domain[], deployAmount?: bigint): Promise<void> {
    return deployAutoRenewalWithParams(selectedDomains, deployAmount);
}

async function refreshData(): Promise<void> {
    if (!appState) return;
    
    console.log('\n🔄 Refreshing data...');
    
    try {
        // Refresh domains
        console.log('   📋 Updating domains...');
        appState.domains = await getDomainsByOwner(appState.wallet.address);
        
        // Refresh CRON contracts
        console.log('   🤖 Updating auto-renewal contracts...');
        appState.cronContracts = await getCronContracts(appState.wallet.address);
        
        console.log('✅ Data refreshed successfully!');
    } catch (error) {
        console.error('❌ Failed to refresh data:', error);
    }
}

async function main() {
    try {
        // Initialize app
        appState = await initializeApp();
        
        // Load initial data
        await refreshData();
        
        // Show main menu
        await showMainMenu();
        
    } catch (error) {
        console.error('❌ Fatal error:', error);
        if (error instanceof Error) {
            console.error('   Details:', error.message);
        }
        
        // Handle rate limiting errors specifically
        if (error instanceof Error && (error.message.includes('429') || error.message.includes('Request failed with status code 429'))) {
            console.log('');
            console.log('🚫 Rate limit exceeded! Try these solutions:');
            console.log('   - Wait a few minutes and try again');
            console.log('   - Get a TonCenter API key: https://t.me/tonapibot');
            console.log('   - Set TONCENTER_API_KEY environment variable');
        }
        
        if (error instanceof TypeError && error.message.includes('fetch')) {
            console.log('');
            console.log('🌐 Network error - check your internet connection');
        }
        
        process.exit(1);
    }
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('\n👋 Process interrupted by user');
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Run the script
if (require.main === module) {
    main().catch(console.error);
} 