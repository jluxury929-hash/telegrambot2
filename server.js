/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9025 (OMNI-DASHBOARD MASTER)
 * ===============================================================================
 * ARCH: 5-Chain Parallel Sniping | Unified Strategy Interface
 * FIX: Polling Conflict Guard | Mnemonic Length Validation
 * FEATURES: /menu dashboard | CAD Balances | /risk & /mode Logic
 * EVM MASTER CONTRACT: 0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- CONSTANTS ---
const MY_EXECUTOR = "0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610";
const APEX_ABI = [
    "function executeBuy(address router, address token, uint256 minOut, uint256 deadline) external payable",
    "function executeSell(address router, address token, uint256 amtIn, uint256 minOut, uint256 deadline) external",
    "function emergencyWithdraw(address token) external"
];
const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";
const JUP_API_KEY = "f440d4df-b5c4-4020-a960-ac182d3752ab"; 
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'x-api-key': JUP_API_KEY }};

const NETWORKS = {
    ETH:  { id: 'ethereum', type: 'EVM', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' },
    SOL:  { id: 'solana', type: 'SVM', rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com' },
    BASE: { id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' },
    BSC:  { id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E' },
    ARB:  { id: 'arbitrum', type: 'EVM', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' }
};

// --- GLOBAL STATE ---
let SYSTEM = { 
    autoPilot: false, tradeAmount: "0.01", risk: 'medium', mode: 'medium', 
    lastTradedTokens: {}, isLocked: {} 
};
let evmWallet, solWallet;

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
bot.on('polling_error', (err) => { if(err.code === 'ETELEGRAM' && err.message.includes('409')) console.log("⚠️ Conflict: Multiple instances detected.".yellow); });

// ==========================================
//  INTERACTIVE MENU (DASHBOARD UI)
// ==========================================

bot.onText(/\/menu|\/start/, (msg) => {
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🚀 TOGGLE AUTO-PILOT", callback_data: "toggle_auto" }],
                [{ text: "💰 SET AMOUNT", callback_data: "ui_set_amt" }, { text: "📊 BALANCE/STATUS", callback_data: "ui_status" }],
                [{ text: "🛡️ RISK: " + SYSTEM.risk.toUpperCase(), callback_data: "ui_risk" }, { text: "⏱️ MODE: " + SYSTEM.mode.toUpperCase(), callback_data: "ui_mode" }],
                [{ text: "🔗 CONNECT WALLET", callback_data: "ui_connect" }]
            ]
        }
    };
    bot.sendMessage(msg.chat.id, "🎮 **APEX NEURAL CONTROL**\nAuto-Pilot: " + (SYSTEM.autoPilot ? "✅" : "❌"), { parse_mode: 'Markdown', ...opts });
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data === "toggle_auto") {
        if (!evmWallet) return bot.answerCallbackQuery(query.id, { text: "Connect wallet first!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) Object.keys(NETWORKS).forEach(netKey => startNetworkSniper(chatId, netKey));
        bot.sendMessage(chatId, `🤖 **AUTO-PILOT:** ${SYSTEM.autoPilot ? '✅ ACTIVE' : '❌ STOPPED'}`);
    }
    if (data === "ui_status") {
        bot.answerCallbackQuery(query.id);
        await runStatusDashboard(chatId);
    }
    bot.answerCallbackQuery(query.id);
});

// ==========================================
//  CAD DASHBOARD LOGIC (JAN 2026 PRICES)
// ==========================================

async function runStatusDashboard(chatId) {
    let msg = `📊 **APEX OPERATIONAL STATUS**\n----------------------------\n`;
    msg += `🛡️ **RISK:** ${SYSTEM.risk.toUpperCase()} | ⏱️ **MODE:** ${SYSTEM.mode.toUpperCase()}\n`;
    msg += `💵 **TRADE SIZE:** ${SYSTEM.tradeAmount} Native\n\n🛰️ **NETWORKS (CAD):**\n`;

    const RATES = { BNB: 1225.01, ETH: 4061.20, SOL: 175.14 }; // Snapshot Jan 24, 2026

    for (const key of Object.keys(NETWORKS)) {
        try {
            if (key === 'SOL') {
                const bal = (await new Connection(NETWORKS.SOL.rpc).getBalance(solWallet.publicKey)) / 1e9;
                msg += `🔹 **SOL:** ${bal.toFixed(3)} ($${(bal * RATES.SOL).toFixed(2)} CAD)\n`;
            } else {
                const rawBal = await new JsonRpcProvider(NETWORKS[key].rpc).getBalance(evmWallet.address);
                const bal = parseFloat(ethers.formatEther(rawBal));
                const sym = key === 'BSC' ? 'BNB' : 'ETH';
                const cad = (bal * (sym === 'BNB' ? RATES.BNB : RATES.ETH)).toFixed(2);
                msg += `🔹 **${key}:** ${bal.toFixed(4)} ${sym} ($${cad} CAD)\n`;
            }
        } catch (e) { msg += `🔹 **${key}:** ⚠️ RPC Lag\n`; }
    }
    bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}

// ==========================================
//  OMNI-ENGINE WORKERS (PARALLEL)
// ==========================================

async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal) {
                    const ready = await verifyBalance(chatId, netKey);
                    if (!ready) { await new Promise(r => setTimeout(r, 15000)); continue; }

                    SYSTEM.isLocked[netKey] = true;
                    const buyRes = (netKey === 'SOL') 
                        ? await executeSolanaShotgun(chatId, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY')
                        : await executeEvmContract(chatId, netKey, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY');

                    if (buyRes) {
                        const newPos = { ...signal, entryPrice: signal.price, highestPrice: signal.price, amountOut: buyRes.amountOut };
                        startIndependentPeakMonitor(chatId, netKey, newPos);
                        bot.sendMessage(chatId, `🚀 **[${netKey}] Sniped ${signal.symbol}.**`);
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 5000)); }
    }
}

// ==========================================
//  STRATEGY MONITORING (EXIT LOGIC)
// ==========================================

function getStrategyParams() {
    let p = { tp: 25, sl: -10, trail: 6 };
    if (SYSTEM.risk === 'low') { p.tp = 12; p.sl = -5; }
    if (SYSTEM.risk === 'high') { p.tp = 100; p.sl = -20; }
    if (SYSTEM.mode === 'short') p.trail = 3;
    if (SYSTEM.mode === 'long') p.trail = 15;
    return p;
}

async function startIndependentPeakMonitor(chatId, netKey, pos) {
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`, SCAN_HEADERS);
        const curPrice = parseFloat(res.data.pairs[0].priceUsd);
        const pnl = ((curPrice - pos.entryPrice) / pos.entryPrice) * 100;
        if (curPrice > pos.highestPrice) pos.highestPrice = curPrice;
        const drop = ((pos.highestPrice - curPrice) / pos.highestPrice) * 100;
        const strat = getStrategyParams();

        if (pnl >= strat.tp || drop >= strat.trail || pnl <= strat.sl) {
            bot.sendMessage(chatId, `📉 **[${netKey}] EXIT:** ${pos.symbol} at ${pnl.toFixed(2)}%`);
            const sold = (netKey === 'SOL') 
                ? await executeSolanaShotgun(chatId, pos.tokenAddress, pos.amountOut, 'SELL')
                : await executeEvmContract(chatId, netKey, pos.tokenAddress, pos.amountOut, 'SELL');
            if (sold) SYSTEM.lastTradedTokens[pos.tokenAddress] = true;
        } else { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 5000); }
    } catch(e) { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 8000); }
}

// ==========================================
//  DIAGNOSTICS & EXECUTION
// ==========================================

async function verifyBalance(chatId, netKey) {
    try {
        if (netKey === 'SOL') {
            const bal = await (new Connection(NETWORKS.SOL.rpc)).getBalance(solWallet.publicKey);
            const needed = (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 10000000; 
            if (bal < needed) { bot.sendMessage(chatId, `⚠️ **[SOL] Low Balance.** Need ~${needed/1e9} SOL.`); return false; }
        } else {
            const bal = await (new JsonRpcProvider(NETWORKS[netKey].rpc)).getBalance(evmWallet.address);
            const needed = ethers.parseEther(SYSTEM.tradeAmount) + ethers.parseEther("0.005");
            if (bal < needed) { bot.sendMessage(chatId, `⚠️ **[${netKey}] Low Balance.** Need gas buffer.`); return false; }
        }
        return true;
    } catch (e) { return false; }
}

async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const match = res.data.find(t => t.chainId === NETWORKS[netKey].id && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        return match ? { symbol: match.symbol, tokenAddress: match.tokenAddress, price: parseFloat(match.priceUsd || 0) } : null;
    } catch (e) { return null; }
}

async function executeEvmContract(chatId, netKey, addr, amt, dir) {
    try {
        const net = NETWORKS[netKey];
        const signer = evmWallet.connect(new JsonRpcProvider(net.rpc));
        const contract = new ethers.Contract(MY_EXECUTOR, APEX_ABI, signer);
        const tx = dir === 'BUY' 
            ? await contract.executeBuy(net.router, addr, 0, Math.floor(Date.now()/1000)+120, { value: ethers.parseEther(amt.toString()), gasLimit: 350000 })
            : await contract.executeSell(net.router, addr, amt, 0, Math.floor(Date.now()/1000)+120, { gasLimit: 400000 });
        bot.sendMessage(chatId, `⏳ **[${netKey}] PENDING:** ${tx.hash}`);
        await tx.wait(); return { amountOut: 1 };
    } catch (e) { bot.sendMessage(chatId, `❌ **[${netKey}] FAIL:** ${e.message}`); return null; }
}

async function executeSolanaShotgun(chatId, addr, amt, dir) {
    try {
        const amtStr = dir === 'BUY' ? Math.floor(amt * LAMPORTS_PER_SOL).toString() : amt.toString();
        const res = await axios.get(`${JUP_ULTRA_API}/order?inputMint=So11111111111111111111111111111111111111112&outputMint=${addr}&amount=${amtStr}&taker=${solWallet.publicKey.toString()}&slippageBps=200`, SCAN_HEADERS);
        const tx = VersionedTransaction.deserialize(Buffer.from(res.data.transaction, 'base64'));
        tx.sign([solWallet]);
        const sig = await (new Connection(NETWORKS.SOL.rpc)).sendRawTransaction(tx.serialize(), { skipPreflight: true });
        bot.sendMessage(chatId, `⏳ **[SOL] PENDING:** ${sig}`);
        return { amountOut: res.data.outAmount, hash: sig };
    } catch (e) { bot.sendMessage(chatId, `❌ **[SOL] FAIL:** ${e.message}`); return null; }
}

// ==========================================
//  COMMANDS: CONNECT & WITHDRAW
// ==========================================

bot.onText(/\/connect (.+)/, async (msg, match) => {
    const raw = match[1].trim();
    try {
        if (!bip39.validateMnemonic(raw)) return bot.sendMessage(msg.chat.id, "❌ **INVALID SEED.**");
        evmWallet = ethers.HDNodeWallet.fromPhrase(raw);
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", (await bip39.mnemonicToSeed(raw)).toString('hex')).key);
        bot.sendMessage(msg.chat.id, `🔗 **NEURAL LINK SECURE.** Use /menu.`);
    } catch (e) { bot.sendMessage(msg.chat.id, `❌ **ERROR.**`); }
});

bot.onText(/\/setamount (.+)/, (msg, match) => {
    SYSTEM.tradeAmount = match[1];
    bot.sendMessage(msg.chat.id, `💰 **SIZE:** ${SYSTEM.tradeAmount} Native`);
});

http.createServer((req, res) => res.end("APEX v9025 ONLINE")).listen(8080);
console.log("APEX v9025 OMNI-MASTER READY".magenta);
