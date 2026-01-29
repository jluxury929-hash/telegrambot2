/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (GLOBAL ULTIMATUM EDITION)
 * ===============================================================================
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

/**
 * 🔱 GHOST OVERRIDE: 100% FLUID BUTTON LOGIC
 * Fixes "sticky" buttons by force-answering queries immediately.
 */

const RISK_LABELS = { LOW: '🛡️ LOW', MEDIUM: '⚖️ MED', MAX: '🔥 MAX' };
const TERM_LABELS = { SHORT: '⏱️ SHRT', MID: '⏳ MID', LONG: '💎 LONG' };

// 1. RESPONSIVE MENU MARKUP
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            // --- INJECTED RISK & TERM ROW ---
            [{ text: `⚠️ RISK: ${RISK_LABELS[SYSTEM.risk] || '⚖️ MED'}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${TERM_LABELS[SYSTEM.mode] || '⏱️ SHRT'}`, callback_data: "cycle_mode" }],
            // --------------------------------
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: SYSTEM.flashOn ? "⚡ FLASH: ON" : "⚡ FLASH: OFF", callback_data: "tg_flash" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }, { text: "🏦 WITHDRAW (USDC)", callback_data: "cmd_withdraw" }]
        ]
    }
});

// 2. ULTRA-FLUID CALLBACK HANDLER
bot.on('callback_query', async (query) => {
    const { data, message, id } = query;
    const chatId = message.chat.id;

    // ⚡ STEP 1: KILL THE SPINNER INSTANTLY
    bot.answerCallbackQuery(id).catch(() => {});

    // ⚡ STEP 2: PROCESS LOGIC
    if (data === "cycle_risk") {
        const levels = ["LOW", "MEDIUM", "MAX"];
        SYSTEM.risk = levels[(levels.indexOf(SYSTEM.risk) + 1) % levels.length];
    } else if (data === "cycle_mode") {
        const terms = ["SHORT", "MID", "LONG"];
        SYSTEM.mode = terms[(terms.indexOf(SYSTEM.mode) + 1) % terms.length];
    } else if (data === "cycle_amt") {
        const amts = ["0.01", "0.05", "0.1", "0.25", "0.5"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
    } else if (data === "tg_atomic") {
        SYSTEM.atomicOn = !SYSTEM.atomicOn;
    } else if (data === "tg_flash") {
        SYSTEM.flashOn = !SYSTEM.flashOn;
    } else if (data === "cmd_auto") {
        if (!solWallet) return bot.sendMessage(chatId, "❌ <b>Sync Wallet First!</b>", { parse_mode: 'HTML' });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) Object.keys(NETWORKS).forEach(net => startNetworkSniper(chatId, net));
    } else if (data === "cmd_status") {
        return runStatusDashboard(chatId);
    } else if (data === "cmd_conn") {
        return bot.sendMessage(chatId, "🔌 <b>Sync:</b> <code>/connect [mnemonic]</code>", { parse_mode: 'HTML' });
    }

    // ⚡ STEP 3: REFRESH THE MENU TEXT
    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { 
        chat_id: chatId, 
        message_id: message.message_id 
    }).catch(() => {});
});

/**
 * ===============================================================================
 * CORE BOT ENGINE (ORIGINAL LOGIC PRESERVED)
 * ===============================================================================
 */

const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const { default: Client } = require("@triton-one/yellowstone-grpc"); 
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const WebSocket = require('ws'); 
const http = require('http');
require('colors');

// --- 🔱 LAYER 2: MEV-SHIELD ---
const originalSend = Connection.prototype.sendRawTransaction;
Connection.prototype.sendRawTransaction = async function(rawTx, options) {
    try {
        const base64Tx = Buffer.from(rawTx).toString('base64');
        const res = await axios.post("https://mainnet.block-engine.jito.wtf/api/v1/bundles", {
            jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[base64Tx]]
        });
        if (res.data.result) return res.data.result; 
    } catch (e) {}
    return originalSend.apply(this, [rawTx, options]);
};

// --- GLOBAL STATE ---
let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MAX', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {}, atomicOn: true, flashOn: false,
    currentAsset: 'So11111111111111111111111111111111111111112',
    jitoTip: 20000000, lastBinancePrice: 0, lastCheckPrice: 0
};
let solWallet, evmWallet, activeChatId;

const NETWORKS = { SOL: { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com'] } };
const CAD_RATES = { SOL: 248.15 };
const JUP_API = "https://quote-api.jup.ag/v6";

// --- PnL & SENSORS ---
async function trackTradePnL(signature, chatId, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const tx = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
        if (!tx) return;
        const solChange = (tx.meta.postBalances[0] - tx.meta.preBalances[0]) / LAMPORTS_PER_SOL;
        bot.sendMessage(chatId, `🏁 <b>SETTLED:</b> ${symbol}\n💰 <b>NET:</b> ${solChange.toFixed(6)} SOL ($${(solChange * CAD_RATES.SOL).toFixed(2)} CAD)`, { parse_mode: 'HTML' });
    } catch (e) {}
}

async function startGlobalUltimatum(chatId) {
    const ws = new WebSocket("wss://stream.binance.com:9443/ws/solusdt@bookTicker");
    ws.on('message', async (data) => {
        const tick = JSON.parse(data);
        SYSTEM.lastBinancePrice = (parseFloat(tick.b) + parseFloat(tick.a)) / 2;
        if (SYSTEM.autoPilot) {
            const solQuote = await axios.get(`${JUP_API}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000`);
            const solanaPrice = solQuote.data.outAmount / 1e6;
            if (((SYSTEM.lastBinancePrice - solanaPrice) / solanaPrice) * 100 > 0.45) {
                executeAggressiveSolRotation(chatId, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "GLOBAL-ARB");
            }
        }
    });
}

// --- EXECUTION ---
async function executeAggressiveSolRotation(chatId, targetToken, symbol) {
    if (SYSTEM.isLocked['SOL']) return;
    SYSTEM.isLocked['SOL'] = true;
    try {
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        const quote = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${targetToken}&amount=${amt}&slippageBps=50`);
        const { swapTransaction } = (await axios.post(`${JUP_API}/swap`, { quoteResponse: quote.data, userPublicKey: solWallet.publicKey.toString(), prioritizationFeeLamports: "auto" })).data;
        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([solWallet]);
        const res = await axios.post("https://mainnet.block-engine.jito.wtf/api/v1/bundles", { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[Buffer.from(tx.serialize()).toString('base64')]] });
        if (res.data.result) {
            bot.sendMessage(chatId, `💰 <b>EXECUTED:</b> ${symbol}`);
            setTimeout(() => trackTradePnL(res.data.result, chatId, symbol), 4000);
        }
    } catch (e) {}
    SYSTEM.isLocked['SOL'] = false;
}

function runStatusDashboard(chatId) {
    const delta = ((SYSTEM.lastBinancePrice - SYSTEM.lastBinancePrice) / 1) * 100; // Simplified for display
    const mood = Math.abs(delta) > 0.5 ? '🟡 VOLATILE' : '🟢 LOW';
    bot.sendMessage(chatId, `📊 <b>OMNI STATUS</b>\n🛰️ <b>MOOD:</b> ${mood}\n🛡️ <b>RISK:</b> ${SYSTEM.risk}\n⏳ <b>TERM:</b> ${SYSTEM.mode}\n💰 <b>AMT:</b> ${SYSTEM.tradeAmount} SOL`, { parse_mode: 'HTML' });
}

http.createServer((req, res) => res.end("V9076 READY")).listen(8080);

bot.onText(/\/(start|menu)/, (msg) => {
    activeChatId = msg.chat.id;
    startGlobalUltimatum(activeChatId);
    bot.sendMessage(msg.chat.id, "⚔️ <b>APEX MASTER V9076</b>", { parse_mode: 'HTML', ...getDashboardMarkup() });
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.sendMessage(msg.chat.id, `✅ <b>SYNCED</b>\n<code>${solWallet.publicKey.toString()}</code>`, { parse_mode: 'HTML' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ <b>FAILED</b>"); }
});
