/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL SIGNAL v9000 (ULTRA SHOTGUN EDITION)
 * ===============================================================================
 * ARCH: Multi-Chain (SOL | BASE | BSC | ETH | ARB)
 * RPC CLUSTER: QuickNode (Primary) + Public Fallbacks (Parallel Broadcast)
 * ENGINE: Jupiter ULTRA API (Unified Gateway)
 * AUTH: Mandatory x-api-key headers (Resolves 401 Unauthorized)
 * ===============================================================================
 */

require('dotenv').config();
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const { ethers, JsonRpcProvider, Contract, HDNodeWallet } = require('ethers');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- CONFIGURATION ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const JUP_API_KEY = "f440d4df-b5c4-4020-a960-ac182d3752ab"; 
const ULTRA_ENDPOINT = "https://api.jup.ag/ultra/v1"; 

// ⚡ RPC CLUSTER DEFINITION
// Your QuickNode Mansion URL from the curl test
const QN_MANSION = process.env.SOLANA_RPC || 'https://autumn-aged-mansion.solana-mainnet.quiknode.pro/feadc60484348e592c993526abde06040c796891/';

const RPC_ENDPOINTS = [
    QN_MANSION,                          // 1. QuickNode Mansion (Primary)
    'https://api.mainnet-beta.solana.com', // 2. Public Mainnet
    'https://rpc.ankr.com/solana',         // 3. Ankr Public
    'https://solana-mainnet.rpc.extrnode.com' // 4. Extrnode Load Balancer
];

// Initialize Cluster Connections
const connections = RPC_ENDPOINTS.map(url => new Connection(url, 'confirmed'));
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const ULTRA_HEADERS = { 
    headers: { 'x-api-key': JUP_API_KEY, 'Content-Type': 'application/json' } 
};

// ==========================================
//  SOLANA EXECUTION (ULTRA SHOTGUN)
// ==========================================

async function executeUltraSwap(chatId, direction, tokenAddress, amountInput) {
    if (!solWallet) return bot.sendMessage(chatId, "⚠️ Wallet Not Connected");

    try {
        const taker = solWallet.publicKey.toString();
        const SOL_MINT = 'So11111111111111111111111111111111111111112';
        const inputMint = direction === 'BUY' ? SOL_MINT : tokenAddress;
        const outputMint = direction === 'BUY' ? tokenAddress : SOL_MINT;
        
        // 1. FETCH HOLDINGS (Using Ultra API for speed)
        const holdingsRes = await axios.get(`${ULTRA_ENDPOINT}/holdings/${taker}`, ULTRA_HEADERS);
        let amountRaw;
        if (direction === 'BUY') {
            amountRaw = Math.floor(amountInput * LAMPORTS_PER_SOL).toString();
        } else {
            const token = holdingsRes.data.tokens[tokenAddress];
            if (!token) throw new Error("No holdings for this token.");
            amountRaw = token[0].amount;
        }

        // 2. GET ULTRA ORDER
        const orderRes = await axios.get(`${ULTRA_ENDPOINT}/order?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountRaw}&taker=${taker}`, ULTRA_HEADERS);
        const { transaction, requestId } = orderRes.data;
        if (!transaction) throw new Error("Order Generation Failed.");

        // 3. SIGN TRANSACTION
        const tx = VersionedTransaction.deserialize(Buffer.from(transaction, 'base64'));
        tx.sign([solWallet]);
        const signedTxBase64 = Buffer.from(tx.serialize()).toString('base64');
        const rawTx = tx.serialize();

        // 4. SHOTGUN BROADCAST (Parallel Execution)
        bot.sendMessage(chatId, `⚔️ **SHOTGUN ENGAGED:** Firing to ${RPC_ENDPOINTS.length + 1} nodes...`);

        const broadcastTasks = [
            // Task A: Jupiter Ultra Internal Execution
            axios.post(`${ULTRA_ENDPOINT}/execute`, { signedTransaction: signedTxBase64, requestId }, ULTRA_HEADERS)
                .then(res => ({ source: 'Jupiter Ultra', sig: res.data.signature })),

            // Task B: Multi-RPC Raw Broadcast
            ...connections.map((conn, i) => 
                conn.sendRawTransaction(rawTx, { skipPreflight: true, maxRetries: 2 })
                    .then(sig => ({ source: i === 0 ? 'QuickNode Mansion' : `Public RPC ${i}`, sig }))
            )
        ];

        // The first successful landing wins the race
        const fastestSuccess = await Promise.any(broadcastTasks);
        
        bot.sendMessage(chatId, `✅ **LANDED:** \`${fastestSuccess.sig}\`\nValidated via: **${fastestSuccess.source}**`);
        return { hash: fastestSuccess.sig };

    } catch (e) {
        const msg = e.response?.data?.error || e.message;
        bot.sendMessage(chatId, `❌ **ULTRA ERROR:** ${msg}`);
        return null;
    }
}

// ==========================================
//  RPG & SYSTEM COMMANDS
// ==========================================

bot.onText(/\/status/, async (msg) => {
    if (!solWallet) return;
    try {
        const balRes = await axios.get(`${ULTRA_ENDPOINT}/holdings/${solWallet.publicKey.toString()}`, ULTRA_HEADERS);
        // Test QuickNode Mansion Slot
        const slot = await connections[0].getSlot();
        bot.sendMessage(msg.chat.id, `📊 **SHOTGUN STATUS**\nBalance: ${balRes.data.uiAmountString} SOL\nQuickNode Mansion: Online (Slot ${slot}) ✅\nParallel Nodes: ${RPC_ENDPOINTS.length} Active`);
    } catch (e) { bot.sendMessage(msg.chat.id, "⚠️ Diagnostic Error."); }
});

// [Rest of RPG System and Connect Logic Preserved]
http.createServer((req, res) => res.end("APEX SHOTGUN ONLINE")).listen(8080);
console.log("APEX v9000 SHOTGUN ONLINE".green);
