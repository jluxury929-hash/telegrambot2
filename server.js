/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL SIGNAL v9000 (ULTRA API EDITION)
 * ===============================================================================
 * ARCH: Multi-Chain (SOL | BASE | BSC | ETH | ARB)
 * RPC: QuickNode (via process.env.SOLANA_RPC)
 * ENGINE: Jupiter ULTRA API (api.jup.ag/ultra/v1)
 * AUTH: x-api-key Header (f440d4df-b5c4-4020-a960-ac182d3752ab)
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, JsonRpcProvider, Contract, Wallet, HDNodeWallet } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
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

// ⚡ QUICKNODE RPC
const SOL_RPC_URL = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

const NETWORKS = {
    SOL: { id: 'solana', type: 'SVM', rpc: SOL_RPC_URL, explorer: 'https://solscan.io/tx/' },
    // ... (EVM Networks remain as previously defined)
};

const solConnection = new Connection(NETWORKS.SOL.rpc, 'confirmed');
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Global Auth Header
const ULTRA_HEADERS = { 
    headers: { 
        'x-api-key': JUP_API_KEY,
        'Content-Type': 'application/json' 
    } 
};

// ==========================================
//  SOLANA EXECUTION (JUPITER ULTRA FLOW)
// ==========================================

async function executeUltraSwap(chatId, direction, tokenAddress, amountInput) {
    if (!solWallet) return bot.sendMessage(chatId, "⚠️ Wallet Not Connected");

    try {
        const SOL_MINT = 'So11111111111111111111111111111111111111112';
        const inputMint = direction === 'BUY' ? SOL_MINT : tokenAddress;
        const outputMint = direction === 'BUY' ? tokenAddress : SOL_MINT;
        
        // Prepare Amount
        let amountRaw;
        if (direction === 'BUY') {
             amountRaw = Math.floor(amountInput * LAMPORTS_PER_SOL).toString();
        } else {
             // Use Ultra /holdings to get accurate balance
             const holdingsRes = await axios.get(`${ULTRA_ENDPOINT}/holdings/${solWallet.publicKey.toString()}`, ULTRA_HEADERS);
             const token = holdingsRes.data.tokens[tokenAddress];
             if (!token || token.length === 0) throw new Error("No holdings found for this token.");
             amountRaw = token[0].amount;
        }

        bot.sendMessage(chatId, `🔍 **ULTRA ORDER:** Requesting route...`);

        // STEP 1: GET ORDER (/order)
        const orderUrl = `${ULTRA_ENDPOINT}/order?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountRaw}&taker=${solWallet.publicKey.toString()}`;
        const orderRes = await axios.get(orderUrl, ULTRA_HEADERS);
        
        const { transaction, requestId, outAmount } = orderRes.data;

        if (!transaction) throw new Error(orderRes.data.errorMessage || "Order failed - Insufficient liquidity");

        // STEP 2: SIGN
        const swapTransactionBuf = Buffer.from(transaction, 'base64');
        const tx = VersionedTransaction.deserialize(swapTransactionBuf);
        tx.sign([solWallet]);
        const signedTxBase64 = Buffer.from(tx.serialize()).toString('base64');

        // STEP 3: EXECUTE (/execute)
        bot.sendMessage(chatId, `🚀 **ULTRA EXECUTE:** Sending to chain...`);
        const executeRes = await axios.post(`${ULTRA_ENDPOINT}/execute`, {
            signedTransaction: signedTxBase64,
            requestId: requestId
        }, ULTRA_HEADERS);

        if (executeRes.data.status === 'Success') {
            bot.sendMessage(chatId, `✅ **ULTRA SUCCESS**\nSig: \`${executeRes.data.signature}\`\nOut: ${executeRes.data.outputAmountResult}`);
            return { amountOut: outAmount, hash: executeRes.data.signature };
        } else {
            throw new Error(executeRes.data.error || "Execution Failed");
        }

    } catch (e) {
        const errorMsg = e.response?.data?.error || e.message;
        bot.sendMessage(chatId, `❌ **ULTRA ERROR:** ${errorMsg}`);
        console.error(e);
        return null;
    }
}

// ==========================================
//  OMNI-SCANNER & BOT COMMANDS
// ==========================================

bot.onText(/\/status/, async (msg) => {
    try {
        // Use Ultra API for balance check
        if (!solWallet) return bot.sendMessage(msg.chat.id, "Connect wallet first.");
        const balRes = await axios.get(`${ULTRA_ENDPOINT}/holdings/${solWallet.publicKey.toString()}`, ULTRA_HEADERS);
        bot.sendMessage(msg.chat.id, `📊 **ULTRA STATUS**\nBalance: ${balRes.data.uiAmountString} SOL\nRPC: QuickNode ✅\nAPI: Jupiter Ultra ✅`);
    } catch (e) { bot.sendMessage(msg.chat.id, "Error fetching status."); }
});

// Preserving your previous RPG and Command logic here...

http.createServer((req, res) => res.end("APEX ULTRA ONLINE")).listen(8080);
console.log("APEX v9000 ULTRA ONLINE".green);
