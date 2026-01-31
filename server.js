/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (GLOBAL ULTIMATUM EDITION)
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- 1. CONFIGURATION ---
const JUP_API = "https://quote-api.jup.ag/v6";
const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }};

const NETWORKS = {
    SOL: { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com'] },
    BSC: { id: 'bsc', rpc: 'https://bsc-dataseed.binance.org/' }
};

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MEDIUM', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {}, atomicOn: true, flashOn: false,
    jitoTip: 2000000, // 0.002 SOL Tip (Minimum for high congestion)
    currentAsset: 'So11111111111111111111111111111111111111112'
};

let solWallet, evmWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const COLD_STORAGE = "0xF7a4b02e1c7f67be8B551728197D8E14a7CDFE34"; 
const MIN_SOL_KEEP = 0.05; 

// --- 2. THE HARDENED EXECUTION CORE (MANDATORY FIX) ---
async function executeSolShotgun(chatId, addr, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        const apiPath = SYSTEM.flashOn ? JUP_ULTRA_API : JUP_API;
        
        // A. GET QUOTE
        const qUrl = `${apiPath}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${addr}&amount=${amt}&slippageBps=150`;
        const q = await axios.get(qUrl, SCAN_HEADERS);
        
        // B. GET SWAP TX (With Dynamic CU & Priority Fees)
        const s = await axios.post(`${JUP_API}/swap`, {
            quoteResponse: q.data,
            userPublicKey: solWallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true, 
            prioritizationFeeLamports: "auto" 
        }, SCAN_HEADERS);

        // C. DESERIALIZE & SIGN (CRITICAL: MUST SIGN AFTER DESERIALIZING)
        const swapBuf = Buffer.from(s.data.swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(swapBuf);
        
        // Fetch Fresh Blockhash to prevent expiry errors
        const { blockhash } = await conn.getLatestBlockhash();
        transaction.message.recentBlockhash = blockhash;
        
        transaction.sign([solWallet]);

        // D. JITO BUNDLE WRAPPER
        const rawTx = Buffer.from(transaction.serialize()).toString('base64');
        const jitoPayload = { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[rawTx]] };

        const res = await axios.post(JITO_ENGINE, jitoPayload);

        if (res.data.result) {
            bot.sendMessage(chatId, `✅ **EXECUTED:** $${symbol}\nJito ID: \`${res.data.result.slice(0,8)}...\``);
            setTimeout(() => trackTradePnL(res.data.result, chatId, symbol), 5000);
            return { success: true, amountOut: q.data.outAmount };
        } else {
            throw new Error(res.data.error?.message || "Jito Rejected Bundle");
        }
    } catch (e) { 
        console.log(`[EXECUTION FAILED]`.red, e.message);
        bot.sendMessage(chatId, `⚠️ **EXECUTION FAILED:** ${e.message.slice(0,50)}...`);
        return { success: false }; 
    }
}

// --- 3. AUTO-PILOT ENGINE ---
async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal && signal.tokenAddress && signal.tokenAddress !== "undefined") {
                    const ready = await verifyBalance(netKey);
                    if (!ready) continue;

                    SYSTEM.isLocked[netKey] = true;
                    bot.sendMessage(chatId, `🧠 **[${netKey}] SIGNAL:** ${signal.symbol}\nStatus: Engaging...`);
                    
                    const buyRes = (netKey === 'SOL')
                        ? await executeSolShotgun(chatId, signal.tokenAddress, signal.symbol)
                        : await executeEvmContract(chatId, netKey, signal.tokenAddress);
                    
                    if (buyRes && buyRes.success) {
                        SYSTEM.lastTradedTokens[signal.tokenAddress] = true;
                        startIndependentPeakMonitor(chatId, netKey, { ...signal, entryPrice: signal.price });
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 5000)); }
    }
}

// --- 4. SIGNAL SCANNER (FIXED JSON PATHS) ---
async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const chainMap = { 'SOL': 'solana', 'BSC': 'bsc' };
        const match = res.data.find(t => t.chainId === chainMap[netKey] && !SYSTEM.lastTradedTokens[t.tokenAddress]);

        if (match && match.tokenAddress) {
            return {
                symbol: match.symbol || match.tokenAddress.slice(0, 6),
                tokenAddress: match.tokenAddress,
                price: parseFloat(match.priceUsd) || 0.0001
            };
        }
    } catch (e) { return null; }
}

// --- 5. UTILS ---
async function verifyBalance(netKey) {
    if (netKey === 'SOL' && solWallet) {
        const conn = new Connection(NETWORKS.SOL.endpoints[0]);
        const bal = await conn.getBalance(solWallet.publicKey);
        return bal >= (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 10000000;
    }
    return true; 
}

bot.on('callback_query', async (query) => {
    const { data, message } = query;
    if (data === "cmd_auto") {
        if (!solWallet) return bot.answerCallbackQuery(query.id, { text: "❌ Sync Wallet!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) {
            bot.sendMessage(message.chat.id, "🚀 **AUTO-PILOT ACTIVE.**");
            Object.keys(NETWORKS).forEach(net => startNetworkSniper(message.chat.id, net));
        }
    }
    bot.answerCallbackQuery(query.id);
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = match[1].trim();
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", (await bip39.mnemonicToSeed(seed)).toString('hex')).key);
        bot.sendMessage(msg.chat.id, `✅ **SYNCED:** \`${solWallet.publicKey.toString()}\``);
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ **FAILED**"); }
});

bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "⚔️ **APEX READY**", { reply_markup: { inline_keyboard: [[{ text: "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }]] } }));
http.createServer((req, res) => res.end("MASTER READY")).listen(8080);
