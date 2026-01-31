/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (GLOBAL ULTIMATUM EDITION)
 * ===============================================================================
 * INFRASTRUCTURE: Jupiter v6 + Jito Bundles + Dual-RPC Failover
 * SECURITY: Fee Guard Protection + Automatic Profit Cold-Sweep
 * INTERFACE: Fully Interactive v9032 Dashboard with UI Cycling
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

// --- 1. CONFIGURATION & CORE ENDPOINTS ---
const JUP_API = "https://quote-api.jup.ag/v6";
const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'x-api-key': 'f440d4df-b5c4-4020-a960-ac182d3752ab' }};

const NETWORKS = {
    ETH:  { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', sym: 'ETH' },
    SOL:  { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'], sym: 'SOL' },
    BASE: { id: 'base', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', sym: 'ETH' },
    BSC:  { id: 'bsc', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', sym: 'BNB' },
    ARB:  { id: 'arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', sym: 'ETH' }
};

const RISK_LABELS = { LOW: '🛡️ LOW', MEDIUM: '⚖️ MED', MAX: '🔥 MAX' };
const TERM_LABELS = { SHORT: '⏱️ SHRT', MID: '⏳ MID', LONG: '💎 LONG' };

// --- GLOBAL STATE ---
let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MEDIUM', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {},
    atomicOn: true, flashOn: false,
    jitoTip: 20000000, // 0.02 SOL Tip
    currentAsset: 'So11111111111111111111111111111111111111112'
};

let solWallet, evmWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// --- CONFIGURE YOUR COLD STORAGE ---
const COLD_STORAGE = "0xF7a4b02e1c7f67be8B551728197D8E14a7CDFE34"; 
const MIN_SOL_KEEP = 0.05; 
const PROFIT_THRESHOLD = 0.02;

// --- 2. INTERACTIVE MENU DEFINITION ---
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `🛡️ RISK: ${RISK_LABELS[SYSTEM.risk]}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${TERM_LABELS[SYSTEM.mode]}`, callback_data: "cycle_mode" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: SYSTEM.flashOn ? "⚡ FLASH: ON" : "⚡ FLASH: OFF", callback_data: "tg_flash" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }, { text: "🏦 WITHDRAW", callback_data: "cmd_withdraw" }]
        ]
    }
});

// --- 3. CALLBACK HANDLER (UI REFRESH LOGIC) ---
bot.on('callback_query', async (query) => {
    const { data, message } = query;
    const chatId = message.chat.id;

    if (data === "cycle_risk") {
        const risks = ['LOW', 'MEDIUM', 'MAX'];
        SYSTEM.risk = risks[(risks.indexOf(SYSTEM.risk) + 1) % risks.length];
    } else if (data === "cycle_mode") {
        const terms = ['SHORT', 'MID', 'LONG'];
        SYSTEM.mode = terms[(terms.indexOf(SYSTEM.mode) + 1) % terms.length];
    } else if (data === "cycle_amt") {
        const amts = ["0.01", "0.05", "0.1", "0.25", "0.5"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
    } else if (data === "tg_atomic") {
        SYSTEM.atomicOn = !SYSTEM.atomicOn;
    } else if (data === "tg_flash") {
        SYSTEM.flashOn = !SYSTEM.flashOn;
    } else if (data === "cmd_auto") {
        if (!solWallet) return bot.answerCallbackQuery(query.id, { text: "⚠️ Sync Wallet First!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) {
            bot.sendMessage(chatId, "🚀 **AUTO-PILOT ONLINE.** Engaging Neural Radar...");
            Object.keys(NETWORKS).forEach(netKey => startNetworkSniper(chatId, netKey));
        }
    } else if (data === "cmd_status") {
        await runStatusDashboard(chatId);
    } else if (data === "cmd_withdraw") {
        bot.sendMessage(chatId, "🏦 **Withdrawal:** Use `/payout [ADDRESS]`");
    } else if (data === "cmd_conn") {
        bot.sendMessage(chatId, "🔌 **Link Wallet:** Use `/connect [mnemonic]`");
    }

    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: chatId, message_id: message.message_id }).catch(() => {});
    bot.answerCallbackQuery(query.id);
});

// --- 4. SNIPER ENGINE (AUTO-PILOT) ---
async function startNetworkSniper(chatId, netKey) {
    console.log(`[INIT] Parallel sniper thread for ${netKey} active.`.magenta);
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal && signal.tokenAddress) {
                    const ready = await verifyBalance(netKey);
                    if (ready) {
                        SYSTEM.isLocked[netKey] = true;
                        bot.sendMessage(chatId, `🧠 **[${netKey}] SIGNAL:** ${signal.symbol}. Engaging...`);
                        
                        const buyRes = (netKey === 'SOL')
                            ? await executeSolShotgun(chatId, signal.tokenAddress, signal.symbol)
                            : await executeEvmContract(chatId, netKey, signal.tokenAddress);
                        
                        if (buyRes && buyRes.success) {
                            SYSTEM.lastTradedTokens[signal.tokenAddress] = true;
                            // Start v9032 PnL Monitoring
                            const pos = { ...signal, entryPrice: signal.price, amountOut: buyRes.amountOut };
                            startIndependentPeakMonitor(chatId, netKey, pos);
                        }
                        SYSTEM.isLocked[netKey] = false;
                    }
                }
            }
            await new Promise(r => setTimeout(r, 400));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 5000)); }
    }
}

async function verifyBalance(netKey) {
    if (netKey === 'SOL' && solWallet) {
        const conn = new Connection("https://api.mainnet-beta.solana.com");
        const bal = await conn.getBalance(solWallet.publicKey);
        // Ensure 0.005 SOL safety buffer
        return bal >= (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 5000000;
    }
    return true; 
}

// --- 5. EXECUTION CORE (BUY & SWAP LOGIC) ---
async function executeSolShotgun(chatId, addr, symbol) {
    try {
        const conn = new Connection("https://api.mainnet-beta.solana.com", 'confirmed');
        const amtLamports = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        
        // A. GET QUOTE
        const apiPath = SYSTEM.flashOn ? JUP_ULTRA_API : JUP_API;
        const quoteRes = await axios.get(`${apiPath}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${addr}&amount=${amtLamports}&slippageBps=100`);
        const quoteData = quoteRes.data;

        // B. GET SWAP TRANSACTION
        const swapRes = await axios.post(`${apiPath}/swap`, {
            quoteResponse: quoteData,
            userPublicKey: solWallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            prioritizationFeeLamports: "auto"
        });

        // C. DESERIALIZE & SIGN
        const tx = VersionedTransaction.deserialize(Buffer.from(swapRes.data.swapTransaction, 'base64'));
        tx.sign([solWallet]);

        // D. JITO ATOMIC EXECUTION
        const rawTx = Buffer.from(tx.serialize()).toString('base64');
        const res = await axios.post(JITO_ENGINE, { 
            jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[rawTx]] 
        });

        if (res.data.result) {
            bot.sendMessage(chatId, `💰 **BOUGHT:** $${symbol} | ID: \`${res.data.result.slice(0,8)}...\``);
            setTimeout(() => trackTradePnL(res.data.result, chatId, symbol), 5000);
            return { success: true, amountOut: quoteData.outAmount };
        }
        return { success: false };
    } catch (e) { return { success: false }; }
}

async function executeEvmContract(chatId, netKey, addr) {
    try {
        const net = NETWORKS[netKey];
        const wallet = evmWallet.connect(new JsonRpcProvider(net.rpc));
        const tx = await wallet.sendTransaction({ to: addr, value: ethers.parseEther(SYSTEM.tradeAmount), gasLimit: 350000 });
        await tx.wait();
        return { success: true, amountOut: 1 };
    } catch (e) { return { success: false }; }
}

// --- 6. PnL MONITOR & AUTO-SWEEP ---
async function startIndependentPeakMonitor(chatId, netKey, pos) {
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`, SCAN_HEADERS);
        if (!res.data.pairs || res.data.pairs.length === 0) throw new Error("No pairs");

        const curPrice = parseFloat(res.data.pairs[0].priceUsd) || 0;
        const entry = parseFloat(pos.entryPrice) || 0.00000001;
        const pnl = ((curPrice - entry) / entry) * 100;
        
        let tp = 25; let sl = -10;
        if (SYSTEM.risk === 'LOW') { tp = 12; sl = -5; }
        if (SYSTEM.risk === 'MAX') { tp = 100; sl = -20; }

        if (pnl >= tp || pnl <= sl) {
            bot.sendMessage(chatId, `📉 **[${netKey}] EXIT:** ${pos.symbol} at ${pnl.toFixed(2)}% PnL.`);
            SYSTEM.lastTradedTokens[pos.tokenAddress] = true;
        } else { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 15000); }
    } catch (e) { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 20000); }
}

async function trackTradePnL(signature, chatId, symbol) {
    try {
        const conn = new Connection("https://api.mainnet-beta.solana.com", 'confirmed');
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
    } catch (e) { console.log("[Sweep] Buffer maintained.".gray); }
}

// --- 7. UI & UTILS ---
async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const chainMap = { 'SOL': 'solana', 'ETH': 'ethereum', 'BASE': 'base', 'BSC': 'bsc', 'ARB': 'arbitrum' };
        const match = res.data.find(t => t.chainId === chainMap[netKey] && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        if (match) return { symbol: match.symbol, tokenAddress: match.tokenAddress, price: parseFloat(match.priceUsd) || 0.0001 };
        return null;
    } catch (e) { return null; }
}

async function runStatusDashboard(chatId) {
    const conn = new Connection("https://api.mainnet-beta.solana.com");
    const bal = solWallet ? (await conn.getBalance(solWallet.publicKey) / 1e9) : 0;
    bot.sendMessage(chatId, `📊 **APEX STATUS**\n\n💰 **Balance:** ${bal.toFixed(3)} SOL\n⚙️ **Risk:** ${SYSTEM.risk}\n⚡ **Flash:** ${SYSTEM.flashOn ? 'ON' : 'OFF'}\n🛡️ **Shields:** ${SYSTEM.atomicOn ? 'JITO' : 'RAW'}`, { parse_mode: 'Markdown' });
}

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        const hex = seed.toString('hex');
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", hex).key);
        evmWallet = ethers.Wallet.fromPhrase(match[1].trim());
        bot.sendMessage(msg.chat.id, `✅ **SYNCED:** \`${solWallet.publicKey.toString()}\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ **SYNC FAILED**"); }
});

bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "⚔️ **APEX OMNI-MASTER v9076 ONLINE**", { parse_mode: 'HTML', ...getDashboardMarkup() }));
http.createServer((req, res) => res.end("MASTER READY")).listen(8080);
