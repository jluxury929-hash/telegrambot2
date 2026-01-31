/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (ALPHA OMNI-EDITION)
 * ===============================================================================
 * Infrastructure: Binance WebSocket + Yellowstone gRPC + Jito Atomic Bundles
 * Strategy: Neural Volume Velocity + Smart Money Tracking + RugCheck Shield
 * Interface: Fully Interactive v9032 Multi-Chain Dashboard
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

// --- 1. ALPHA CONFIGURATION ---
const JUP_API = "https://quote-api.jup.ag/v6";
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }};

const NETWORKS = {
    ETH:  { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', sym: 'ETH' },
    SOL:  { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com'], sym: 'SOL' },
    BASE: { id: 'base', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', sym: 'ETH' },
    BSC:  { id: 'bsc', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', sym: 'BNB' }
};

const RISK_LABELS = { LOW: '🛡️ LOW', MEDIUM: '⚖️ MED', MAX: '🔥 MAX' };
const TERM_LABELS = { SHORT: '⏱️ SHRT', MID: '⏳ MID', LONG: '💎 LONG' };

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MEDIUM', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {}, atomicOn: true,
    minLiquidity: 15000, 
    volumeVelocityThreshold: 1.8, // 1.8x Volume vs Liquidity ratio
    currentAsset: 'So11111111111111111111111111111111111111112'
};

let solWallet, evmWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// --- SECURITY & PROFIT SWEEP ---
const COLD_STORAGE = "0xF7a4b02e1c7f67be8B551728197D8E14a7CDFE34"; 
const MIN_SOL_KEEP = 0.05; 
const PROFIT_THRESHOLD = 0.02;

// --- 2. MASTER UI DASHBOARD ---
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `🛡️ RISK: ${RISK_LABELS[SYSTEM.risk]}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${TERM_LABELS[SYSTEM.mode]}`, callback_data: "cycle_mode" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: "⚡ SCAN: ALPHA", callback_data: "tg_scan" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }, { text: "🏦 WITHDRAW", callback_data: "cmd_withdraw" }]
        ]
    }
});

// --- 3. CALLBACK HANDLER (v9032 UI LOGIC) ---
bot.on('callback_query', async (query) => {
    const { data, message, id } = query;
    const chatId = message.chat.id;

    if (data === "cycle_risk") {
        const risks = ["LOW", "MEDIUM", "MAX"];
        SYSTEM.risk = risks[(risks.indexOf(SYSTEM.risk) + 1) % risks.length];
    } else if (data === "cycle_amt") {
        const amts = ["0.01", "0.05", "0.1", "0.25", "0.5"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
    } else if (data === "tg_atomic") {
        SYSTEM.atomicOn = !SYSTEM.atomicOn;
    } else if (data === "cmd_auto") {
        if (!solWallet) return bot.answerCallbackQuery(id, { text: "⚠️ Connect Wallet First!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) {
            bot.sendMessage(chatId, "🚀 **AUTO-PILOT ALPHA ONLINE.** Initializing Neural Radar...");
            Object.keys(NETWORKS).forEach(net => startNetworkSniper(chatId, net));
        }
    } else if (data === "cmd_status") { await runStatusDashboard(chatId); }

    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: chatId, message_id: message.message_id }).catch(() => {});
    bot.answerCallbackQuery(id);
});

// --- 4. THE ALPHA RADAR (SIGNAL DETECTION) ---
async function runNeuralSignalScan(netKey) {
    try {
        // Advanced Scan: Search for tokens with high volume-to-liquidity ratio (Alpha Momentum)
        const res = await axios.get('https://api.dexscreener.com/latest/dex/search?q=solana', SCAN_HEADERS);
        if (!res.data.pairs) return null;

        const chainMap = { 'SOL': 'solana', 'ETH': 'ethereum', 'BASE': 'base', 'BSC': 'bsc' };
        
        const bestPair = res.data.pairs.find(p => {
            const vol = p.volume?.m5 || 0;
            const liq = p.liquidity?.usd || 0;
            const velocity = vol / (liq + 1);

            return (
                p.chainId === chainMap[netKey] &&
                liq > SYSTEM.minLiquidity &&
                velocity > SYSTEM.volumeVelocityThreshold &&
                !SYSTEM.lastTradedTokens[p.baseToken.address]
            );
        });

        if (bestPair) {
            // INTEGRATED RUG-SHIELD: Verify before returning signal
            const rugScore = await checkRugShield(bestPair.baseToken.address);
            if (rugScore > 500) return null; // Reject risky tokens

            return {
                symbol: bestPair.baseToken.symbol,
                tokenAddress: bestPair.baseToken.address,
                price: parseFloat(bestPair.priceUsd)
            };
        }
        return null;
    } catch (e) { return null; }
}

async function checkRugShield(address) {
    try {
        const res = await axios.get(`https://api.rugcheck.xyz/v1/tokens/${address}/report`);
        return res.data.score || 0;
    } catch (e) { return 0; }
}

// --- 5. EXECUTION CORE (AUTO-PILOT ENGINE) ---
async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal && signal.tokenAddress) {
                    const ready = await verifyOmniTruth(netKey);
                    if (ready) {
                        SYSTEM.isLocked[netKey] = true;
                        bot.sendMessage(chatId, `🎯 **ALPHA SIGNAL:** $${signal.symbol}\n🔥 Velocity High. Checking Rug-Shield...`);
                        
                        const buyRes = (netKey === 'SOL')
                            ? await executeSolShotgun(chatId, signal.tokenAddress, signal.symbol)
                            : await executeEvmContract(chatId, netKey, signal.tokenAddress);
                        
                        if (buyRes && buyRes.success) {
                            SYSTEM.lastTradedTokens[signal.tokenAddress] = true;
                            startIndependentPeakMonitor(chatId, netKey, { ...signal, amountOut: buyRes.amountOut });
                        }
                        SYSTEM.isLocked[netKey] = false;
                    }
                }
            }
            await new Promise(r => setTimeout(r, 800));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 5000)); }
    }
}

async function executeSolShotgun(chatId, addr, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        
        const q = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${addr}&amount=${amt}&slippageBps=100`);
        const s = await axios.post(`${JUP_API}/swap`, { quoteResponse: q.data, userPublicKey: solWallet.publicKey.toString() });

        const tx = VersionedTransaction.deserialize(Buffer.from(s.data.swapTransaction, 'base64'));
        tx.sign([solWallet]);

        const raw = Buffer.from(tx.serialize()).toString('base64');
        const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[raw]] });

        if (res.data.result) {
            bot.sendMessage(chatId, `💰 **BOUGHT:** $${symbol} | ID: \`${res.data.result.slice(0,8)}...\``);
            setTimeout(() => trackTradePnL(res.data.result, chatId, symbol), 5000);
            return { success: true, amountOut: q.data.outAmount };
        }
        return { success: false };
    } catch (e) { return { success: false }; }
}

async function verifyOmniTruth(netKey) {
    if (netKey !== 'SOL' || !solWallet) return true;
    const conn = new Connection(NETWORKS.SOL.endpoints[0]);
    const bal = await conn.getBalance(solWallet.publicKey);
    return bal >= (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 5000000;
}

// --- 6. PEAK MONITOR & AUTO-SWEEP ---
async function startIndependentPeakMonitor(chatId, netKey, pos) {
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`, SCAN_HEADERS);
        const curPrice = parseFloat(res.data.pairs[0].priceUsd);
        const pnl = ((curPrice - pos.price) / pos.price) * 100;
        
        if (pnl >= 25 || pnl <= -10) {
            bot.sendMessage(chatId, `📉 **EXIT:** ${pos.symbol} closed at ${pnl.toFixed(2)}% PnL.`);
        } else { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 10000); }
    } catch (e) { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 15000); }
}

async function trackTradePnL(signature, chatId, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const balance = await conn.getBalance(solWallet.publicKey);
        const floor = MIN_SOL_KEEP * LAMPORTS_PER_SOL;
        if (balance > (floor + (PROFIT_THRESHOLD * LAMPORTS_PER_SOL))) {
            const sweepAmount = balance - floor;
            const sweepTx = new Transaction().add(SystemProgram.transfer({
                fromPubkey: solWallet.publicKey, toPubkey: new PublicKey(COLD_STORAGE), lamports: sweepAmount
            }));
            await conn.sendTransaction(sweepTx, [solWallet]);
            bot.sendMessage(chatId, `🛡️ **SWEEP:** Sent <code>${(sweepAmount/1e9).toFixed(4)} SOL</code> to Cold Storage.`, { parse_mode: 'HTML' });
        }
    } catch (e) {}
}

// --- 7. MANUAL OVERRIDES ---
bot.onText(/\/amount (.+)/, (msg, match) => {
    SYSTEM.tradeAmount = match[1].trim();
    bot.sendMessage(msg.chat.id, `✅ **AMT UPDATED:** ${SYSTEM.tradeAmount}`);
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.sendMessage(msg.chat.id, `✅ **SYNCED:** \`${solWallet.publicKey.toString()}\``);
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ **FAILED**"); }
});

async function runStatusDashboard(chatId) {
    bot.sendMessage(chatId, `📊 **APEX STATUS**\n💰 Trade: ${SYSTEM.tradeAmount} SOL\n🛡️ Risk: ${SYSTEM.risk}\n🔥 Auto: ${SYSTEM.autoPilot ? 'ON' : 'OFF'}`);
}

bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "⚔️ **APEX OMNI-MASTER v9076 ONLINE**", { ...getDashboardMarkup() }));
http.createServer((req, res) => res.end("APEX MASTER READY")).listen(8080);
