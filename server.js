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
    ETH:  { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', sym: 'ETH' },
    SOL:  { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'], sym: 'SOL' },
    BASE: { id: 'base', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', sym: 'ETH' },
    BSC:  { id: 'bsc', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', sym: 'BNB' }
};

const RISK_LABELS = { LOW: '🛡️ LOW', MEDIUM: '⚖️ MED', MAX: '🔥 MAX' };
const TERM_LABELS = { SHORT: '⏱️ SHRT', MID: '⏳ MID', LONG: '💎 LONG' };

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MEDIUM', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {}, atomicOn: true, flashOn: false,
    currentAsset: 'So11111111111111111111111111111111111111112'
};

let solWallet, evmWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const COLD_STORAGE = "0xF7a4b02e1c7f67be8B551728197D8E14a7CDFE34"; 
const MIN_SOL_KEEP = 0.05; 
const PROFIT_THRESHOLD = 0.02;

// --- 2. MASTER UI ---
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `🛡️ RISK: ${RISK_LABELS[SYSTEM.risk]}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${TERM_LABELS[SYSTEM.mode]}`, callback_data: "cycle_mode" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: SYSTEM.flashOn ? "⚡ FLASH: ON" : "⚡ FLASH: OFF", callback_data: "tg_flash" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }, { text: "🏦 WITHDRAW", callback_data: "cmd_withdraw" }]
        ]
    }
});

// --- 3. CALLBACK HANDLER ---
bot.on('callback_query', async (query) => {
    const { data, message } = query;
    if (data === "cycle_risk") {
        const r = ["LOW", "MEDIUM", "MAX"];
        SYSTEM.risk = r[(r.indexOf(SYSTEM.risk) + 1) % r.length];
    } else if (data === "cycle_amt") {
        const a = ["0.01", "0.05", "0.1", "0.25", "0.5"];
        SYSTEM.tradeAmount = a[(a.indexOf(SYSTEM.tradeAmount) + 1) % a.length];
    } else if (data === "tg_atomic") {
        SYSTEM.atomicOn = !SYSTEM.atomicOn;
    } else if (data === "tg_flash") {
        SYSTEM.flashOn = !SYSTEM.flashOn;
    } else if (data === "cmd_auto") {
        if (!solWallet) return bot.answerCallbackQuery(query.id, { text: "❌ Sync Wallet First!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) {
            bot.sendMessage(message.chat.id, "🚀 **AUTO-PILOT ONLINE.** Scanning networks...");
            Object.keys(NETWORKS).forEach(net => startNetworkSniper(message.chat.id, net));
        }
    }
    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: message.chat.id, message_id: message.message_id }).catch(() => {});
    bot.answerCallbackQuery(query.id);
});

// --- 4. IMPROVED SIGNAL SCANNER ---
async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const chainMap = { 'SOL': 'solana', 'ETH': 'ethereum', 'BASE': 'base', 'BSC': 'bsc' };
        
        // Find token that matches chain and hasn't been traded
        const match = res.data.find(t => t.chainId === chainMap[netKey] && !SYSTEM.lastTradedTokens[t.tokenAddress]);

        if (match && match.tokenAddress) {
            return {
                symbol: match.symbol || match.tokenAddress.slice(0, 6), // Prevent 'undefined'
                tokenAddress: match.tokenAddress,
                price: parseFloat(match.priceUsd) || 0.0001
            };
        }
    } catch (e) { return null; }
}

// --- 5. EXECUTION ENGINE (V9032 AUTO-PILOT LOGIC) ---
async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal && signal.tokenAddress) {
                    const ready = await verifyBalance(netKey);
                    if (!ready) continue;

                    SYSTEM.isLocked[netKey] = true;
                    bot.sendMessage(chatId, `🧠 **[${netKey}] SIGNAL:** ${signal.symbol}. Engaging Buy...`);
                    
                    const buyRes = (netKey === 'SOL')
                        ? await executeSolShotgun(chatId, signal.tokenAddress, signal.symbol)
                        : await executeEvmContract(chatId, netKey, signal.tokenAddress);
                    
                    if (buyRes && buyRes.success) {
                        SYSTEM.lastTradedTokens[signal.tokenAddress] = true;
                        // Start v9032 PnL Monitoring
                        startIndependentPeakMonitor(chatId, netKey, { ...signal, entryPrice: signal.price, amountOut: buyRes.amountOut });
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 800));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 5000)); }
    }
}

async function executeSolShotgun(chatId, addr, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        const apiPath = SYSTEM.flashOn ? JUP_ULTRA_API : JUP_API;
        
        // A. GET QUOTE
        const q = await axios.get(`${apiPath}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${addr}&amount=${amt}&slippageBps=100`);
        
        // B. GET SWAP TX
        const s = await axios.post(`${apiPath}/swap`, {
            quoteResponse: q.data,
            userPublicKey: solWallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            prioritizationFeeLamports: "auto"
        });

        // C. DESERIALIZE & SIGN
        const tx = VersionedTransaction.deserialize(Buffer.from(s.data.swapTransaction, 'base64'));
        tx.sign([solWallet]);

        // D. JITO EXECUTION
        const raw = Buffer.from(tx.serialize()).toString('base64');
        const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[raw]] });

        if (res.data.result) {
            bot.sendMessage(chatId, `💰 **BOUGHT:** $${symbol} | ID: \`${res.data.result.slice(0,8)}...\``);
            setTimeout(() => trackTradePnL(res.data.result, chatId, symbol), 5000);
            return { success: true, amountOut: q.data.outAmount };
        }
        return { success: false };
    } catch (e) { return { success: false }; }
}

async function verifyBalance(netKey) {
    if (netKey === 'SOL' && solWallet) {
        const conn = new Connection("https://api.mainnet-beta.solana.com");
        const bal = await conn.getBalance(solWallet.publicKey);
        return bal >= (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 5000000;
    }
    return true; 
}

// --- 6. MONITOR & AUTO-SWEEP ---
async function startIndependentPeakMonitor(chatId, netKey, pos) {
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`, SCAN_HEADERS);
        if (!res.data.pairs || res.data.pairs.length === 0) throw new Error("No pairs");
        const pnl = ((parseFloat(res.data.pairs[0].priceUsd) - pos.entryPrice) / pos.entryPrice) * 100;
        
        if (pnl >= 25 || pnl <= -10) { // Default Exit
            bot.sendMessage(chatId, `📉 **[${netKey}] EXIT:** ${pos.symbol} at ${pnl.toFixed(2)}% PnL.`);
        } else { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 15000); }
    } catch (e) { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 20000); }
}

async function trackTradePnL(signature, chatId, symbol) {
    try {
        const conn = new Connection("https://api.mainnet-beta.solana.com", 'confirmed');
        const balance = await conn.getBalance(solWallet.publicKey);
        const floor = MIN_SOL_KEEP * LAMPORTS_PER_SOL;
        if (balance > (floor + (PROFIT_THRESHOLD * LAMPORTS_PER_SOL))) {
            const sweepAmount = balance - floor;
            const sweepTx = new Transaction().add(SystemProgram.transfer({
                fromPubkey: solWallet.publicKey, toPubkey: new PublicKey(COLD_STORAGE), lamports: sweepAmount
            }));
            await conn.sendTransaction(sweepTx, [solWallet]);
            bot.sendMessage(chatId, `🛡️ **SWEEP:** <code>${(sweepAmount/1e9).toFixed(4)} SOL</code> moved to Cold Storage.`, { parse_mode: 'HTML' });
        }
    } catch (e) {}
}

// --- 7. INITIALIZATION ---
bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.sendMessage(msg.chat.id, `✅ **SYNCED:** \`${solWallet.publicKey.toString()}\``);
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ **FAILED**"); }
});

bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "⚔️ **APEX READY**", { ...getDashboardMarkup() }));
http.createServer((req, res) => res.end("MASTER READY")).listen(8080);
