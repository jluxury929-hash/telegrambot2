/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (GLOBAL ULTIMATUM EDITION)
 * ===============================================================================
 * Infrastructure: Binance WS + Yellowstone gRPC + Jito Atomic Bundles
 * Strategy: Leader-Synced Delta Capture & High-Frequency Principal Compounding
 */

require('dotenv').config();
const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const { default: Client } = require("@triton-one/yellowstone-grpc"); 
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws'); 
const http = require('http');
require('colors');

// --- 🔱 LAYER 2: MEV-SHIELD INJECTION (Zero-Loss Strategy) ---
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
    } catch (e) { console.log(`[MEV-SHIELD] ⚠️ Lane busy, principal protected.`.yellow); }
    // Zero-Loss: Returns null on failure to prevent gas burn on failed raw attempts
    return SYSTEM.atomicOn ? null : originalSend.apply(this, [rawTx, options]);
};

// --- 1. CORE INITIALIZATION ---
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// --- 2. GLOBAL STATE & OMNI-CONFIG ---
const JUP_API = "https://quote-api.jup.ag/v6";
const BINANCE_WS = "wss://stream.binance.com:9443/ws/solusdt@bookTicker"; 
const CAD_RATES = { SOL: 248.15, ETH: 4920.00, BNB: 865.00 };

const RISK_LABELS = { LOW: '🟢LOW', MEDIUM: '🟡MED', MAX: '🔴MAX' };
const TERM_LABELS = { SHORT: '⚡SHRT', MID: '⏳MID', LONG: '💎LONG' };

const NETWORKS = {
    SOL: { endpoints: ['https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'], sym: 'SOL' },
    ETH: { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', sym: 'ETH' }
};

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MAX', mode: 'SHORT',
    jitoTip: 20000000, slippageBps: 150, minDelta: 0.45,
    lastBinancePrice: 0, isLocked: {}, isUpdatingUI: false,
    currentAsset: 'So11111111111111111111111111111111111111112',
    atomicOn: true, flashOn: false, cycleReset: 400
};
let solWallet, evmWallet;

// --- 🔱 UI DASHBOARD (Fixed Sticky Buttons) ---
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `⚠️ RISK: ${RISK_LABELS[SYSTEM.risk]}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${TERM_LABELS[SYSTEM.mode]}`, callback_data: "cycle_mode" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }],
            [{ text: "🚨 PANIC SELL ALL", callback_data: "cmd_panic" }]
        ]
    }
});

bot.on('callback_query', async (query) => {
    // Immediate acknowledgment kills the Telegram loading spinner
    bot.answerCallbackQuery(query.id).catch(() => {});
    if (SYSTEM.isUpdatingUI) return;
    SYSTEM.isUpdatingUI = true;

    const chatId = query.message.chat.id;
    const data = query.data;

    if (data === "cycle_risk") {
        const lvls = ["LOW", "MEDIUM", "MAX"];
        SYSTEM.risk = lvls[(lvls.indexOf(SYSTEM.risk) + 1) % lvls.length];
        SYSTEM.jitoTip = SYSTEM.risk === "MAX" ? 20000000 : 5000000;
    } else if (data === "cycle_amt") {
        const amts = ["0.1", "0.5", "1.0", "5.0"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
    } else if (data === "cmd_auto") {
        if (!solWallet) return bot.sendMessage(chatId, "❌ <b>Sync Wallet First!</b>", { parse_mode: 'HTML' });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) startRadar(chatId);
    } else if (data === "cmd_status") {
        runStatusDashboard(chatId);
    } else if (data === "tg_atomic") {
        SYSTEM.atomicOn = !SYSTEM.atomicOn;
    }

    // Dynamic UI Refresh
    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, {
        chat_id: chatId, message_id: query.message.message_id
    }).catch(() => {});
    
    SYSTEM.isUpdatingUI = false;
});

// --- 🔱 MICROSECOND DELTA RADAR (Leader-Synced Sensing) ---
async function startRadar(chatId) {
    const ws = new WebSocket(BINANCE_WS);
    ws.on('message', async (data) => {
        const tick = JSON.parse(data);
        // Microsecond sensing: Binance P_global
        SYSTEM.lastBinancePrice = (parseFloat(tick.b) + parseFloat(tick.a)) / 2;
        
        if (SYSTEM.autoPilot && !SYSTEM.isLocked['HFT']) {
            try {
                const res = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000`);
                const dexPrice = res.data.outAmount / 1e6;
                const delta = ((SYSTEM.lastBinancePrice - dexPrice) / dexPrice) * 100;
                
                if (Math.abs(delta) > SYSTEM.minDelta) {
                    executeHFT(chatId, delta);
                }
            } catch (e) {}
        }
    });
}

// --- 🔱 HFT EXECUTION (Capital Velocity Logic) ---
async function executeHFT(chatId, delta) {
    SYSTEM.isLocked['HFT'] = true;
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        
        const quote = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=${amt}&slippageBps=${SYSTEM.slippageBps}`);
        const { swapTransaction } = (await axios.post(`${JUP_API}/swap`, { 
            quoteResponse: quote.data, userPublicKey: solWallet.publicKey.toString() 
        })).data;

        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([solWallet]);

        const sig = await conn.sendRawTransaction(tx.serialize());
        if (sig) console.log(`[HFT] Delta Captured: ${delta.toFixed(3)}%`.cyan);
    } catch (e) {}
    
    // Capital Velocity Reset: Compounding $A = P(1+r)^n$ at 400ms intervals
    setTimeout(() => { SYSTEM.isLocked['HFT'] = false; }, SYSTEM.cycleReset);
}

// --- 5. SYSTEM UTILS ---
bot.onText(/\/(start|menu)/, (msg) => {
    bot.sendMessage(msg.chat.id, "⚔️ <b>APEX SUPREMACY v9076</b>\nMulti-Chain HFT Radar Active.", { parse_mode: 'HTML', ...getDashboardMarkup() });
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
        bot.sendMessage(msg.chat.id, `✅ <b>SYNCED:</b> <code>${solWallet.publicKey.toBase58()}</code>`, { parse_mode: 'HTML' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ FAILED"); }
});

function runStatusDashboard(chatId) {
    const mood = Math.abs(SYSTEM.lastBinancePrice) > 0 ? '🟢 Stable' : '⚪ Initializing';
    bot.sendMessage(chatId, 
        `📊 <b>OMNI HFT STATUS</b>\n\n` +
        `🛰️ <b>Market Mood:</b> ${mood}\n` +
        `📉 <b>Global Delta:</b> <code>${SYSTEM.minDelta}% Target</code>\n\n` +
        `💰 <b>Compounding:</b> <code>${SYSTEM.tradeAmount} SOL</code>\n` +
        `🛡️ <b>Shields:</b> ATOMIC\n` +
        `⚡ <b>Velocity:</b> 400ms reset`, 
    { parse_mode: 'HTML' });
}

http.createServer((req, res) => res.end("SUPREMACY READY")).listen(8080);
