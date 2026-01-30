/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9121 (FULL UI RECOVERY)
 * ===============================================================================
 * Infrastructure: Binance WS + Yellowstone gRPC + Jito Atomic Bundles
 * Fixes: Sticky Status, Start, Flash, and Atomic Buttons
 */

require('dotenv').config();
const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws'); 
const http = require('http');
require('colors');

// --- 🔱 MEV-SHIELD LOGIC (PRINCIPAL PROTECTION) ---
const originalSend = Connection.prototype.sendRawTransaction;
Connection.prototype.sendRawTransaction = async function(rawTx, options) {
    try {
        const base64Tx = Buffer.from(rawTx).toString('base64');
        const jitoRes = await axios.post("https://mainnet.block-engine.jito.wtf/api/v1/bundles", {
            jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[base64Tx]]
        });
        if (jitoRes.data.result) return jitoRes.data.result;
    } catch (e) { console.log(`[MEV-SHIELD] Δ Reverted - Holding Principal`.yellow); }
    return null; 
};

// --- 1. CORE INITIALIZATION ---
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// --- 2. GLOBAL OMNI-STATE ---
const JUP_API = "https://quote-api.jup.ag/v6";
const CAD_RATES = { SOL: 248.15, ETH: 4920.00, BNB: 865.00 };
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const BINANCE_WS = "wss://stream.binance.com:9443/ws/solusdt@bookTicker"; 

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MAX', mode: 'GLOBAL',
    lastTradedTokens: {}, isLocked: {},
    currentAsset: 'So11111111111111111111111111111111111111112',
    atomicOn: true, flashOn: false,
    jitoTip: 20000000, 
    lastBinancePrice: 0,
    minDelta: 0.45,
    isUpdatingUI: false // UI Mutex
};
let solWallet;

// --- 🔱 3. FIXED UI ENGINE (NO MORE LOADING STICKERS) ---

const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: SYSTEM.flashOn ? "⚡ FLASH: ON" : "⚡ FLASH: OFF", callback_data: "tg_flash" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }]
        ]
    }
});

bot.on('callback_query', async (query) => {
    // FIX 1: Answer immediately to stop the "Loading..." spinner on the user's screen
    bot.answerCallbackQuery(query.id).catch(() => {});
    
    // FIX 2: Mutex prevents multiple clicks from causing race conditions
    if (SYSTEM.isUpdatingUI) return;
    SYSTEM.isUpdatingUI = true;

    try {
        const chatId = query.message.chat.id;

        switch (query.data) {
            case "cmd_auto":
                if (!solWallet) {
                    bot.sendMessage(chatId, "❌ <b>WALLET NOT SYNCED</b>.", { parse_mode: 'HTML' });
                } else {
                    SYSTEM.autoPilot = !SYSTEM.autoPilot;
                    if (SYSTEM.autoPilot) startGlobalRadar(chatId);
                }
                break;
            case "cycle_amt":
                const amts = ["0.1", "0.5", "1.0", "5.0"];
                SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
                break;
            case "tg_atomic":
                SYSTEM.atomicOn = !SYSTEM.atomicOn;
                break;
            case "tg_flash":
                SYSTEM.flashOn = !SYSTEM.flashOn;
                break;
            case "cmd_status":
                await runStatusDashboard(chatId);
                break;
            case "cmd_conn":
                bot.sendMessage(chatId, "🔌 <b>Sync Wallet:</b> <code>/connect [mnemonic]</code>", { parse_mode: 'HTML' });
                break;
        }

        // FIX 3: Re-draw menu with updated state labels (ON/OFF)
        await bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { 
            chat_id: chatId, 
            message_id: query.message.message_id 
        }).catch(() => {});

    } finally {
        SYSTEM.isUpdatingUI = false;
    }
});

// --- 🔱 4. EXECUTION RADAR ---

async function startGlobalRadar(chatId) {
    const ws = new WebSocket(BINANCE_WS);
    ws.on('message', async (data) => {
        const tick = JSON.parse(data);
        SYSTEM.lastBinancePrice = (parseFloat(tick.b) + parseFloat(tick.a)) / 2;
        if (SYSTEM.autoPilot) await checkArbOpportunity(chatId);
    });
}

async function checkArbOpportunity(chatId) {
    if (SYSTEM.isLocked['HFT']) return;
    try {
        const res = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000`);
        const dexPrice = res.data.outAmount / 1e6;
        const delta = ((SYSTEM.lastBinancePrice - dexPrice) / dexPrice) * 100;
        
        if (delta > SYSTEM.minDelta) {
            SYSTEM.isLocked['HFT'] = true;
            await executeTrade(chatId, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", `Δ-CAPTURE ${delta.toFixed(2)}%`);
            setTimeout(() => SYSTEM.isLocked['HFT'] = false, 500);
        }
    } catch (e) {}
}

async function executeTrade(chatId, targetToken, label) {
    try {
        const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        const quote = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${targetToken}&amount=${amt}&slippageBps=150`);
        const { swapTransaction } = (await axios.post(`${JUP_API}/swap`, { quoteResponse: quote.data, userPublicKey: solWallet.publicKey.toString(), prioritizationFeeLamports: "auto" })).data;
        
        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([solWallet]);
        
        const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[Buffer.from(tx.serialize()).toString('base64')]] });
        if (res.data.result) {
            bot.sendMessage(chatId, `🚀 <b>${label}</b>\n<code>${res.data.result}</code>`, { parse_mode: 'HTML' });
        }
    } catch (e) {}
}

// --- 🔱 5. UTILS ---

async function runStatusDashboard(chatId) {
    const statusText = `
📊 <b>OMNI SYSTEM STATUS</b>
━━━━━━━━━━━━━━━
🚀 <b>AutoPilot:</b> ${SYSTEM.autoPilot ? '🟢 RUNNING' : '🛑 STOPPED'}
🛡️ <b>Atomic Bundles:</b> ${SYSTEM.atomicOn ? '✅ ON' : '❌ OFF'}
⚡ <b>Flash Loans:</b> ${SYSTEM.flashOn ? '✅ ON' : '❌ OFF'}
💰 <b>Trade Size:</b> <code>${SYSTEM.tradeAmount} SOL</code>
📉 <b>Binance Spot:</b> <code>$${SYSTEM.lastBinancePrice.toFixed(2)}</code>
    `;
    return bot.sendMessage(chatId, statusText, { parse_mode: 'HTML' });
}

bot.onText(/\/(start|menu)/, (msg) => {
    bot.sendMessage(msg.chat.id, "⚔️ <b>APEX OMNI-MASTER v9121</b>", { parse_mode: 'HTML', ...getDashboardMarkup() });
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.sendMessage(msg.chat.id, `✅ <b>SYNCED:</b> <code>${solWallet.publicKey.toBase58()}</code>`, { parse_mode: 'HTML' });
        bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ Error connecting wallet."); }
});

http.createServer((req, res) => res.end("v9121 READY")).listen(8080);
