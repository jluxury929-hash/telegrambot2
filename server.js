/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9116 (STICKY-BUTTON & OMNI-DELTA EDITION)
 * ===============================================================================
 * Infrastructure: Binance WS + Yellowstone gRPC + Jito Atomic Bundles
 * Strategy: Anti-Lag UI + Leader-Synced Delta Capture
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

// --- 🔱 LAYER 2: MEV-SHIELD INJECTION ---
const originalSend = Connection.prototype.sendRawTransaction;
Connection.prototype.sendRawTransaction = async function(rawTx, options) {
    try {
        const base64Tx = Buffer.from(rawTx).toString('base64');
        const jitoRes = await axios.post("https://mainnet.block-engine.jito.wtf/api/v1/bundles", {
            jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[base64Tx]]
        });
        if (jitoRes.data.result) return jitoRes.data.result;
    } catch (e) { console.log(`[MEV-SHIELD] ⚠️ Principal Protected Lane Busy`.yellow); }
    return originalSend.apply(this, [rawTx, options]);
};

// --- 1. CORE INITIALIZATION ---
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// --- 2. GLOBAL STATE & OMNI-CONFIG ---
const JUP_API = "https://quote-api.jup.ag/v6";
const CAD_RATES = { SOL: 248.15, ETH: 4920.00, BNB: 865.00 };
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const BINANCE_WS = "wss://stream.binance.com:9443/ws/solusdt@bookTicker"; 

const NETWORKS = {
    ETH:  { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', sym: 'ETH' },
    SOL:  { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'], sym: 'SOL' }
};

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MAX', mode: 'GLOBAL',
    lastTradedTokens: {}, isLocked: {},
    currentAsset: 'So11111111111111111111111111111111111111112',
    atomicOn: true, flashOn: false,
    jitoTip: 20000000, 
    lastBinancePrice: 0,
    minDelta: 0.45,
    isUpdatingUI: false // FIX: UI State Lock
};
let solWallet, evmWallet, activeChatId;

// --- 🔱 3. FIXED UI HANDLER (NO MORE STICKY BUTTONS) ---

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
    // 1. Mandatory answer to kill the "loading" spinner immediately
    bot.answerCallbackQuery(query.id).catch(() => {});

    // 2. Anti-Sticky Lock: Ignore multiple clicks while UI is processing
    if (SYSTEM.isUpdatingUI) return;
    SYSTEM.isUpdatingUI = true;

    const chatId = query.message.chat.id;
    activeChatId = chatId;

    try {
        if (query.data === "tg_atomic") SYSTEM.atomicOn = !SYSTEM.atomicOn;
        else if (query.data === "tg_flash") SYSTEM.flashOn = !SYSTEM.flashOn;
        else if (query.data === "cycle_amt") {
            const amts = ["0.01", "0.05", "0.1", "0.25", "0.5", "1.0"];
            SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
        } else if (query.data === "cmd_auto") {
            if (!solWallet) {
                bot.sendMessage(chatId, "❌ <b>WALLET NOT SYNCED</b>", { parse_mode: 'HTML' });
            } else {
                SYSTEM.autoPilot = !SYSTEM.autoPilot;
                if (SYSTEM.autoPilot) Object.keys(NETWORKS).forEach(net => startNetworkSniper(chatId, net));
            }
        } else if (query.data === "cmd_status") runStatusDashboard(chatId);
        else if (query.data === "cmd_conn") bot.sendMessage(chatId, "🔌 <b>Sync:</b> <code>/connect [mnemonic]</code>", { parse_mode: 'HTML' });

        // 3. Update the menu buttons to reflect new state
        await bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { 
            chat_id: chatId, 
            message_id: query.message.message_id 
        }).catch(() => {});
        
    } finally {
        // 4. Release lock after processing completes
        SYSTEM.isUpdatingUI = false;
    }
});

// --- 🔱 4. INTEGRATED EXECUTION LOGIC ---

async function startGlobalUltimatum(chatId) {
    const ws = new WebSocket(BINANCE_WS);
    ws.on('message', async (data) => {
        const tick = JSON.parse(data);
        SYSTEM.lastBinancePrice = (parseFloat(tick.b) + parseFloat(tick.a)) / 2;
        if (SYSTEM.autoPilot) await checkGlobalArb(chatId);
    });
}

async function checkGlobalArb(chatId) {
    if (SYSTEM.isLocked['HFT']) return;
    try {
        const res = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000`);
        const delta = ((SYSTEM.lastBinancePrice - (res.data.outAmount / 1e6)) / (res.data.outAmount / 1e6)) * 100;
        
        if (delta > SYSTEM.minDelta) {
            SYSTEM.isLocked['HFT'] = true;
            await executeAggressiveSolRotation(chatId, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "GLOBAL-ARB");
            setTimeout(() => SYSTEM.isLocked['HFT'] = false, 400); // 400ms HFT cooldown
        }
    } catch (e) {}
}

async function executeAggressiveSolRotation(chatId, targetToken, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        const quote = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${targetToken}&amount=${amt}&slippageBps=150`);
        const { swapTransaction } = (await axios.post(`${JUP_API}/swap`, { quoteResponse: quote.data, userPublicKey: solWallet.publicKey.toString(), prioritizationFeeLamports: "auto" })).data;
        
        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([solWallet]);
        
        const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[Buffer.from(tx.serialize()).toString('base64')]] });
        if (res.data.result) {
            bot.sendMessage(chatId, `💰 <b>SUCCESS:</b> ${symbol} Captured`, { parse_mode: 'HTML' });
            return true;
        }
    } catch (e) { console.log(`[EXEC] Rotation Failed`.red); }
    return false;
}

// --- 5. INITIALIZATION & COMMANDS ---

bot.onText(/\/(start|menu)/, (msg) => {
    startGlobalUltimatum(msg.chat.id);
    bot.sendMessage(msg.chat.id, "<b>⚔️ APEX OMNI-MASTER v9116</b>\nSticky Button Fix Applied.", { parse_mode: 'HTML', ...getDashboardMarkup() });
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        evmWallet = ethers.Wallet.fromPhrase(match[1].trim());
        bot.sendMessage(msg.chat.id, `✅ <b>SYNCED:</b> <code>${solWallet.publicKey.toBase58()}</code>`, { parse_mode: 'HTML' });
        bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ <b>FAILED</b>"); }
});

http.createServer((req, res) => res.end("v9116 READY")).listen(8080);
