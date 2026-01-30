/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9077 (GLOBAL ULTIMATUM EDITION)
 * ===============================================================================
 * Infrastructure: Binance WebSocket + Yellowstone gRPC + Jito Atomic Bundles
 * Strategy: Dynamic Risk Scaling & Term-Based Execution
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
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
    } catch (e) { /* Fallback to standard if Jito is congested */ }
    return originalSend.apply(this, [rawTx, options]);
};

// --- 1. GLOBAL STATE & CONFIG ---
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const JUP_API = "https://quote-api.jup.ag/v6";
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const BINANCE_WS = "wss://stream.binance.com:9443/ws/solusdt@bookTicker"; 
const CAD_RATES = { SOL: 248.15, ETH: 4920.00, BNB: 865.00 };

const NETWORKS = {
    SOL: { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'], sym: 'SOL' },
    ETH: { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', sym: 'ETH' },
    BASE: { id: 'base', rpc: 'https://mainnet.base.org', sym: 'ETH' }
};

let SYSTEM = {
    autoPilot: false,
    tradeAmount: "0.1",
    risk: 'MED',   // LOW, MED, HIGH, MAX
    term: 'SCALP', // SCALP (Fast), SWING (Hold), BULL (Agressive)
    atomicOn: true,
    flashOn: false,
    jitoTip: 2000000, // Default 0.002 SOL
    lastBinancePrice: 0,
    isLocked: {},
    lastTradedTokens: {}
};

let solWallet, evmWallet, activeChatId;

// --- 2. FIXED WITHDRAWAL ENGINE ---
async function executeSweep(chatId, destAddr) {
    if (!solWallet) return bot.sendMessage(chatId, "❌ <b>Connect Wallet First</b>", { parse_mode: 'HTML' });
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const balance = await conn.getBalance(solWallet.publicKey);
        const reserve = 5000 + (SYSTEM.atomicOn ? SYSTEM.jitoTip : 0);
        const amount = balance - reserve;

        if (amount <= 0) throw new Error("Insufficient SOL for gas.");

        const tx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: solWallet.publicKey,
                toPubkey: new PublicKey(destAddr),
                lamports: amount,
            })
        );
        const sig = await sendAndConfirmTransaction(conn, tx, [solWallet]);
        bot.sendMessage(chatId, `🏦 <b>SWEEP COMPLETE</b>\nSent: <code>${(amount/1e9).toFixed(4)} SOL</code>\nSig: <a href="https://solscan.io/tx/${sig}">Solscan</a>`, { parse_mode: 'HTML' });
    } catch (e) { bot.sendMessage(chatId, `❌ <b>ERROR:</b> ${e.message}`, { parse_mode: 'HTML' }); }
}

// --- 3. UI & DASHBOARD ---
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `⚠️ RISK: ${SYSTEM.risk}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${SYSTEM.term}`, callback_data: "cycle_term" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: "🏦 WITHDRAW", callback_data: "cmd_withdraw_prompt" }],
            [{ text: "🔌 CONNECT", callback_data: "cmd_conn" }]
        ]
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data === "cycle_risk") {
        const levels = ['LOW', 'MED', 'HIGH', 'MAX'];
        SYSTEM.risk = levels[(levels.indexOf(SYSTEM.risk) + 1) % levels.length];
        // Dynamic Jito tip adjustment based on risk
        SYSTEM.jitoTip = (levels.indexOf(SYSTEM.risk) + 1) * 1000000;
    } 
    else if (data === "cycle_term") {
        const terms = ['SCALP', 'SWING', 'BULL'];
        SYSTEM.term = terms[(terms.indexOf(SYSTEM.term) + 1) % terms.length];
    }
    else if (data === "cycle_amt") {
        const amts = ["0.1", "0.5", "1.0", "5.0"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
    }
    else if (data === "cmd_withdraw_prompt") {
        bot.sendMessage(chatId, "🏦 <b>Withdrawal:</b> Paste <code>/withdraw [ADDRESS]</code> to sweep your balance.", { parse_mode: 'HTML' });
    }
    else if (data === "cmd_auto") {
        if (!solWallet) return bot.answerCallbackQuery(query.id, { text: "Connect Wallet First!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) startGlobalRadar(chatId);
    }
    else if (data === "tg_atomic") SYSTEM.atomicOn = !SYSTEM.atomicOn;
    else if (data === "cmd_status") runStatusDashboard(chatId);

    bot.answerCallbackQuery(query.id).catch(() => {});
    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
});

// --- 4. RADAR & EXECUTION ---
async function startGlobalRadar(chatId) {
    // 1. Binance WS Delta Stream
    const ws = new WebSocket(BINANCE_WS);
    ws.on('message', (data) => {
        const tick = JSON.parse(data);
        SYSTEM.lastBinancePrice = (parseFloat(tick.b) + parseFloat(tick.a)) / 2;
    });

    // 2. Yellowstone gRPC Stream (If Configured)
    if (process.env.GRPC_ENDPOINT) {
        try {
            const client = new Client(process.env.GRPC_ENDPOINT, process.env.X_TOKEN);
            const stream = await client.subscribe();
            stream.on("data", async (data) => {
                if (data.transaction && SYSTEM.autoPilot) executeArb(chatId, "USDC_MINT", "FAST-GRPC");
            });
        } catch (e) { console.log("[GRPC] Offline".red); }
    }
}

// --- 5. COMMANDS ---
bot.onText(/\/withdraw (.+)/, (msg, match) => executeSweep(msg.chat.id, match[1].trim()));
bot.onText(/\/(start|menu)/, (msg) => bot.sendMessage(msg.chat.id, "<b>⚔️ APEX OMNI-MASTER v9077</b>", { parse_mode: 'HTML', ...getDashboardMarkup() }));
bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
        bot.sendMessage(msg.chat.id, `✅ <b>SYNCED:</b> <code>${solWallet.publicKey.toBase58()}</code>`, { parse_mode: 'HTML' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ <b>INVALID SEED</b>"); }
});

function runStatusDashboard(chatId) {
    bot.sendMessage(chatId, 
        `📊 <b>LIVE STATUS</b>\n` +
        `━━━━━━━━━━━━━━━\n` +
        `⚠️ <b>Risk:</b> ${SYSTEM.risk}\n` +
        `⏳ <b>Term:</b> ${SYSTEM.term}\n` +
        `💰 <b>Size:</b> ${SYSTEM.tradeAmount} SOL\n` +
        `🛡️ <b>Atomic:</b> ${SYSTEM.atomicOn ? 'ON' : 'OFF'}\n` +
        `🔌 <b>Price:</b> $${SYSTEM.lastBinancePrice.toFixed(2)}`, 
        { parse_mode: 'HTML' });
}

http.createServer((req, res) => res.end("V9077 ACTIVE")).listen(8080);
