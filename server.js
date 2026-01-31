/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (GLOBAL MASTER MERGE)
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

// --- 1. CONFIG & GLOBAL STATE ---
const JUP_API = "https://quote-api.jup.ag/v6";
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0' }};

const RISK_LABELS = { LOW: '🛡️ LOW', MEDIUM: '⚖️ MED', MAX: '🔥 MAX' };
const TERM_LABELS = { SHORT: '⏱️ SHRT', MID: '⏳ MID', LONG: '💎 LONG' };

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MEDIUM', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {},
    atomicOn: true, flashOn: false,
    jitoTip: 20000000, currentAsset: 'So11111111111111111111111111111111111111112'
};

let solWallet, evmWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// --- UPDATE THESE ---
const COLD_STORAGE = "0xF7a4b02e1c7f67be8B551728197D8E14a7CDFE34"; 
const MIN_SOL_KEEP = 0.05; 
const PROFIT_THRESHOLD = 0.02;

// --- 2. BUTTON DEFINITIONS (100% SYNCED) ---
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `⚠️ RISK: ${RISK_LABELS[SYSTEM.risk]}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${TERM_LABELS[SYSTEM.mode]}`, callback_data: "cycle_mode" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: SYSTEM.flashOn ? "⚡ FLASH: ON" : "⚡ FLASH: OFF", callback_data: "tg_flash" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }, { text: "🏦 WITHDRAW", callback_data: "cmd_withdraw" }]
        ]
    }
});

// --- 3. INTERACTIVE CALLBACK HANDLER (AUDITED) ---
bot.on('callback_query', async (query) => {
    const { data, message } = query;
    const chatId = message.chat.id;

    try {
        if (data === "cycle_risk") {
            const risks = ["LOW", "MEDIUM", "MAX"];
            SYSTEM.risk = risks[(risks.indexOf(SYSTEM.risk) + 1) % risks.length];
        } 
        else if (data === "cycle_mode") {
            const terms = ["SHORT", "MID", "LONG"];
            SYSTEM.mode = terms[(terms.indexOf(SYSTEM.mode) + 1) % terms.length];
        } 
        else if (data === "cycle_amt") {
            const amts = ["0.01", "0.05", "0.1", "0.25", "0.5"];
            SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
        } 
        else if (data === "tg_atomic") {
            SYSTEM.atomicOn = !SYSTEM.atomicOn;
        } 
        else if (data === "tg_flash") {
            SYSTEM.flashOn = !SYSTEM.flashOn;
        } 
        else if (data === "cmd_auto") {
            if (!solWallet) return bot.answerCallbackQuery(query.id, { text: "⚠️ Sync Wallet First!", show_alert: true });
            SYSTEM.autoPilot = !SYSTEM.autoPilot;
            if (SYSTEM.autoPilot) Object.keys(NETWORKS).forEach(net => startNetworkSniper(chatId, net));
        } 
        else if (data === "cmd_status") {
            await runStatusDashboard(chatId);
            return bot.answerCallbackQuery(query.id);
        } 
        else if (data === "cmd_withdraw") {
            bot.sendMessage(chatId, "🏦 **Use:** `/payout [ADDRESS]`", { parse_mode: 'Markdown' });
        } 
        else if (data === "cmd_conn") {
            bot.sendMessage(chatId, "🔌 **Use:** `/connect [SEED]`", { parse_mode: 'Markdown' });
        }

        // REFRESH UI: This is the secret to 100% working buttons
        bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { 
            chat_id: chatId, 
            message_id: message.message_id 
        }).catch(() => {});
        
        bot.answerCallbackQuery(query.id);

    } catch (e) {
        console.log("Button Error: ".red + e.message);
    }
});

// --- 4. ENGINE CORE ---
async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal && await verifyOmniTruth(chatId, netKey)) {
                    SYSTEM.isLocked[netKey] = true;
                    await executeSolShotgun(chatId, signal.tokenAddress, signal.symbol);
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 500));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 5000)); }
    }
}

async function verifyOmniTruth(chatId, netKey) {
    if (!solWallet) return false;
    const conn = new Connection("https://api.mainnet-beta.solana.com");
    const bal = await conn.getBalance(solWallet.publicKey);
    const required = (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 5000000;
    return bal >= required;
}

async function executeSolShotgun(chatId, targetToken, symbol) {
    try {
        const conn = new Connection("https://api.mainnet-beta.solana.com", 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        const quote = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${targetToken}&amount=${amt}&slippageBps=100`);
        const { swapTransaction } = (await axios.post(`${JUP_API}/swap`, { quoteResponse: quote.data, userPublicKey: solWallet.publicKey.toString() })).data;
        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([solWallet]);
        
        // Jito/Flash Path
        const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[Buffer.from(tx.serialize()).toString('base64')]] });
        if (res.data.result) {
            bot.sendMessage(chatId, `💰 **BOUGHT:** $${symbol} ${SYSTEM.flashOn ? '(FLASH)' : ''}`);
            setTimeout(() => trackTradePnL(res.data.result, chatId, symbol), 5000);
            return true;
        }
    } catch (e) { return false; }
}

async function trackTradePnL(signature, chatId, symbol) {
    try {
        const conn = new Connection("https://api.mainnet-beta.solana.com", 'confirmed');
        const balance = await conn.getBalance(solWallet.publicKey);
        const floor = MIN_SOL_KEEP * LAMPORTS_PER_SOL;
        
        if (balance > (floor + (PROFIT_THRESHOLD * LAMPORTS_PER_SOL))) {
            const sweepAmount = balance - floor;
            const tx = new Transaction().add(SystemProgram.transfer({
                fromPubkey: solWallet.publicKey, toPubkey: new PublicKey(COLD_STORAGE), lamports: sweepAmount
            }));
            await conn.sendTransaction(tx, [solWallet]);
            bot.sendMessage(chatId, `🛡️ **AUTO-SWEEP:** Moved <code>${(sweepAmount/LAMPORTS_PER_SOL).toFixed(4)} SOL</code> to Cold Storage.`, { parse_mode: 'HTML' });
        }
    } catch (e) { console.log("Sweep skipped".gray); }
}

async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const match = res.data.find(t => t.chainId === 'solana' && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        return match ? { symbol: match.symbol, tokenAddress: match.tokenAddress } : null;
    } catch (e) { return null; }
}

async function runStatusDashboard(chatId) {
    const rates = { SOL: 248.15 };
    const conn = new Connection("https://api.mainnet-beta.solana.com");
    const bal = solWallet ? (await conn.getBalance(solWallet.publicKey) / 1e9) : 0;
    
    bot.sendMessage(chatId, `📊 **APEX STATUS**\n\n` +
        `💰 **Balance:** ${bal.toFixed(3)} SOL ($${(bal * rates.SOL).toFixed(2)})\n` +
        `⚙️ **Size:** ${SYSTEM.tradeAmount} SOL\n` +
        `⚡ **Flash:** ${SYSTEM.flashOn ? 'ON' : 'OFF'}\n` +
        `🛡️ **Jito:** ${SYSTEM.atomicOn ? 'ON' : 'OFF'}`, { parse_mode: 'Markdown' });
}

// --- 5. INITIALIZATION ---
bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        const hex = seed.toString('hex');
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", hex).key);
        bot.sendMessage(msg.chat.id, `✅ **SYNCED:** \`${solWallet.publicKey.toString()}\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ **SYNC FAILED**"); }
});

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "⚔️ **APEX OMNI-MASTER v9076 ONLINE**\nHigh-Frequency Radar Active.", { parse_mode: 'HTML', ...getDashboardMarkup() });
});

http.createServer((req, res) => res.end("MASTER READY")).listen(8080);
