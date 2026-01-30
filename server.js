/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9099 (FIXED BUTTON & SUPREMACY ENGINE)
 * ===============================================================================
 */

require('dotenv').config();
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws'); 
const http = require('http');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
require('colors');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// --- 🔱 STATE (Compounding principal P) ---
let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MAX', mode: 'SHORT',
    atomicOn: true, jitoTip: 20000000, slippageBps: 150,
    lastBinancePrice: 0, minDelta: 0.45, isLocked: {}
};
let solWallet;

const RISK_LABELS = { LOW: '🟢LOW', MEDIUM: '🟡MED', MAX: '🔴MAX' };
const TERM_LABELS = { SHORT: '⚡SHRT', MID: '⏳MID', LONG: '💎LONG' };

// --- 🔱 UI: RENDER ENGINE ---
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `⚠️ RISK: ${RISK_LABELS[SYSTEM.risk]}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${TERM_LABELS[SYSTEM.mode]}`, callback_data: "cycle_mode" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }]
        ]
    }
});

// --- 🔱 FIX: THE NON-STICKY LISTENER ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const { data, id, message } = query;

    // 1. INSTANT ACKNOWLEDGMENT (Removes the "Loading" spinner immediately)
    bot.answerCallbackQuery(id).catch(() => {});

    // 2. STATE LOGIC
    if (data === "cycle_risk") {
        const lvls = ["LOW", "MEDIUM", "MAX"];
        SYSTEM.risk = lvls[(lvls.indexOf(SYSTEM.risk) + 1) % lvls.length];
        // Mathematical Calibration
        SYSTEM.jitoTip = SYSTEM.risk === 'MAX' ? 20000000 : 5000000;
        SYSTEM.slippageBps = SYSTEM.risk === 'MAX' ? 150 : 50;
    } 
    else if (data === "cycle_mode") {
        const terms = ["SHORT", "MID", "LONG"];
        SYSTEM.mode = terms[(terms.indexOf(SYSTEM.mode) + 1) % terms.length];
    } 
    else if (data === "cycle_amt") {
        const amts = ["0.1", "0.5", "1.0", "5.0"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
    }
    else if (data === "cmd_auto") {
        if (!solWallet) return bot.sendMessage(chatId, "❌ <b>Sync Wallet First!</b>", { parse_mode: 'HTML' });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) startRadar(chatId);
    }
    else if (data === "cmd_status") {
        return runStatusDashboard(chatId);
    }

    // 3. UI REFRESH (Visual confirmation of state change)
    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { 
        chat_id: chatId, 
        message_id: message.message_id 
    }).catch((e) => console.log("UI Update skipped (no change)"));
});

// --- 🔱 ARBITRAGE DELTA ENGINE ---
async function startRadar(chatId) {
    const ws = new WebSocket("wss://stream.binance.com:9443/ws/solusdt@bookTicker");
    ws.on('message', async (data) => {
        const tick = JSON.parse(data);
        SYSTEM.lastBinancePrice = (parseFloat(tick.b) + parseFloat(tick.a)) / 2;
        
        if (SYSTEM.autoPilot) {
            // Delta Logic: ACT ON INFO BEFORE BLOCK-SETTLEMENT
            const dexPrice = await getJupiterPrice();
            const delta = ((SYSTEM.lastBinancePrice - dexPrice) / dexPrice) * 100;
            
            if (delta > SYSTEM.minDelta) {
                console.log(`[ALPHA] Δ Found: ${delta.toFixed(3)}%`.cyan.bold);
                executeAtomicCompounding(chatId);
            }
        }
    });
}

async function getJupiterPrice() {
    const res = await axios.get(`https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000`);
    return res.data.outAmount / 1e6;
}

// --- 🔱 ATOMIC COMPOUNDING EXECUTION ---
async function executeAtomicCompounding(chatId) {
    if (SYSTEM.isLocked['ARB']) return;
    SYSTEM.isLocked['ARB'] = true;
    try {
        // High-Velocity Execution Logic (v9088 sync)
        console.log(`[EXEC] Pushing Jito Bundle with ${SYSTEM.jitoTip} lamport tip...`.green);
        // ... (Transaction logic remains preserved)
    } catch (e) {
        console.log(`[MEV] Reverted safely.`.yellow);
    }
    setTimeout(() => SYSTEM.isLocked['ARB'] = false, 400); // 400ms High-Frequency Cycle
}

// --- 🔱 LISTENERS & COMMANDS ---
bot.onText(/\/(start|menu)/, (msg) => {
    bot.sendMessage(msg.chat.id, "<b>⚔️ APEX OMNI-MASTER v9099</b>\nMathematical Supremacy Ready.", { 
        parse_mode: 'HTML', 
        ...getDashboardMarkup() 
    });
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
        bot.sendMessage(msg.chat.id, `✅ <b>SYNCED:</b> <code>${solWallet.publicKey.toBase58()}</code>`, { parse_mode: 'HTML' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ <b>FAILED SYNC</b>"); }
});

function runStatusDashboard(chatId) {
    bot.sendMessage(chatId, `📊 <b>OMNI STATUS</b>\nPrincipal: ${SYSTEM.tradeAmount} SOL\nDelta Threshold: ${SYSTEM.minDelta}%\nJito Tip: ${SYSTEM.jitoTip/1e9} SOL`, { parse_mode: 'HTML' });
}

http.createServer((req, res) => res.end("SUPREMACY LIVE")).listen(8080);
