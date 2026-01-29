/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (GLOBAL ULTIMATUM EDITION)
 * ===============================================================================
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

/**
 * 🔱 GHOST OVERRIDE: FLUID MENU & PnL TOOLS
 * Prevents "sticky" buttons by acknowledging every callback immediately.
 */

const RISK_LABELS = { LOW: '🛡️ LOW', MEDIUM: '⚖️ MED', MAX: '🔥 MAX' };
const TERM_LABELS = { SHORT: '⏱️ SHRT', MID: '⏳ MID', LONG: '💎 LONG' };

const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `⚠️ RISK: ${RISK_LABELS[SYSTEM.risk] || '⚖️ MED'}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${TERM_LABELS[SYSTEM.mode] || '⏱️ SHRT'}`, callback_data: "cycle_term" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: SYSTEM.flashOn ? "⚡ FLASH: ON" : "⚡ FLASH: OFF", callback_data: "tg_flash" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }, { text: "🏦 WITHDRAW (USDC)", callback_data: "cmd_withdraw" }]
        ]
    }
});

const handleInjectedCallbacks = async (query) => {
    const data = query.data;
    
    // 🛡️ CRITICAL FIX: Acknowledge the click immediately to remove "loading" state
    bot.answerCallbackQuery(query.id).catch(() => {});

    if (data === "cycle_risk") {
        const levels = ["LOW", "MEDIUM", "MAX"];
        SYSTEM.risk = levels[(levels.indexOf(SYSTEM.risk) + 1) % levels.length];
    } else if (data === "cycle_term") {
        const terms = ["SHORT", "MID", "LONG"];
        SYSTEM.mode = terms[(terms.indexOf(SYSTEM.mode) + 1) % terms.length];
    }

    // Refresh UI immediately after state change
    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { 
        chat_id: query.message.chat.id, 
        message_id: query.message.message_id 
    }).catch(() => {});
};
bot.on('callback_query', handleInjectedCallbacks);

/**
 * ===============================================================================
 * APEX PREDATOR: CORE LOGIC
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

// --- 🔱 LAYER 2: MEV-SHIELD INJECTION ---
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

// --- 2. GLOBAL STATE ---
let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MAX', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {},
    currentAsset: 'So11111111111111111111111111111111111111112',
    jitoTip: 20000000, lastBinancePrice: 0
};
let solWallet, evmWallet, activeChatId;

const CAD_RATES = { SOL: 248.15 };
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const BINANCE_WS = "wss://stream.binance.com:9443/ws/solusdt@bookTicker"; 
const JUP_API = "https://quote-api.jup.ag/v6";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0' }};

// --- 🔱 RADAR & SNIPER LOGIC ---
async function trackTradePnL(signature, chatId, symbol) {
    try {
        const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
        const tx = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
        if (!tx) return;
        const preBal = tx.meta.preBalances[0];
        const postBal = tx.meta.postBalances[0];
        const solChange = (postBal - preBal) / LAMPORTS_PER_SOL;
        bot.sendMessage(chatId, `🛰️ <b>SETTLED:</b> ${symbol}\n💰 <b>NET:</b> ${solChange.toFixed(6)} SOL (approx $${(solChange * CAD_RATES.SOL).toFixed(2)} CAD)`, { parse_mode: 'HTML' });
    } catch (e) {}
}

async function startGlobalUltimatum(chatId) {
    const ws = new WebSocket(BINANCE_WS);
    ws.on('message', async (data) => {
        const tick = JSON.parse(data);
        SYSTEM.lastBinancePrice = (parseFloat(tick.b) + parseFloat(tick.a)) / 2;
        if (SYSTEM.autoPilot) await checkGlobalArb(chatId);
    });
}

async function checkGlobalArb(chatId) {
    if (SYSTEM.isLocked['SOL']) return;
    try {
        const solanaPriceRes = await axios.get(`${JUP_API}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000`);
        const solanaPrice = solPriceRes.data.outAmount / 1e6;
        const delta = ((SYSTEM.lastBinancePrice - solanaPrice) / solanaPrice) * 100;
        if (Math.abs(delta) > 0.45) executeAggressiveSolRotation(chatId, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "GLOBAL-ARB");
    } catch (e) {}
}

async function executeAggressiveSolRotation(chatId, targetToken, symbol) {
    try {
        const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        const quote = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${targetToken}&amount=${amt}&slippageBps=50`);
        const { swapTransaction } = (await axios.post(`${JUP_API}/swap`, { quoteResponse: quote.data, userPublicKey: solWallet.publicKey.toString(), prioritizationFeeLamports: "auto" })).data;
        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([solWallet]);
        const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[Buffer.from(tx.serialize()).toString('base64')]] });
        if (res.data.result) {
            bot.sendMessage(chatId, `💰 <b>SUCCESS:</b> ${symbol}`);
            setTimeout(() => trackTradePnL(res.data.result, chatId, symbol), 5000);
            return true;
        }
    } catch (e) { return false; }
}

http.createServer((req, res) => res.end("READY")).listen(8080);

bot.onText(/\/(start|menu)/, (msg) => {
    activeChatId = msg.chat.id;
    startGlobalUltimatum(activeChatId);
    bot.sendMessage(msg.chat.id, "⚔️ <b>APEX MASTER V9076</b>", { parse_mode: 'HTML', ...getDashboardMarkup() });
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    const seed = await bip39.mnemonicToSeed(match[1].trim());
    solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
    bot.sendMessage(msg.chat.id, `✅ <b>SYNCED</b>\n<code>${solWallet.publicKey.toString()}</code>`, { parse_mode: 'HTML' });
});
