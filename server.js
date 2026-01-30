/**
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

// --- 🔱 MEV-SHIELD INJECTION ---
const originalSend = Connection.prototype.sendRawTransaction;
Connection.prototype.sendRawTransaction = async function(rawTx, options) {
    try {
        const base64Tx = Buffer.from(rawTx).toString('base64');
        const jitoRes = await axios.post("https://mainnet.block-engine.jito.wtf/api/v1/bundles", {
            jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[base64Tx]]
        });
        if (jitoRes.data.result) return jitoRes.data.result;
    } catch (e) { console.log(`[MEV-SHIELD] Δ Reverted - Principal Protected`.yellow); }
    return null; 
};

// --- 1. CORE INITIALIZATION ---
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// --- 2. GLOBAL STATE ---
let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MAX', mode: 'GLOBAL',
    lastTradedTokens: {}, isLocked: {},
    currentAsset: 'So11111111111111111111111111111111111111112',
    atomicOn: true, flashOn: false,
    jitoTip: 20000000, 
    lastBinancePrice: 0,
    minDelta: 0.45,
    isUpdatingUI: false // THE STICKY BUTTON KILLER
};
let solWallet, evmWallet;

const JUP_API = "https://quote-api.jup.ag/v6";
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";

// --- 3. UI DASHBOARD (REACTIVE & NON-STICKY) ---
const getMenu = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "tg_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cyc_amt" }, { text: "📊 STATUS", callback_data: "cmd_stat" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: SYSTEM.flashOn ? "⚡ FLASH: ON" : "⚡ FLASH: OFF", callback_data: "tg_flash" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }]
        ]
    }
});

bot.on('callback_query', async (q) => {
    // FIX 1: Instant acknowledgement kills the "loading" spinner on the button
    bot.answerCallbackQuery(q.id).catch(() => {});

    // FIX 2: State Lock prevents overlapping UI updates
    if (SYSTEM.isUpdatingUI) return;
    SYSTEM.isUpdatingUI = true;

    try {
        const chatId = q.message.chat.id;
        if (q.data === "tg_auto") {
            if (!solWallet) {
                bot.sendMessage(chatId, "❌ Sync Wallet First!");
            } else {
                SYSTEM.autoPilot = !SYSTEM.autoPilot;
                if (SYSTEM.autoPilot) startRadar(chatId);
            }
        } else if (q.data === "cyc_amt") {
            const amts = ["0.1", "0.5", "1.0", "2.5", "5.0"];
            SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
        } else if (q.data === "tg_atomic") {
            SYSTEM.atomicOn = !SYSTEM.atomicOn;
        } else if (q.data === "cmd_conn") {
            bot.sendMessage(chatId, "🔌 <b>Sync:</b> <code>/connect [mnemonic]</code>", { parse_mode: 'HTML' });
        }

        // FIX 3: Re-render markup only after state change
        await bot.editMessageReplyMarkup(getMenu().reply_markup, { 
            chat_id: chatId, 
            message_id: q.message.message_id 
        }).catch(() => {});

    } finally {
        SYSTEM.isUpdatingUI = false;
    }
});

// --- 4. ARBITRAGE RADAR ---
async function startRadar(chatId) {
    const ws = new WebSocket("wss://stream.binance.com:9443/ws/solusdt@bookTicker");
    ws.on('message', async (data) => {
        const tick = JSON.parse(data);
        SYSTEM.lastBinancePrice = (parseFloat(tick.b) + parseFloat(tick.a)) / 2;
        if (SYSTEM.autoPilot) {
            try {
                const res = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000`);
                const dexPrice = res.data.outAmount / 1e6;
                const delta = ((SYSTEM.lastBinancePrice - dexPrice) / dexPrice) * 100;
                if (delta > SYSTEM.minDelta) executeHFT(chatId, delta);
            } catch (e) {}
        }
    });
}

async function executeHFT(chatId, delta) {
    if (SYSTEM.isLocked['HFT']) return;
    SYSTEM.isLocked['HFT'] = true;
    
    try {
        const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        
        const quote = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=${amt}&slippageBps=150`);
        const { swapTransaction } = (await axios.post(`${JUP_API}/swap`, { 
            quoteResponse: quote.data, 
            userPublicKey: solWallet.publicKey.toString(), 
            prioritizationFeeLamports: "auto" 
        })).data;

        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([solWallet]);

        const res = await axios.post(JITO_ENGINE, { 
            jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[Buffer.from(tx.serialize()).toString('base64')]] 
        });

        if (res.data.result) {
            bot.sendMessage(chatId, `🚀 <b>DELTA CAPTURE:</b> <code>${delta.toFixed(3)}%</code>\nID: <code>${res.data.result.slice(0,8)}...</code>`, { parse_mode: 'HTML' });
        }
    } catch (e) {}
    
    setTimeout(() => SYSTEM.isLocked['HFT'] = false, 500); 
}

// --- 5. SYSTEM COMMANDS ---
bot.onText(/\/(start|menu)/, (msg) => {
    bot.sendMessage(msg.chat.id, "⚔️ <b>APEX SUPREMACY v9118</b>", { parse_mode: 'HTML', ...getMenu() });
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.sendMessage(msg.chat.id, `✅ <b>SYNCED:</b> <code>${solWallet.publicKey.toBase58()}</code>`, { parse_mode: 'HTML' });
        bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ Invalid Mnemonic"); }
});

http.createServer((req, res) => res.end("READY")).listen(8080);
