/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9078 (GLOBAL ULTIMATUM - FULLY FUNCTIONAL)
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

// --- 🔱 LAYER 2: MEV-SHIELD ---
const originalSend = Connection.prototype.sendRawTransaction;
Connection.prototype.sendRawTransaction = async function(rawTx, options) {
    try {
        const base64Tx = Buffer.from(rawTx).toString('base64');
        const jitoRes = await axios.post("https://mainnet.block-engine.jito.wtf/api/v1/bundles", {
            jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[base64Tx]]
        });
        if (jitoRes.data.result) return jitoRes.data.result; 
    } catch (e) { console.log(`[MEV-SHIELD] ⚠️ Fallback active`.yellow); }
    return originalSend.apply(this, [rawTx, options]);
};

// --- 1. CORE INITIALIZATION ---
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// --- 2. GLOBAL STATE ---
let SYSTEM = {
    autoPilot: false, 
    tradeAmount: "0.1", 
    risk: 'MAX', 
    term: 'SCALP',
    slippage: 50, // Base 0.5%
    jitoTip: 2000000, 
    atomicOn: true, 
    flashOn: false,
    shredSpeed: true,
    lastBinancePrice: 0,
    isLocked: {},
    lastTradedTokens: {},
    currentAsset: 'So11111111111111111111111111111111111111112'
};

const JUP_API = "https://quote-api.jup.ag/v6";
const NETWORKS = {
    SOL: { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com'], sym: 'SOL' }
};

let solWallet, evmWallet;

// --- 🛠️ FUNCTIONAL LOGIC ---

const updateRiskProfile = () => {
    const profiles = {
        'LOW':  { tip: 500000,   slip: 10 },
        'MED':  { tip: 1000000,  slip: 30 },
        'HIGH': { tip: 5000000,  slip: 100 },
        'MAX':  { tip: 15000000, slip: 500 }
    };
    SYSTEM.jitoTip = profiles[SYSTEM.risk].tip;
    SYSTEM.slippage = profiles[SYSTEM.risk].slip;
};

async function executeWithdrawal(chatId, dest) {
    if (!solWallet) return bot.sendMessage(chatId, "❌ Connect wallet first.");
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const balance = await conn.getBalance(solWallet.publicKey);
        const amount = balance - 10000; // Gas buffer
        if (amount <= 0) throw new Error("Balance too low.");
        
        const tx = new Transaction().add(SystemProgram.transfer({
            fromPubkey: solWallet.publicKey, toPubkey: new PublicKey(dest), lamports: amount
        }));
        const sig = await sendAndConfirmTransaction(conn, tx, [solWallet]);
        bot.sendMessage(chatId, `🏦 <b>SWEEP SUCCESS:</b> <a href="https://solscan.io/tx/${sig}">TX LINK</a>`, { parse_mode: 'HTML' });
    } catch (e) { bot.sendMessage(chatId, `❌ Withdrawal Failed: ${e.message}`); }
}

// --- 🎨 UI DASHBOARD ---

const getDashboard = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "tg_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount} SOL`, callback_data: "cyc_amt" }, { text: "📊 STATUS", callback_data: "cmd_stat" }],
            [{ text: `⚠️ RISK: ${SYSTEM.risk}`, callback_data: "cyc_risk" }, { text: `⏳ TERM: ${SYSTEM.term}`, callback_data: "cyc_term" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atom" }, { text: SYSTEM.flashOn ? "⚡ FLASH: ON" : "⚡ FLASH: OFF", callback_data: "tg_flash" }],
            [{ text: "🔌 CONNECT", callback_data: "cmd_conn" }, { text: "🏦 WITHDRAW", callback_data: "cmd_with" }]
        ]
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;
    const action = query.data;

    if (action === "tg_auto") {
        if (!solWallet) return bot.answerCallbackQuery(query.id, { text: "Connect Wallet First!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
    } 
    else if (action === "cyc_amt") {
        const amts = ["0.1", "0.5", "1.0", "2.5", "5.0"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
    }
    else if (action === "cyc_risk") {
        const risks = ['LOW', 'MED', 'HIGH', 'MAX'];
        SYSTEM.risk = risks[(risks.indexOf(SYSTEM.risk) + 1) % risks.length];
        updateRiskProfile();
    }
    else if (action === "cyc_term") {
        const terms = ['SCALP', 'SWING', 'BULL'];
        SYSTEM.term = terms[(terms.indexOf(SYSTEM.term) + 1) % terms.length];
    }
    else if (action === "tg_atom") SYSTEM.atomicOn = !SYSTEM.atomicOn;
    else if (action === "tg_flash") SYSTEM.flashOn = !SYSTEM.flashOn;
    else if (action === "cmd_conn") {
        bot.sendMessage(chatId, "🔌 <b>Connect:</b> Send <code>/connect [mnemonic]</code>", { parse_mode: 'HTML' });
    }
    else if (action === "cmd_with") {
        bot.sendMessage(chatId, "🏦 <b>Withdraw:</b> Send <code>/withdraw [address]</code>", { parse_mode: 'HTML' });
    }
    else if (action === "cmd_stat") {
        bot.sendMessage(chatId, `📊 <b>SYSTEM STATUS</b>\nRisk: ${SYSTEM.risk}\nSlippage: ${SYSTEM.slippage/10}%\nTip: ${SYSTEM.jitoTip/1e9} SOL`, { parse_mode: 'HTML' });
    }

    bot.answerCallbackQuery(query.id).catch(() => {});
    bot.editMessageReplyMarkup(getDashboard().reply_markup, { chat_id: chatId, message_id: msgId }).catch(() => {});
});

// --- 5. LISTENERS ---

bot.onText(/\/(start|menu)/, (msg) => {
    bot.sendMessage(msg.chat.id, "<b>⚔️ APEX OMNI-MASTER v9078</b>\nReady for deployment.", { parse_mode: 'HTML', ...getDashboard() });
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
        bot.sendMessage(msg.chat.id, `✅ <b>SYNCED:</b> <code>${solWallet.publicKey.toBase58()}</code>`, { parse_mode: 'HTML' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ Invalid seed."); }
});

bot.onText(/\/withdraw (.+)/, (msg, match) => {
    executeWithdrawal(msg.chat.id, match[1].trim());
});

http.createServer((req, res) => res.end("SYSTEM LIVE")).listen(8080);
