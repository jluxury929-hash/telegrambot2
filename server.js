/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (PRODUCTION READY)
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

// --- 1. CONFIG & ENDPOINTS ---
const JUP_API = "https://quote-api.jup.ag/v6";
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }};

const NETWORKS = {
    ETH:  { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', sym: 'ETH' },
    SOL:  { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com'], sym: 'SOL' },
    BASE: { id: 'base', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', sym: 'ETH' },
    BSC:  { id: 'bsc', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', sym: 'BNB' }
};

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MEDIUM', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {}, atomicOn: true, flashOn: false,
    currentAsset: 'So11111111111111111111111111111111111111112'
};

let solWallet, evmWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// --- CONFIGURE COLD STORAGE ---
const COLD_STORAGE = "0xF7a4b02e1c7f67be8B551728197D8E14a7CDFE34"; 
const MIN_SOL_KEEP = 0.05; 

// --- 2. UI MARKUP ---
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `🛡️ RISK: ${SYSTEM.risk}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${SYSTEM.mode}`, callback_data: "cycle_mode" }],
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
    } else if (data === "cmd_auto") {
        if (!solWallet) return bot.answerCallbackQuery(query.id, { text: "❌ Sync Wallet First!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) {
            bot.sendMessage(message.chat.id, "🚀 **AUTO-PILOT ONLINE.** Engaging Radar...");
            Object.keys(NETWORKS).forEach(net => startNetworkSniper(message.chat.id, net));
        }
    } else if (data === "cmd_status") { await runStatusDashboard(message.chat.id); }

    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: message.chat.id, message_id: message.message_id }).catch(() => {});
    bot.answerCallbackQuery(query.id);
});

// --- 4. SIGNAL SCANNER (FIXED FOR DEXSCREENER BOOSTS) ---
async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        if (!res.data || !Array.isArray(res.data)) return null;

        const chainMap = { 'SOL': 'solana', 'ETH': 'ethereum', 'BASE': 'base', 'BSC': 'bsc' };
        const match = res.data.find(t => t.chainId === chainMap[netKey] && !SYSTEM.lastTradedTokens[t.tokenAddress]);

        if (match && match.tokenAddress) {
            return {
                symbol: match.symbol || match.tokenAddress.slice(0,6), // Use slice if symbol undefined
                tokenAddress: match.tokenAddress,
                price: parseFloat(match.priceUsd) || 0.0001
            };
        }
    } catch (e) { return null; }
}

// --- 5. EXECUTION ENGINE (SWAP & BUY) ---
async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal && signal.tokenAddress) {
                    const conn = new Connection("https://api.mainnet-beta.solana.com");
                    const bal = await conn.getBalance(solWallet.publicKey);
                    if (bal < (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 5000000) continue;

                    SYSTEM.isLocked[netKey] = true;
                    bot.sendMessage(chatId, `🎯 **[${netKey}] SIGNAL:** ${signal.symbol}\nAddress: <code>${signal.tokenAddress}</code>\nExecuting Swap...`, { parse_mode: 'HTML' });
                    
                    if (netKey === 'SOL') {
                        const buyRes = await executeSolShotgun(chatId, signal.tokenAddress, signal.symbol);
                        if (buyRes) SYSTEM.lastTradedTokens[signal.tokenAddress] = true;
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
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        // 1. GET QUOTE
        const q = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${addr}&amount=${amt}&slippageBps=100`);
        // 2. GET SWAP TX
        const s = await axios.post(`${JUP_API}/swap`, { quoteResponse: q.data, userPublicKey: solWallet.publicKey.toString(), prioritizationFeeLamports: "auto" });
        // 3. DESERIALIZE & SIGN
        const tx = VersionedTransaction.deserialize(Buffer.from(s.data.swapTransaction, 'base64'));
        tx.sign([solWallet]);
        // 4. JITO BUNDLE SEND
        const raw = Buffer.from(tx.serialize()).toString('base64');
        const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[raw]] });

        if (res.data.result) {
            bot.sendMessage(chatId, `💰 **BOUGHT:** $${symbol} | ID: \`${res.data.result.slice(0,8)}...\``);
            return true;
        }
    } catch (e) { return false; }
}

// --- 6. UTILS ---
bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.sendMessage(msg.chat.id, `✅ **SYNCED:** \`${solWallet.publicKey.toString()}\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ **FAILED**"); }
});

async function runStatusDashboard(chatId) {
    const conn = new Connection("https://api.mainnet-beta.solana.com");
    const bal = solWallet ? (await conn.getBalance(solWallet.publicKey) / 1e9) : 0;
    bot.sendMessage(chatId, `📊 **STATUS:** ${bal.toFixed(3)} SOL | **Auto:** ${SYSTEM.autoPilot ? 'ON' : 'OFF'}`, { parse_mode: 'Markdown' });
}

bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "⚔️ **APEX READY**", { ...getDashboardMarkup() }));
http.createServer((req, res) => res.end("APEX ONLINE")).listen(8080);
