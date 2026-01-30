/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9077 (GLOBAL ULTIMATUM EDITION)
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

// --- 🔱 CORE STATE & NEW OPTIONS ---
let SYSTEM = {
    autoPilot: false, 
    tradeAmount: "0.1", 
    risk: 'LOW',   // Options: LOW, MED, HIGH, MAX
    term: 'SCALP', // Options: SCALP, SWING, BULL
    mode: 'GLOBAL',
    lastTradedTokens: {}, 
    isLocked: {},
    currentAsset: 'So11111111111111111111111111111111111111112',
    atomicOn: true, 
    flashOn: false,
    jitoTip: 2000000, 
    shredSpeed: true,
    lastBinancePrice: 0
};

let solWallet, evmWallet, activeChatId;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const JUP_API = "https://quote-api.jup.ag/v6";
const NETWORKS = {
    SOL: { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'], sym: 'SOL' }
    // ... other networks
};

// --- 🛠️ FIX: WITHDRAWAL LOGIC ---
async function handleWithdrawal(chatId, destinationAddr) {
    if (!solWallet) return bot.sendMessage(chatId, "❌ Wallet not connected.");
    
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const balance = await conn.getBalance(solWallet.publicKey);
        const fee = 5000; // Standard SOL fee
        const amountToSend = balance - fee - 1000000; // Leave tiny dust for safety

        if (amountToSend <= 0) return bot.sendMessage(chatId, "⚠️ Balance too low to cover gas.");

        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: solWallet.publicKey,
                toPubkey: new PublicKey(destinationAddr),
                lamports: amountToSend,
            })
        );

        const signature = await sendAndConfirmTransaction(conn, transaction, [solWallet]);
        bot.sendMessage(chatId, `💸 <b>Withdrawal Success!</b>\nSent: <code>${(amountToSend/LAMPORTS_PER_SOL).toFixed(4)} SOL</code>\nTX: <a href="https://solscan.io/tx/${signature}">View on Solscan</a>`, { parse_mode: 'HTML' });
    } catch (e) {
        bot.sendMessage(chatId, `❌ <b>Withdrawal Failed:</b> ${e.message}`, { parse_mode: 'HTML' });
    }
}

// --- 🎨 UI DASHBOARD WITH RISK & TERM ---
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `⚠️ RISK: ${SYSTEM.risk}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${SYSTEM.term}`, callback_data: "cycle_term" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: "🏦 WITHDRAW", callback_data: "cmd_withdraw_init" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }]
        ]
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    // Cycle Risk Levels
    if (data === "cycle_risk") {
        const risks = ['LOW', 'MED', 'HIGH', 'MAX'];
        SYSTEM.risk = risks[(risks.indexOf(SYSTEM.risk) + 1) % risks.length];
    } 
    // Cycle Term Types
    else if (data === "cycle_term") {
        const terms = ['SCALP', 'SWING', 'BULL'];
        SYSTEM.term = terms[(terms.indexOf(SYSTEM.term) + 1) % terms.length];
    }
    // Handle Withdrawal Request
    else if (data === "cmd_withdraw_init") {
        bot.sendMessage(chatId, "🏦 <b>Withdrawal:</b> Use <code>/withdraw [ADDRESS]</code> to sweep your SOL balance.", { parse_mode: 'HTML' });
    }
    // Amount Cycling
    else if (data === "cycle_amt") {
        const amts = ["0.1", "0.5", "1.0", "2.5", "5.0"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
    }
    else if (data === "tg_atomic") SYSTEM.atomicOn = !SYSTEM.atomicOn;
    else if (data === "cmd_auto") {
        if (!solWallet) return bot.answerCallbackQuery(query.id, { text: "❌ Sync Wallet First!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
    }

    bot.answerCallbackQuery(query.id).catch(() => {});
    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
});

// --- 📡 COMMAND HANDLERS ---
bot.onText(/\/withdraw (.+)/, (msg, match) => {
    handleWithdrawal(msg.chat.id, match[1].trim());
});

bot.onText(/\/(start|menu)/, (msg) => {
    bot.sendMessage(msg.chat.id, "<b>⚔️ APEX OMNI-MASTER v9077</b>\nStatus: Optimized & Ready.", { parse_mode: 'HTML', ...getDashboardMarkup() });
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        const hex = seed.toString('hex');
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", hex).key);
        bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
        bot.sendMessage(msg.chat.id, `✅ <b>SYNCED:</b> <code>${solWallet.publicKey.toString()}</code>`, { parse_mode: 'HTML' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ <b>FAILED SYNC</b>"); }
});

http.createServer((req, res) => res.end("SYSTEM LIVE")).listen(8080);
