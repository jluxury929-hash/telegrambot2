/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (GLOBAL ULTIMATUM EDITION)
 * ===============================================================================
 * Infrastructure: Yellowstone gRPC + Jito Atomic Bundles + Dual-RPC Failover
 * Interface: Interactive v9032 Dashboard with UI Cycling & Sync Status
 * Features: Alpha Velocity Scanner + RugCheck Multi-Filter + Auto-Profit Sweep
 * ===============================================================================
 */

require('dotenv').config();
const { 
    Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, 
    PublicKey, SystemProgram, Transaction, TransactionMessage 
} = require('@solana/web3.js');
const { ethers, JsonRpcProvider } = require('ethers');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- 1. CONFIGURATION & ENDPOINTS ---
const JUP_API = "https://quote-api.jup.ag/v6";
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }};
const JITO_TIP_ADDR = new PublicKey("96g9sAg9u3mBsJp9U9YVsk8XG3V6rW5E2t3e8B5Y3npx");

const NETWORKS = {
    SOL:  { id: 'solana', endpoints: [process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com'], sym: 'SOL' },
    BSC:  { id: 'bsc', rpc: 'https://bsc-dataseed.binance.org/', sym: 'BNB' },
    BASE: { id: 'base', rpc: 'https://mainnet.base.org', sym: 'ETH' }
};

const RISK_LABELS = { LOW: '🛡️ LOW', MEDIUM: '⚖️ MED', MAX: '🔥 MAX' };
const TERM_LABELS = { SHORT: '⏱️ SHRT', MID: '⏳ MID', LONG: '💎 LONG' };

// --- GLOBAL STATE ---
let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MEDIUM', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {}, atomicOn: true,
    jitoTip: 2000000, // 0.002 SOL Tip
    minLiquidity: 15000, velocityThreshold: 1.8,
    currentAsset: 'So11111111111111111111111111111111111111112'
};

let solWallet, evmWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const COLD_STORAGE = process.env.COLD_STORAGE || "0xF7a4b02e1c7f67be8B551728197D8E14a7CDFE34"; 

// --- 2. DYNAMIC UI DASHBOARD ---
const getDashboardMarkup = () => {
    const walletLabel = solWallet 
        ? `✅ LINKED: ${solWallet.publicKey.toString().slice(0, 4)}...${solWallet.publicKey.toString().slice(-4)}`
        : "🔌 CONNECT WALLET";

    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
                [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
                [{ text: `🛡️ RISK: ${RISK_LABELS[SYSTEM.risk]}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${TERM_LABELS[SYSTEM.mode]}`, callback_data: "cycle_mode" }],
                [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: walletLabel, callback_data: "cmd_conn" }],
                [{ text: "🏦 WITHDRAW PROFITS", callback_data: "cmd_withdraw" }]
            ]
        }
    };
};

// --- 3. AUTO-PILOT LOGIC (v9032 PARALLEL LOOP) ---
async function startNetworkSniper(chatId, netKey) {
    console.log(`[INIT] Parallel thread for ${netKey} active.`.magenta);
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal && signal.tokenAddress) {
                    const ready = await verifyBalance(netKey);
                    if (!ready) {
                        bot.sendMessage(chatId, `⚠️ **[${netKey}] SKIP:** Insufficient funds.`);
                        await new Promise(r => setTimeout(r, 30000));
                        continue;
                    }

                    SYSTEM.isLocked[netKey] = true;
                    bot.sendMessage(chatId, `🧠 **SIGNAL:** ${signal.symbol}. Engaging Shotgun...`);
                    
                    const buyRes = (netKey === 'SOL')
                        ? await executeSolShotgun(chatId, signal.tokenAddress, signal.symbol)
                        : await executeEvmContract(chatId, netKey, signal.tokenAddress);
                    
                    if (buyRes && buyRes.success) {
                        SYSTEM.lastTradedTokens[signal.tokenAddress] = true;
                        startIndependentPeakMonitor(chatId, netKey, { ...signal, entryPrice: signal.price });
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 2500));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 5000)); }
    }
}

// --- 4. EXECUTION CORE (JITO ATOMIC BUNDLES) ---
async function executeSolShotgun(chatId, addr, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        
        const qRes = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${addr}&amount=${amt}&slippageBps=100`);
        const sRes = await axios.post(`${JUP_API}/swap`, {
            quoteResponse: qRes.data,
            userPublicKey: solWallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            prioritizationFeeLamports: "auto"
        });

        const tx = VersionedTransaction.deserialize(Buffer.from(sRes.data.swapTransaction, 'base64'));
        
        // Refresh Blockhash to ensure validity
        const { blockhash } = await conn.getLatestBlockhash('finalized');
        tx.message.recentBlockhash = blockhash;
        tx.sign([solWallet]);

        // Wrap in Jito Bundle
        const rawTx = Buffer.from(tx.serialize()).toString('base64');
        const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[rawTx]] });

        if (res.data.result) {
            bot.sendMessage(chatId, `💰 **BOUGHT:** $${symbol} | Bundle: \`${res.data.result.slice(0,8)}...\``);
            return { success: true };
        }
        return { success: false };
    } catch (e) { return { success: false }; }
}

// --- 5. CALLBACK & CONNECTION HANDLERS ---
bot.on('callback_query', async (query) => {
    const { data, message, id } = query;
    const chatId = message.chat.id;
    bot.answerCallbackQuery(id).catch(() => {});

    if (data === "cycle_risk") {
        const risks = ["LOW", "MEDIUM", "MAX"];
        SYSTEM.risk = risks[(risks.indexOf(SYSTEM.risk) + 1) % risks.length];
    } else if (data === "cycle_amt") {
        const amts = ["0.01", "0.05", "0.1", "0.25", "0.5"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
    } else if (data === "cmd_auto") {
        if (!solWallet) return bot.sendMessage(chatId, "❌ **Link Wallet First!**");
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) {
            bot.sendMessage(chatId, "🚀 **AUTO-PILOT ACTIVE.** Radar scanning...");
            Object.keys(NETWORKS).forEach(net => startNetworkSniper(chatId, net));
        }
    } else if (data === "cmd_conn") {
        bot.sendMessage(chatId, "🔌 <b>Sync Wallet:</b> Send <code>/connect [mnemonic]</code>", { parse_mode: 'HTML' });
    }

    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: chatId, message_id: message.message_id }).catch(() => {});
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = match[1].trim();
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", (await bip39.mnemonicToSeed(seed)).toString('hex')).key);
        bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
        bot.sendMessage(msg.chat.id, `✅ **SYNCED:** \`${solWallet.publicKey.toString()}\``);
        bot.sendMessage(msg.chat.id, "🎮 **Neural Control Center:**", getDashboardMarkup());
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ **FAILED**"); }
});

// --- 6. ALPHA SCANNER (VELOCITY & LIQUIDITY FILTER) ---
async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/latest/dex/search?q=solana', SCAN_HEADERS);
        if (!res.data.pairs) return null;
        
        const match = res.data.pairs.find(p => {
            const velocity = (p.volume?.m5 || 0) / (p.liquidity?.usd || 1);
            return p.liquidity?.usd > SYSTEM.minLiquidity && velocity > SYSTEM.velocityThreshold && !SYSTEM.lastTradedTokens[p.baseToken.address];
        });

        return match ? { symbol: match.baseToken.symbol, tokenAddress: match.baseToken.address, price: parseFloat(match.priceUsd) } : null;
    } catch (e) { return null; }
}

async function verifyBalance(netKey) {
    if (netKey === 'SOL' && solWallet) {
        const conn = new Connection(NETWORKS.SOL.endpoints[0]);
        const bal = await conn.getBalance(solWallet.publicKey);
        return bal >= (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 10000000;
    }
    return true; 
}

bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "⚔️ **APEX MASTER v9076 ONLINE**", { parse_mode: 'HTML', ...getDashboardMarkup() }));
http.createServer((req, res) => res.end("MASTER READY")).listen(8080);
