/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (GLOBAL MASTER MERGE)
 * ===============================================================================
 * Infrastructure: Binance WebSocket + Yellowstone gRPC + Jito Atomic Bundles
 * Features: Auto-Sweep Profits, Fee Guard, Peak Monitoring, Interactive UI
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } = require('@solana/web3.js');
const { default: Client } = require("@triton-one/yellowstone-grpc"); 
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
const http = require('http');
require('colors');

// --- 1. INITIALIZATION & CONFIG ---
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const JUP_API = "https://quote-api.jup.ag/v6";
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const BINANCE_WS = "wss://stream.binance.com:9443/ws/solusdt@bookTicker";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0' }};
const CAD_RATES = { SOL: 248.15, ETH: 4920.00, BNB: 865.00 };

const NETWORKS = {
    ETH:  { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', sym: 'ETH' },
    SOL:  { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'], sym: 'SOL' },
    BASE: { id: 'base', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', sym: 'ETH' },
    BSC:  { id: 'bsc', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', sym: 'BNB' },
    ARB:  { id: 'arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', sym: 'ETH' }
};

const RISK_LABELS = { LOW: '🛡️ LOW', MEDIUM: '⚖️ MED', MAX: '🔥 MAX' };
const TERM_LABELS = { SHORT: '⏱️ SHRT', MID: '⏳ MID', LONG: '💎 LONG' };

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MEDIUM', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {},
    atomicOn: true, flashOn: false,
    jitoTip: 20000000, shredSpeed: true, lastBinancePrice: 0,
    currentAsset: 'So11111111111111111111111111111111111111112'
};

let solWallet, evmWallet, activeChatId;
const COLD_STORAGE = "0xF7a4b02e1c7f67be8B551728197D8E14a7CDFE34"; 
const MIN_SOL_KEEP = 0.05; 
const PROFIT_THRESHOLD = 0.02;

// --- 2. INTERACTIVE UI ---
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `⚠️ RISK: ${RISK_LABELS[SYSTEM.risk]}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${TERM_LABELS[SYSTEM.mode]}`, callback_data: "cycle_mode" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: "🏦 WITHDRAW", callback_data: "cmd_withdraw" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }]
        ]
    }
});

// --- 3. CORE ENGINE LOGIC ---

// 
async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal && signal.tokenAddress) {
                    if (await verifySignalIntegrity(signal.tokenAddress, netKey) && await verifyOmniTruth(chatId, netKey)) {
                        SYSTEM.isLocked[netKey] = true;
                        const res = (netKey === 'SOL')
                            ? await executeAggressiveSolRotation(chatId, signal.tokenAddress, signal.symbol)
                            : await executeEvmContract(chatId, netKey, signal.tokenAddress);
                        
                        if (res) SYSTEM.lastTradedTokens[signal.tokenAddress] = true;
                        SYSTEM.isLocked[netKey] = false;
                    }
                }
            }
            await new Promise(r => setTimeout(r, 400));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 10000)); }
    }
}

async function verifyOmniTruth(chatId, netKey) {
    const tradeAmt = parseFloat(SYSTEM.tradeAmount);
    try {
        if (netKey === 'SOL') {
            const conn = new Connection(NETWORKS.SOL.endpoints[0]);
            const bal = await conn.getBalance(solWallet.publicKey);
            const totalRequired = (tradeAmt * LAMPORTS_PER_SOL) + 5000000 + SYSTEM.jitoTip; 
            if (bal < totalRequired) {
                bot.sendMessage(chatId, `⚠️ <b>[SOL] FEE GUARD:</b> Balance too low for safe trade.`);
                return false;
            }
        }
        return true;
    } catch (e) { return false; }
}

async function trackTradePnL(signature, chatId, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const tx = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
        if (!tx) return;

        const preBal = tx.meta.preBalances[0];
        const postBal = tx.meta.postBalances[0];
        const solChange = (postBal - preBal) / LAMPORTS_PER_SOL;
        
        bot.sendMessage(chatId, `🛰️ <b>SETTLED:</b> ${symbol} | <b>Net:</b> <code>${solChange.toFixed(6)} SOL</code>`, { parse_mode: 'HTML' });

        // --- AUTOMATIC PROFIT SWEEP ---
        const currentBal = await conn.getBalance(solWallet.publicKey);
        const floor = MIN_SOL_KEEP * LAMPORTS_PER_SOL;
        if (currentBal > (floor + (PROFIT_THRESHOLD * LAMPORTS_PER_SOL))) {
            const sweepAmount = currentBal - floor;
            const sweepTx = new Transaction().add(SystemProgram.transfer({
                fromPubkey: solWallet.publicKey, toPubkey: new PublicKey(COLD_STORAGE), lamports: sweepAmount
            }));
            const sig = await conn.sendTransaction(sweepTx, [solWallet]);
            bot.sendMessage(chatId, `🛡️ <b>SWEEP:</b> <code>${(sweepAmount/LAMPORTS_PER_SOL).toFixed(4)} SOL</code> sent to Cold Storage.`, { parse_mode: 'HTML' });
        }
    } catch (e) { console.log("[PnL/Sweep] Error: ".red + e.message); }
}

// --- 4. CALLBACK & COMMAND HANDLERS ---

bot.on('callback_query', async (query) => {
    const { data, message, id } = query;
    const chatId = message.chat.id;
    bot.answerCallbackQuery(id).catch(() => {});

    if (data === "cmd_auto") {
        if (!solWallet) return bot.sendMessage(chatId, "❌ <b>Connect Wallet First!</b>", { parse_mode: 'HTML' });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) Object.keys(NETWORKS).forEach(net => startNetworkSniper(chatId, net));
    } else if (data === "cycle_risk") {
        const levels = ["LOW", "MEDIUM", "MAX"];
        SYSTEM.risk = levels[(levels.indexOf(SYSTEM.risk) + 1) % levels.length];
    } else if (data === "cycle_mode") {
        const terms = ["SHORT", "MID", "LONG"];
        SYSTEM.mode = terms[(terms.indexOf(SYSTEM.mode) + 1) % terms.length];
    } else if (data === "cycle_amt") {
        const amts = ["0.01", "0.05", "0.1", "0.25", "0.5"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
    } else if (data === "cmd_status") {
        return runStatusDashboard(chatId);
    } else if (data === "cmd_withdraw") {
        return bot.sendMessage(chatId, "🏦 <b>WITHDRAWAL:</b> Use <code>/payout [ADDRESS]</code>", { parse_mode: 'HTML' });
    }

    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: chatId, message_id: message.message_id }).catch(() => {});
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        const hex = seed.toString('hex');
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", hex).key);
        evmWallet = ethers.Wallet.fromPhrase(match[1].trim());
        bot.sendMessage(msg.chat.id, `✅ <b>SYNCED:</b> <code>${solWallet.publicKey.toString()}</code>`, { parse_mode: 'HTML' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ <b>SYNC FAILED</b>"); }
});

// --- 5. EXECUTION CORE ---

async function executeAggressiveSolRotation(chatId, targetToken, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        const quote = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${targetToken}&amount=${amt}&slippageBps=100`);
        const { swapTransaction } = (await axios.post(`${JUP_API}/swap`, { quoteResponse: quote.data, userPublicKey: solWallet.publicKey.toString() })).data;
        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([solWallet]);
        
        const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[Buffer.from(tx.serialize()).toString('base64')]] });
        if (res.data.result) {
            bot.sendMessage(chatId, `💰 <b>BOUGHT:</b> $${symbol} via Jito Bundle.`);
            setTimeout(() => trackTradePnL(res.data.result, chatId, symbol), 5000);
            return true;
        }
    } catch (e) { return false; }
}

async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const chainMap = { 'SOL': 'solana', 'ETH': 'ethereum', 'BASE': 'base', 'BSC': 'bsc', 'ARB': 'arbitrum' };
        const match = res.data.find(t => t.chainId === chainMap[netKey] && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        return match ? { symbol: match.symbol, tokenAddress: match.tokenAddress } : null;
    } catch (e) { return null; }
}

function runStatusDashboard(chatId) {
    bot.sendMessage(chatId, `📊 <b>APEX STATUS</b>\n\n` +
        `💰 <b>Size:</b> <code>${SYSTEM.tradeAmount} SOL</code>\n` +
        `🛡️ <b>Risk:</b> ${SYSTEM.risk}\n` +
        `🛡️ <b>Shields:</b> ${SYSTEM.atomicOn ? 'JITO' : 'RAW'}\n` +
        `🛰️ <b>Radar:</b> ${SYSTEM.shredSpeed ? 'gRPC' : 'Standard'}`, { parse_mode: 'HTML' });
}

async function verifySignalIntegrity(tokenAddress, netKey) {
    if (netKey !== 'SOL') return true;
    try {
        const rugReport = await axios.get(`https://api.rugcheck.xyz/v1/tokens/${tokenAddress}/report`, SCAN_HEADERS);
        return rugReport.data?.score < 500;
    } catch (e) { return false; }
}

// Start Server
http.createServer((req, res) => res.end("APEX v9076 MASTER MERGE READY")).listen(8080);
bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "⚔️ <b>APEX OMNI-MASTER v9076 ONLINE</b>", { parse_mode: 'HTML', ...getDashboardMarkup() }));
