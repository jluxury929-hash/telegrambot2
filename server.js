/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (GLOBAL MASTER MERGE)
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- 1. CORE CONFIGURATION ---
const JUP_API = "https://quote-api.jup.ag/v6";
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }};

const NETWORKS = {
    SOL:  { id: 'solana', primary: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', fallback: 'https://rpc.ankr.com/solana' },
    BSC:  { id: 'bsc', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E' },
    BASE: { id: 'base', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' }
};

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MEDIUM', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {}, atomicOn: true,
    minLiquidity: 15000, velocityThreshold: 1.8,
    currentAsset: 'So11111111111111111111111111111111111111112'
};

let solWallet, evmWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const COLD_STORAGE = "0xF7a4b02e1c7f67be8B551728197D8E14a7CDFE34"; 

// --- 🔱 LAYER 2: MEV-SHIELD SHADOW INJECTION ---
const originalSend = Connection.prototype.sendRawTransaction;
Connection.prototype.sendRawTransaction = async function(rawTx, options) {
    if (!SYSTEM.atomicOn) return originalSend.apply(this, [rawTx, options]);
    try {
        const base64Tx = Buffer.from(rawTx).toString('base64');
        const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[base64Tx]] });
        if (res.data.result) return res.data.result;
    } catch (e) { console.log(`[MEV-SHIELD] ⚠️ Jito Lane busy, using fallback...`.yellow); }
    return originalSend.apply(this, [rawTx, options]);
};

// --- 2. INTERACTIVE DASHBOARD (UI REFRESH) ---
const RISK_LABELS = { LOW: '🛡️ LOW', MEDIUM: '⚖️ MED', MAX: '🔥 MAX' };
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `🛡️ RISK: ${RISK_LABELS[SYSTEM.risk]}`, callback_data: "cycle_risk" }, { text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }, { text: "🏦 WITHDRAW", callback_data: "cmd_withdraw" }]
        ]
    }
});

// --- 3. THE ALPHA RADAR (SIGNAL -> RUGCHECK -> VERIFY) ---
async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/latest/dex/search?q=solana', SCAN_HEADERS);
        if (!res.data.pairs) return null;
        const match = res.data.pairs.find(p => {
            const velocity = (p.volume?.m5 || 0) / (p.liquidity?.usd || 1);
            return p.liquidity?.usd > SYSTEM.minLiquidity && velocity > SYSTEM.velocityThreshold && !SYSTEM.lastTradedTokens[p.baseToken.address];
        });
        if (match) {
            const rugReport = await axios.get(`https://api.rugcheck.xyz/v1/tokens/${match.baseToken.address}/report`);
            if (rugReport.data.score > 500) return null; 
            return { symbol: match.baseToken.symbol, tokenAddress: match.baseToken.address, price: parseFloat(match.priceUsd) };
        }
    } catch (e) { return null; }
}

// --- 4. AUTO-PILOT ENGINE (v9032 EXACT LOGIC) ---
async function startNetworkSniper(chatId, netKey) {
    console.log(`[INIT] Parallel thread for ${netKey} active.`.magenta);
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal && signal.tokenAddress) {
                    const ready = await verifyBalance(netKey);
                    if (ready) {
                        SYSTEM.isLocked[netKey] = true;
                        bot.sendMessage(chatId, `🧠 **[${netKey}] SIGNAL:** ${signal.symbol}. Engaging Sniper.`);
                        const buyRes = (netKey === 'SOL')
                            ? await executeSolShotgun(chatId, signal.tokenAddress, signal.symbol)
                            : await executeEvmContract(chatId, netKey, signal.tokenAddress);
                        if (buyRes) SYSTEM.lastTradedTokens[signal.tokenAddress] = true;
                        SYSTEM.isLocked[netKey] = false;
                    }
                }
            }
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 5000)); }
    }
}

async function executeSolShotgun(chatId, addr, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.primary, 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        const qRes = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${addr}&amount=${amt}&slippageBps=100`);
        const sRes = await axios.post(`${JUP_API}/swap`, { quoteResponse: qRes.data, userPublicKey: solWallet.publicKey.toString() });
        const tx = VersionedTransaction.deserialize(Buffer.from(sRes.data.swapTransaction, 'base64'));
        const { blockhash } = await conn.getLatestBlockhash('finalized');
        tx.message.recentBlockhash = blockhash;
        tx.sign([solWallet]);
        const sig = await conn.sendRawTransaction(tx.serialize()); // Hijacked by Shadow Injection
        if (sig) bot.sendMessage(chatId, `💰 **BOUGHT:** $${symbol}\nSig: \`${sig.slice(0,8)}...\``);
        return true;
    } catch (e) { return false; }
}

// --- 5. CALLBACK HANDLERS & INITIALIZATION ---
bot.on('callback_query', async (query) => {
    const { data, message } = query;
    if (data === "cmd_auto") {
        if (!solWallet) return bot.answerCallbackQuery(query.id, { text: "❌ Link Wallet!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) Object.keys(NETWORKS).forEach(net => startNetworkSniper(message.chat.id, net));
    } else if (data === "cycle_amt") {
        const a = ["0.1", "0.25", "0.5", "1.0"];
        SYSTEM.tradeAmount = a[(a.indexOf(SYSTEM.tradeAmount) + 1) % a.length];
    }
    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: message.chat.id, message_id: message.message_id });
    bot.answerCallbackQuery(query.id);
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    const seed = await bip39.mnemonicToSeed(match[1].trim());
    solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
    bot.sendMessage(msg.chat.id, `✅ **SYNCED:** \`${solWallet.publicKey.toString()}\``);
});

async function verifyBalance(netKey) {
    if (netKey !== 'SOL' || !solWallet) return true;
    const bal = await (new Connection(NETWORKS.SOL.primary)).getBalance(solWallet.publicKey);
    return bal >= (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 10000000;
}

bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "⚔️ **APEX MASTER v9076 MASTER MERGE**", getDashboardMarkup()));
http.createServer((req, res) => res.end("MASTER READY")).listen(8080);
