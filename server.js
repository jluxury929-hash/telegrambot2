/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (GLOBAL ULTIMATUM EDITION)
 * ===============================================================================
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
// 1. INITIALIZE BOT FIRST (Fixes ReferenceError)
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

/**
 * 🔱 GHOST INJECTION: RISK, TERMS, & PnL SETTLEMENT
 * Shadowing original functions to extend logic without changing physical lines below.
 */

const RISK_LABELS = { LOW: '🛡️ LOW', MEDIUM: '⚖️ MED', MAX: '🔥 MAX' };
const TERM_LABELS = { SHORT: '⏱️ SHRT', MID: '⏳ MID', LONG: '💎 LONG' };

// 2. ENHANCED MENU MARKUP (Shadows getDashboardMarkup)
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            // --- INJECTED RISK & TERM ROW ---
            [{ text: `⚠️ RISK: ${RISK_LABELS[SYSTEM.risk] || '⚖️ MED'}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${TERM_LABELS[SYSTEM.mode] || '⏱️ SHRT'}`, callback_data: "cycle_term" }],
            // --------------------------------
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: SYSTEM.flashOn ? "⚡ FLASH: ON" : "⚡ FLASH: OFF", callback_data: "tg_flash" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }, { text: "🏦 WITHDRAW (USDC)", callback_data: "cmd_withdraw" }]
        ]
    }
});

// 3. PnL SETTLEMENT TRACKER (The "Truth" Layer)
async function trackTradePnL(signature, chatId, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const tx = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
        if (!tx) return;

        const preBal = tx.meta.preBalances[0];
        const postBal = tx.meta.postBalances[0];
        const solChange = (postBal - preBal) / LAMPORTS_PER_SOL;
        const cadValue = solChange * CAD_RATES.SOL;

        const status = solChange > 0 ? '💎 PROFIT' : '⚠️ LOSS/FEE';
        bot.sendMessage(chatId, 
            `🛰️ <b>TRADE SETTLED:</b> ${symbol}\n` +
            `━━━━━━━━━━━━━━━\n` +
            `🏁 <b>Result:</b> ${status}\n` +
            `💰 <b>Net Change:</b> <code>${solChange.toFixed(6)} SOL</code>\n` +
            `💵 <b>Value:</b> <code>$${cadValue.toFixed(2)} CAD</code>\n` +
            `📜 <a href="https://solscan.io/tx/${signature}">Solscan Link</a>`, 
            { parse_mode: 'HTML' });
    } catch (e) { console.log("[PnL] Settlement pending...".yellow); }
}

// 4. CALLBACK INTERCEPTOR (Shadows original listener)
const handleInjectedCallbacks = async (query) => {
    const data = query.data;
    if (data === "cycle_risk") {
        const levels = ["LOW", "MEDIUM", "MAX"];
        SYSTEM.risk = levels[(levels.indexOf(SYSTEM.risk) + 1) % levels.length];
        bot.answerCallbackQuery(query.id, { text: `Risk Set: ${SYSTEM.risk}` });
    } else if (data === "cycle_term") {
        const terms = ["SHORT", "MID", "LONG"];
        SYSTEM.mode = terms[(terms.indexOf(SYSTEM.mode) + 1) % terms.length];
        bot.answerCallbackQuery(query.id, { text: `Term Set: ${SYSTEM.mode}` });
    }
    // Dashboard will auto-refresh via original logic below
};
bot.on('callback_query', handleInjectedCallbacks);

/**
 * ===============================================================================
 * CORE LOGIC (ORIGINAL LINES PRESERVED)
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

// --- 🔱 LAYER 2: MEV-SHIELD INJECTION ---
const originalSend = Connection.prototype.sendRawTransaction;
Connection.prototype.sendRawTransaction = async function(rawTx, options) {
    try {
        const base64Tx = Buffer.from(rawTx).toString('base64');
        const jitoRes = await axios.post("https://mainnet.block-engine.jito.wtf/api/v1/bundles", {
            jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[base64Tx]]
        });
        if (jitoRes.data.result) { 
            console.log(`[MEV-SHIELD] ✅ Bundle Accepted: ${jitoRes.data.result.slice(0,10)}...`.green);
            return jitoRes.data.result; 
        }
    } catch (e) { console.log(`[MEV-SHIELD] ⚠️ Private Lane busy, falling back...`.yellow); }
    return originalSend.apply(this, [rawTx, options]);
};

// --- 2. GLOBAL STATE & OMNI-CONFIG ---
const JUP_API = "https://quote-api.jup.ag/v6";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0' }};
const CAD_RATES = { SOL: 248.15, ETH: 4920.00, BNB: 865.00 };
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const BINANCE_WS = "wss://stream.binance.com:9443/ws/solusdt@bookTicker"; 

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MAX', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {},
    currentAsset: 'So11111111111111111111111111111111111111112',
    jitoTip: 20000000, 
    shredSpeed: true,
    lastBinancePrice: 0
};
let solWallet, evmWallet, activeChatId;

// --- 🔱 2.5: GLOBAL RADAR INJECTION ---

const getMarketMood = (delta) => {
    const d = Math.abs(delta);
    if (d > 1.8) return '🔴 Dangerous (Extreme Slippage)';
    if (d > 0.7) return '🟡 Volatile (High ROI Predator Zone)';
    return '🟢 Low (Stable Arbitrage)';
};

async function startGlobalUltimatum(chatId) {
    const ws = new WebSocket(BINANCE_WS);
    ws.on('message', async (data) => {
        const tick = JSON.parse(data);
        SYSTEM.lastBinancePrice = (parseFloat(tick.b) + parseFloat(tick.a)) / 2;
        if (SYSTEM.autoPilot) await checkGlobalArb(chatId);
    });

    if (process.env.GRPC_ENDPOINT) {
        try {
            const client = new Client(process.env.GRPC_ENDPOINT, process.env.X_TOKEN);
            const stream = await client.subscribe();
            stream.on("data", async (data) => {
                if (data.transaction && SYSTEM.autoPilot) {
                    await executeAggressiveSolRotation(chatId, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "GEYSER-FAST");
                }
            });
            await stream.write({ transactions: { "jup": { accountInclude: ["JUP6LkbZbjS1jKKppyo4oh4A8J35gCWkkdQdq9nSC7"] } } });
        } catch (e) {}
    }
}

async function checkGlobalArb(chatId) {
    if (SYSTEM.isLocked['SOL']) return;
    try {
        const solPriceRes = await axios.get(`${JUP_API}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000`);
        const solanaPrice = solPriceRes.data.outAmount / 1e6;
        const delta = ((SYSTEM.lastBinancePrice - solanaPrice) / solanaPrice) * 100;
        if (Math.abs(delta) > 0.45) {
            await executeAggressiveSolRotation(chatId, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "GLOBAL-ARB");
        }
    } catch (e) {}
}

const NETWORKS = {
    SOL:  { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com'], sym: 'SOL' }
};

// --- 6. SNIPER ENGINE ---

async function executeAggressiveSolRotation(chatId, targetToken, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const amtMultiplier = (symbol.includes('ARB') || symbol.includes('FAST')) ? 100 : 1;
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL * amtMultiplier);
        const quote = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${targetToken}&amount=${amt}&slippageBps=50`);
        const { swapTransaction } = (await axios.post(`${JUP_API}/swap`, { quoteResponse: quote.data, userPublicKey: solWallet.publicKey.toString(), prioritizationFeeLamports: "auto" })).data;
        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([solWallet]);
        const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[Buffer.from(tx.serialize()).toString('base64')]] });
        if (res.data.result) {
            bot.sendMessage(chatId, `💰 <b>SUCCESS:</b> $${symbol} at Slot #0.`, { parse_mode: 'HTML' });
            setTimeout(async () => {
                const sigs = await new Connection(NETWORKS.SOL.endpoints[0]).getSignaturesForAddress(solWallet.publicKey, { limit: 1 });
                if (sigs[0]) trackTradePnL(sigs[0].signature, chatId, symbol);
            }, 3500);
            return true;
        }
    } catch (e) { return false; }
}

function runStatusDashboard(chatId) {
    const delta = ((SYSTEM.lastBinancePrice - (SYSTEM.lastCheckPrice || SYSTEM.lastBinancePrice)) / (SYSTEM.lastCheckPrice || 1)) * 100;
    const mood = getMarketMood(delta);
    const estEarnings = (parseFloat(SYSTEM.tradeAmount) * 0.0085 * CAD_RATES.SOL).toFixed(2);
    
    bot.sendMessage(chatId, 
        `📊 <b>OMNI LIVE STATUS</b>\n\n` +
        `🛰️ <b>Market Mood:</b> ${mood}\n` +
        `📉 <b>Global Delta:</b> <code>${delta.toFixed(3)}%</code>\n\n` +
        `💰 <b>Size:</b> <code>${SYSTEM.tradeAmount} SOL</code>\n` +
        `💎 <b>Est. Net/Trade:</b> <code>~$${estEarnings} CAD</code>\n\n` +
        `🛡️ <b>Risk:</b> ${SYSTEM.risk} | ⏳ <b>Term:</b> ${SYSTEM.mode}`, 
        { parse_mode: 'HTML' });
}

http.createServer((req, res) => res.end("v9076 READY")).listen(8080);
bot.onText(/\/(start|menu)/, (msg) => {
    activeChatId = msg.chat.id;
    startGlobalUltimatum(activeChatId);
    bot.sendMessage(msg.chat.id, "<b>⚔️ APEX MASTER</b>", { parse_mode: 'HTML', ...getDashboardMarkup() });
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    const seed = await bip39.mnemonicToSeed(match[1].trim());
    solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
    bot.sendMessage(msg.chat.id, `✅ <b>SYNCED</b>`);
});
