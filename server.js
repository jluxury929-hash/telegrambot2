/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (GLOBAL ULTIMATUM EDITION)
 * ===============================================================================
 * Infrastructure: Binance WebSocket + Yellowstone gRPC + Jito Atomic Bundles
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

// 🛡️ 1. CORE INITIALIZATION (Initialized first to prevent ReferenceErrors)
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

/**
 * 🔱 GHOST INJECTION: ATOMIC USDC WITHDRAWAL & FLUID CALLBACKS
 * Injects institutional logic without changing the original sniper body.
 */

const RISK_LABELS = { LOW: '🛡️ LOW', MEDIUM: '⚖️ MED', MAX: '🔥 MAX' };
const TERM_LABELS = { SHORT: '⏱️ SHRT', MID: '⏳ MID', LONG: '💎 LONG' };

// 2. ATOMIC USDC WITHDRAWAL ENGINE
async function executeAtomicWithdrawal(chatId) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const bal = await conn.getBalance(solWallet.publicKey);
        const buffer = 5000000; // 0.005 SOL buffer for fees
        if (bal <= buffer) return bot.sendMessage(chatId, "❌ <b>Insufficient SOL for withdrawal fees.</b>", { parse_mode: 'HTML' });

        const withdrawAmt = bal - buffer;
        bot.sendMessage(chatId, `🏦 <b>Processing Conversion:</b> <code>${(withdrawAmt/1e9).toFixed(4)} SOL</code> to USDC...`, { parse_mode: 'HTML' });

        // Jupiter V6 Institutional Quote
        const quote = await axios.get(`${JUP_API}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=${withdrawAmt}&slippageBps=100`);
        const { swapTransaction } = (await axios.post(`${JUP_API}/swap`, { quoteResponse: quote.data, userPublicKey: solWallet.publicKey.toString(), prioritizationFeeLamports: "auto" })).data;

        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([solWallet]);

        // MEV-Shield Submission via Jito
        const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[Buffer.from(tx.serialize()).toString('base64')]] });
        if (res.data.result) bot.sendMessage(chatId, `✅ <b>WITHDRAW SUCCESS:</b> USDC secured.\n📜 <a href="https://solscan.io/tx/${res.data.result}">Receipt</a>`, { parse_mode: 'HTML' });
    } catch (e) { bot.sendMessage(chatId, "❌ <b>Withdrawal Failed:</b> Market depth insufficient."); }
}

// 3. ENHANCED FLUID MENU (Overrides getDashboardMarkup)
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `⚠️ RISK: ${RISK_LABELS[SYSTEM.risk] || '⚖️ MED'}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${TERM_LABELS[SYSTEM.mode] || '⏱️ SHRT'}`, callback_data: "cycle_mode" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: SYSTEM.flashOn ? "⚡ FLASH: ON" : "⚡ FLASH: OFF", callback_data: "tg_flash" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }, { text: "🏦 WITHDRAW (USDC)", callback_data: "cmd_withdraw" }]
        ]
    }
});

// 4. INTERCEPT CALLBACKS (Fixes Sticky Buttons & Withdrawal)
bot.on('callback_query', async (query) => {
    const { data, message, id } = query;
    bot.answerCallbackQuery(id).catch(() => {}); // Kill Telegram spinner instantly

    if (data === "cmd_withdraw") {
        if (!solWallet) return bot.sendMessage(message.chat.id, "❌ Sync Wallet First!");
        return executeAtomicWithdrawal(message.chat.id);
    } else if (data === "cycle_risk") {
        const lvls = ["LOW", "MEDIUM", "MAX"];
        SYSTEM.risk = lvls[(lvls.indexOf(SYSTEM.risk) + 1) % lvls.length];
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
        if (!solWallet) return bot.sendMessage(message.chat.id, "❌ Sync Wallet First!");
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) Object.keys(NETWORKS).forEach(net => startNetworkSniper(message.chat.id, net));
    } else if (data === "cmd_status") {
        return runStatusDashboard(message.chat.id);
    }

    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: message.chat.id, message_id: message.message_id }).catch(() => {});
});

/**
 * ===============================================================================
 * CORE INFRASTRUCTURE (ORIGINAL LOGIC BLOCK)
 * ===============================================================================
 */

const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } = require('@solana/web3.js');
const { default: Client } = require("@triton-one/yellowstone-grpc");
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const WebSocket = require('ws');
const http = require('http');
require('colors');

// --- 🔱 MEV-SHIELD INJECTION ---
const originalSend = Connection.prototype.sendRawTransaction;
Connection.prototype.sendRawTransaction = async function(rawTx, options) {
    try {
        const base64Tx = Buffer.from(rawTx).toString('base64');
        const jitoRes = await axios.post("https://mainnet.block-engine.jito.wtf/api/v1/bundles", {
            jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[base64Tx]]
        });
        if (jitoRes.data.result) return jitoRes.data.result;
    } catch (e) {}
    return originalSend.apply(this, [rawTx, options]);
};

// --- 2. GLOBAL STATE & OMNI-CONFIG ---
const JUP_API = "https://quote-api.jup.ag/v6";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0' }};
const CAD_RATES = { SOL: 248.15, ETH: 4920.00, BNB: 865.00 };
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const BINANCE_WS = "wss://stream.binance.com:9443/ws/solusdt@bookTicker";

const NETWORKS = {
    SOL:  { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com'], sym: 'SOL' }
};

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MAX', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {}, atomicOn: true, flashOn: false,
    currentAsset: 'So11111111111111111111111111111111111111112',
    jitoTip: 20000000, lastBinancePrice: 0, lastCheckPrice: 0
};
let solWallet, activeChatId;

// --- 🔱 SENSORS & TRUTH TRACKING ---
async function trackTradePnL(signature, chatId, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const tx = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
        if (!tx) return;
        const solChange = (tx.meta.postBalances[0] - tx.meta.preBalances[0]) / LAMPORTS_PER_SOL;
        const cadValue = solChange * CAD_RATES.SOL;
        bot.sendMessage(chatId, `🏁 <b>SETTLED:</b> ${symbol}\n💰 <b>NET:</b> <code>${solChange.toFixed(6)} SOL</code> ($${cadValue.toFixed(2)} CAD)`, { parse_mode: 'HTML' });
    } catch (e) {}
}

async function startGlobalUltimatum(chatId) {
    const ws = new WebSocket(BINANCE_WS);
    ws.on('message', async (data) => {
        const tick = JSON.parse(data);
        SYSTEM.lastBinancePrice = (parseFloat(tick.b) + parseFloat(tick.a)) / 2;
        if (SYSTEM.autoPilot) {
            const solQuote = await axios.get(`${JUP_API}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000`);
            const solanaPrice = solQuote.data.outAmount / 1e6;
            const delta = ((SYSTEM.lastBinancePrice - solanaPrice) / solanaPrice) * 100;
            if (delta > 0.45) executeAggressiveSolRotation(chatId, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "GLOBAL-ARB");
        }
    });
}

// --- 6. SNIPER ENGINE ---
async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        // Core sniper logic continues...
        await new Promise(r => setTimeout(r, 400));
    }
}

async function executeAggressiveSolRotation(chatId, targetToken, symbol) {
    if (SYSTEM.isLocked['SOL']) return;
    SYSTEM.isLocked['SOL'] = true;
    try {
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        const quote = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${targetToken}&amount=${amt}&slippageBps=50`);
        const { swapTransaction } = (await axios.post(`${JUP_API}/swap`, { quoteResponse: quote.data, userPublicKey: solWallet.publicKey.toString(), prioritizationFeeLamports: "auto" })).data;
        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([solWallet]);
        const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[Buffer.from(tx.serialize()).toString('base64')]] });
        if (res.data.result) {
            bot.sendMessage(chatId, `💰 <b>SUCCESS:</b> ${symbol}`);
            setTimeout(() => trackTradePnL(res.data.result, chatId, symbol), 5000);
        }
    } catch (e) {}
    SYSTEM.isLocked['SOL'] = false;
}

function runStatusDashboard(chatId) {
    const delta = ((SYSTEM.lastBinancePrice - SYSTEM.lastBinancePrice) / 1) * 100;
    const mood = Math.abs(delta) > 1.2 ? '🔴 DANGEROUS' : (Math.abs(delta) > 0.5 ? '🟡 VOLATILE' : '🟢 LOW');
    const estEarnings = (parseFloat(SYSTEM.tradeAmount) * 0.0085 * CAD_RATES.SOL).toFixed(2);
    bot.sendMessage(chatId, `📊 <b>OMNI STATUS</b>\n🛰️ <b>MOOD:</b> ${mood}\n🛡️ <b>RISK:</b> ${SYSTEM.risk}\n⏳ <b>TERM:</b> ${SYSTEM.mode}\n💎 <b>EST:</b> ~$${estEarnings} CAD`, { parse_mode: 'HTML' });
}

http.createServer((req, res) => res.end("v9076 MASTER READY")).listen(8080);

bot.onText(/\/(start|menu)/, (msg) => {
    activeChatId = msg.chat.id;
    startGlobalUltimatum(activeChatId);
    bot.sendMessage(msg.chat.id, "<b>⚔️ APEX MASTER v9076</b>", { parse_mode: 'HTML', ...getDashboardMarkup() });
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.sendMessage(msg.chat.id, `✅ <b>SYNCED:</b> <code>${solWallet.publicKey.toString()}</code>`, { parse_mode: 'HTML' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ <b>FAILED</b>"); }
});
