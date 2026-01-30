/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (GLOBAL ULTIMATUM HYBRID)
 * ===============================================================================
 * Infrastructure: Binance WS + Yellowstone gRPC + Jito Atomic Bundles
 * Execution: HFT Delta Capture & Multi-Chain Signal Sniping
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
        if (jitoRes.data.result) {
            console.log(`[MEV-SHIELD] ✅ Bundle Accepted: ${jitoRes.data.result.slice(0,10)}...`.green);
            return jitoRes.data.result;
        }
    } catch (e) { console.log(`[MEV-SHIELD] ⚠️ Jito busy, principal protected.`.yellow); }
    return SYSTEM.atomicOn ? null : originalSend.apply(this, [rawTx, options]);
};

// --- 1. CORE INITIALIZATION ---
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const JUP_API = "https://quote-api.jup.ag/v6";
const BINANCE_WS = "wss://stream.binance.com:9443/ws/solusdt@bookTicker";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0' }};
const CAD_RATES = { SOL: 248.15, ETH: 4920.00, BNB: 865.00 };

// --- 2. GLOBAL STATE ---
let SYSTEM = {
    autoPilot: false,
    tradeAmount: "0.1",
    risk: 'MAX',
    mode: 'GLOBAL', // HFT + SNIPE
    jitoTip: 20000000,
    slippageBps: 150,
    minDelta: 0.45,
    lastBinancePrice: 0,
    isLocked: {},
    currentAsset: 'So11111111111111111111111111111111111111112',
    atomicOn: true,
    flashOn: false,
    lastTradedTokens: {},
    cycleReset: 400
};

const NETWORKS = {
    SOL:  { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'], sym: 'SOL' },
    ETH:  { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', sym: 'ETH' },
    BASE: { id: 'base', rpc: 'https://mainnet.base.org', sym: 'ETH' },
    BSC:  { id: 'bsc', rpc: 'https://bsc-dataseed.binance.org/', sym: 'BNB' }
};

let solWallet, evmWallet;

// --- 3. UI ENGINE ---
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: `⚠️ RISK: ${SYSTEM.risk}`, callback_data: "cycle_risk" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }],
            [{ text: "🚨 PANIC SELL ALL", callback_data: "cmd_panic" }]
        ]
    }
});

// --- 4. EXECUTION LOGIC ---

async function trackTradePnL(signature, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const tx = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
        if (!tx) return;
        const solChange = (tx.meta.postBalances[0] - tx.meta.preBalances[0]) / LAMPORTS_PER_SOL;
        console.log(`[PnL] ${symbol} settled: ${solChange.toFixed(6)} SOL`.magenta);
    } catch (e) {}
}

async function startHybridRadar(chatId) {
    const ws = new WebSocket(BINANCE_WS);
    ws.on('message', async (data) => {
        const tick = JSON.parse(data);
        SYSTEM.lastBinancePrice = (parseFloat(tick.b) + parseFloat(tick.a)) / 2;
        
        if (SYSTEM.autoPilot && !SYSTEM.isLocked['SOL']) {
            // Task 1: HFT Delta Capture
            checkHFT(chatId);
            // Task 2: Signal Snipping (DexScreener)
            checkSignals(chatId);
        }
    });

    // Optional gRPC Stream
    if (process.env.GRPC_ENDPOINT) {
        const client = new Client(process.env.GRPC_ENDPOINT, process.env.X_TOKEN);
        const stream = await client.subscribe();
        stream.on("data", (data) => { if(SYSTEM.autoPilot) checkHFT(chatId); });
    }
}

async function checkHFT(chatId) {
    try {
        const res = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000`);
        const dexPrice = res.data.outAmount / 1e6;
        const delta = ((SYSTEM.lastBinancePrice - dexPrice) / dexPrice) * 100;

        if (Math.abs(delta) > SYSTEM.minDelta) {
            executeSolTrade(chatId, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", `HFT-ARB-${delta.toFixed(2)}%`);
        }
    } catch (e) {}
}

async function checkSignals(chatId) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const signal = res.data.find(t => t.chainId === 'solana' && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        if (signal) {
            SYSTEM.lastTradedTokens[signal.tokenAddress] = true;
            executeSolTrade(chatId, signal.tokenAddress, signal.symbol);
        }
    } catch (e) {}
}

async function executeSolTrade(chatId, targetToken, symbol) {
    if (SYSTEM.isLocked['SOL']) return;
    SYSTEM.isLocked['SOL'] = true;
    
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        
        const quote = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${targetToken}&amount=${amt}&slippageBps=${SYSTEM.slippageBps}`);
        const { swapTransaction } = (await axios.post(`${JUP_API}/swap`, { 
            quoteResponse: quote.data, 
            userPublicKey: solWallet.publicKey.toString(),
            prioritizationFeeLamports: "auto"
        })).data;

        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([solWallet]);

        const sig = await conn.sendRawTransaction(tx.serialize());
        if (sig) {
            bot.sendMessage(chatId, `🚀 <b>TRADE SENT:</b> ${symbol}\n<code>${sig.slice(0,16)}...</code>`, { parse_mode: 'HTML' });
            setTimeout(() => trackTradePnL(sig, symbol), 5000);
        }
    } catch (e) { console.log(`[EXEC] Error: ${e.message}`.red); }
    
    setTimeout(() => { SYSTEM.isLocked['SOL'] = false; }, SYSTEM.cycleReset);
}

// --- 5. BOT ROUTING ---

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data === "cmd_auto") {
        if (!solWallet) return bot.answerCallbackQuery(query.id, { text: "Connect Wallet First!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) startHybridRadar(chatId);
    } else if (data === "cycle_amt") {
        const amts = ["0.1", "0.5", "1.0", "2.0"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
    } else if (data === "tg_atomic") {
        SYSTEM.atomicOn = !SYSTEM.atomicOn;
    } else if (data === "cmd_status") {
        runStatusDashboard(chatId);
    }

    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, {
        chat_id: chatId, message_id: query.message.message_id
    }).catch(() => {});
    bot.answerCallbackQuery(query.id);
});

bot.onText(/\/(start|menu)/, (msg) => {
    bot.sendMessage(msg.chat.id, "⚔️ <b>APEX SUPREMACY v9076</b>\nHybrid HFT & Signal Engine Active.", { 
        parse_mode: 'HTML', 
        ...getDashboardMarkup() 
    });
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        const hex = seed.toString('hex');
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", hex).key);
        evmWallet = ethers.Wallet.fromPhrase(match[1].trim());
        bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
        bot.sendMessage(msg.chat.id, `✅ <b>SYNCED:</b> <code>${solWallet.publicKey.toBase58()}</code>`, { parse_mode: 'HTML' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ Invalid Mnemonic"); }
});

function runStatusDashboard(chatId) {
    bot.sendMessage(chatId, 
        `📊 <b>SYSTEM STATUS</b>\n\n` +
        `🛰️ <b>Global Price:</b> $${SYSTEM.lastBinancePrice}\n` +
        `💰 <b>Trade Size:</b> ${SYSTEM.tradeAmount} SOL\n` +
        `🛡️ <b>Mev-Shield:</b> ${SYSTEM.atomicOn ? 'ON (JITO)' : 'OFF'}\n` +
        `⚡ <b>Auto-Pilot:</b> ${SYSTEM.autoPilot ? 'RUNNING' : 'STOPPED'}`, 
    { parse_mode: 'HTML' });
}

// Keep-alive server
http.createServer((req, res) => res.end("APEX READY")).listen(8080);
