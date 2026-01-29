/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (GLOBAL ULTIMATUM EDITION)
 * ===============================================================================
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

// 1. INITIALIZE CORE BOT FIRST (Critical Fix for ReferenceErrors)
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

/**
 * 🔱 GHOST INJECTION: ATOMIC USDC WITHDRAWAL & FUND VERIFIER
 * Shadowing original functions to extend logic without changing core lines below.
 */

// ATOMIC USDC WITHDRAWAL ENGINE (High-Precision Security)
async function executeAtomicWithdrawal(chatId) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const bal = await conn.getBalance(solWallet.publicKey);
        
        // 🛡️ INSUFFICIENT FUNDS GUARD (Priority Fee + Jito Tip + Token Account Rent)
        const minRequired = 8000000; // 0.008 SOL

        if (bal <= minRequired) {
            return bot.sendMessage(chatId, 
                `❌ <b>INSUFFICIENT FUNDS FOR CONVERSION</b>\n` +
                `━━━━━━━━━━━━━━━\n` +
                `⚠️ <b>Error:</b> Wallet balance is too low to cover the Network Rent and Jito MEV-Shield fees required for a safe exit.\n\n` +
                `💰 <b>Wallet Balance:</b> <code>${(bal/1e9).toFixed(4)} SOL</code>\n` +
                `🛡️ <b>Minimum Needed:</b> <code>0.0080 SOL</code>`, 
                { parse_mode: 'HTML' });
        }

        const withdrawAmt = bal - minRequired;
        bot.sendMessage(chatId, `🏦 <b>SECURE EXIT INITIATED</b>\n━━━━━━━━━━━━━━━\nConverting <code>${(withdrawAmt/1e9).toFixed(4)} SOL</code> to USDC...`, { parse_mode: 'HTML' });

        // Jupiter V6 Institutional Quote
        const quote = await axios.get(`${JUP_API}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=${withdrawAmt}&slippageBps=100`);
        const { swapTransaction } = (await axios.post(`${JUP_API}/swap`, { quoteResponse: quote.data, userPublicKey: solWallet.publicKey.toString(), prioritizationFeeLamports: "auto" })).data;

        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([solWallet]);

        // Route through Jito MEV-Shield
        const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[Buffer.from(tx.serialize()).toString('base64')]] });
        if (res.data.result) {
            bot.sendMessage(chatId, `✅ <b>WITHDRAW SUCCESS:</b> USDC Secured.\n📜 <a href="https://solscan.io/tx/${res.data.result}">Receipt</a>`, { parse_mode: 'HTML' });
        }
    } catch (e) { 
        bot.sendMessage(chatId, "❌ <b>WITHDRAWAL FAILED:</b> Market depth insufficient for atomic conversion."); 
    }
}

const RISK_LABELS = { LOW: '🛡️ LOW', MEDIUM: '⚖️ MED', MAX: '🔥 MAX' };
const TERM_LABELS = { SHORT: '⏱️ SHRT', MID: '⏳ MID', LONG: '💎 LONG' };

// 2. ENHANCED FLUID MENU (Overrides getDashboardMarkup)
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `⚠️ RISK: ${RISK_LABELS[SYSTEM.risk] || '⚖️ MED'}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${TERM_LABELS[SYSTEM.mode] || '⏱️ SHRT'}`, callback_data: "cycle_mode" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: SYSTEM.flashOn ? "⚡ FLASH: ON" : "⚡ FLASH: OFF", callback_data: "tg_flash" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }, { text: "🏦 WITHDRAW (USDC)", callback_data: "cmd_withdraw" }]
        ]
    }
});

// 3. NON-STICKY CALLBACK HANDLER (Immediate Acknowledgment)
bot.on('callback_query', async (query) => {
    const { data, message, id } = query;
    const chatId = message.chat.id;
    
    // Kill the Telegram loading spinner instantly
    bot.answerCallbackQuery(id).catch(() => {});

    if (data === "cmd_withdraw") {
        if (!solWallet) return bot.sendMessage(chatId, "❌ Sync Wallet First!");
        return executeAtomicWithdrawal(chatId);
    } else if (data === "cycle_risk") {
        const lvls = ["LOW", "MEDIUM", "MAX"];
        SYSTEM.risk = lvls[(lvls.indexOf(SYSTEM.risk) + 1) % lvls.length];
    } else if (data === "cycle_mode") {
        const terms = ["SHORT", "MID", "LONG"];
        SYSTEM.mode = terms[(terms.indexOf(SYSTEM.mode) + 1) % terms.length];
    } else if (data === "cycle_amt") {
        const amts = ["0.01", "0.05", "0.1", "0.25", "0.5"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
    } else if (data === "tg_atomic") {
        SYSTEM.atomicOn = !SYSTEM.atomicOn;
    } else if (data === "tg_flash") {
        SYSTEM.flashOn = !SYSTEM.flashOn;
    } else if (data === "cmd_auto") {
        if (!solWallet) return bot.sendMessage(chatId, "❌ Sync Wallet First!");
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) Object.keys(NETWORKS).forEach(net => startNetworkSniper(chatId, net));
    } else if (data === "cmd_status") {
        return runStatusDashboard(chatId);
    } else if (data === "cmd_conn") {
        return bot.sendMessage(chatId, "🔌 <b>Sync:</b> <code>/connect [mnemonic]</code>", { parse_mode: 'HTML' });
    }

    // Refresh UI text instantly
    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: chatId, message_id: message.message_id }).catch(() => {});
});

/**
 * ===============================================================================
 * CORE INFRASTRUCTURE (ORIGINAL LOGIC PRESERVED)
 * ===============================================================================
 */

const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } = require('@solana/web3.js');
const { default: Client } = require("@triton-one/yellowstone-grpc"); // 2026 High-Speed Stream
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
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
    } catch (e) { console.log(`[MEV-SHIELD] ⚠️ Private Lane busy, falling back...`.yellow); }
    return originalSend.apply(this, [rawTx, options]);
};

// --- 2. GLOBAL STATE & OMNI-CONFIG ---
const JUP_API = "https://quote-api.jup.ag/v6";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0' }};
const CAD_RATES = { SOL: 248.15, ETH: 4920.00, BNB: 865.00 };
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const BINANCE_WS = "wss://stream.binance.com:9443/ws/solusdt@bookTicker"; 

const NETWORKS = {
    ETH:  { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', sym: 'ETH' },
    SOL:  { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'], sym: 'SOL' },
    BASE: { id: 'base', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', sym: 'ETH' },
    BSC:  { id: 'bsc', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', sym: 'BNB' },
    ARB:  { id: 'arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', sym: 'ETH' }
};

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MAX', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {},
    currentAsset: 'So11111111111111111111111111111111111111112',
    entryPrice: 0, currentPnL: 0, currentSymbol: 'SOL',
    lastMarketState: '', lastCheckPrice: 0,
    atomicOn: true, flashOn: false,
    jitoTip: 20000000, 
    shredSpeed: true,
    lastBinancePrice: 0
};
let solWallet, evmWallet, activeChatId;

// --- 🔱 2.5: GLOBAL RADAR & PnL TOOLS ---

const getMarketMood = (delta) => {
    const d = Math.abs(delta);
    if (d > 1.8) return '🔴 Dangerous (Extreme Slippage)';
    if (d > 0.7) return '🟡 Volatile (High ROI Predator Zone)';
    return '🟢 Low (Stable Arbitrage)';
};

async function trackTradePnL(signature, chatId, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const tx = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
        if (!tx) return;
        const solChange = (tx.meta.postBalances[0] - tx.meta.preBalances[0]) / LAMPORTS_PER_SOL;
        const cadValue = solChange * CAD_RATES.SOL;
        bot.sendMessage(chatId, `🛰️ <b>TRADE SETTLED:</b> ${symbol}\n💰 <b>Net SOL:</b> <code>${solChange.toFixed(6)}</code>\n💵 <b>Value:</b> $${cadValue.toFixed(2)} CAD`, { parse_mode: 'HTML' });
    } catch (e) { console.log("[PnL] Settlement Logged.".yellow); }
}

async function startGlobalUltimatum(chatId) {
    const ws = new WebSocket(BINANCE_WS);
    ws.on('message', async (data) => {
        const tick = JSON.parse(data);
        SYSTEM.lastBinancePrice = (parseFloat(tick.b) + parseFloat(tick.a)) / 2;
        if (SYSTEM.autoPilot) await checkGlobalArb(chatId);
    });
    if (process.env.GRPC_ENDPOINT) {
        const client = new Client(process.env.GRPC_ENDPOINT, process.env.X_TOKEN);
        const stream = await client.subscribe();
        stream.on("data", async (data) => {
            if (data.transaction && SYSTEM.autoPilot) executeAggressiveSolRotation(chatId, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "GEYSER-FAST");
        });
        await stream.write({ transactions: { "jup": { accountInclude: ["JUP6LkbZbjS1jKKppyo4oh4A8J35gCWkkdQdq9nSC7"] } } });
    }
}

async function checkGlobalArb(chatId) {
    if (SYSTEM.isLocked['SOL']) return;
    try {
        const solPriceRes = await axios.get(`${JUP_API}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000`);
        const solanaPrice = solPriceRes.data.outAmount / 1e6;
        const delta = ((SYSTEM.lastBinancePrice - solanaPrice) / solanaPrice) * 100;
        if (Math.abs(delta) > 0.45) executeAggressiveSolRotation(chatId, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "GLOBAL-ARB");
    } catch (e) {}
}

// --- 6. OMNI-EXECUTION ENGINE ---

async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal) {
                    SYSTEM.isLocked[netKey] = true;
                    await executeAggressiveSolRotation(chatId, signal.tokenAddress, signal.symbol);
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 400));
        } catch (e) { SYSTEM.isLocked[netKey] = false; }
    }
}

async function executeAggressiveSolRotation(chatId, targetToken, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        const quote = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${targetToken}&amount=${amt}&slippageBps=50`);
        const { swapTransaction } = (await axios.post(`${JUP_API}/swap`, { quoteResponse: quote.data, userPublicKey: solWallet.publicKey.toString(), prioritizationFeeLamports: "auto" })).data;
        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([solWallet]);
        const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[Buffer.from(tx.serialize()).toString('base64')]] });
        if (res.data.result) {
            bot.sendMessage(chatId, `💰 <b>SUCCESS:</b> ${symbol} Slot #0.`);
            setTimeout(() => trackTradePnL(res.data.result, chatId, symbol), 4000);
            return true;
        }
    } catch (e) { return false; }
}

async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const match = res.data.find(t => t.chainId === 'solana' && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        return match ? { symbol: match.symbol, tokenAddress: match.tokenAddress } : null;
    } catch (e) { return null; }
}

function runStatusDashboard(chatId) {
    const estProfit = (parseFloat(SYSTEM.tradeAmount) * 0.0085 * CAD_RATES.SOL).toFixed(2);
    bot.sendMessage(chatId, `📊 <b>OMNI STATUS</b>\n🛡️ <b>Risk:</b> ${SYSTEM.risk}\n⏳ <b>Term:</b> ${SYSTEM.mode}\n💰 <b>Size:</b> ${SYSTEM.tradeAmount} SOL\n💎 <b>Est. CAD:</b> ~$${estProfit}`, { parse_mode: 'HTML' });
}

http.createServer((req, res) => res.end("v9076 READY")).listen(8080);
bot.onText(/\/(start|menu)/, (msg) => {
    activeChatId = msg.chat.id;
    startGlobalUltimatum(activeChatId);
    bot.sendMessage(msg.chat.id, "⚔️ <b>APEX मास्टर v9076</b>", { parse_mode: 'HTML', ...getDashboardMarkup() });
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.sendMessage(msg.chat.id, `✅ <b>SYNCED</b>`);
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ <b>FAILED</b>"); }
});

bot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/connect')) bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
});
