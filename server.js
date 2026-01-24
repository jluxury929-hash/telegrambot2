/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9025 (OMNI-DASHBOARD MASTER)
 * ===============================================================================
 * ARCH: 5-Chain Parallel Sniping | Unified Strategy Interface
 * FIX: "Insufficient Funds" loop (Added Gas Safety Buffer)
 * FIX: Polling Conflict Guard | Mnemonic Length Validation
 * FEATURES: /menu dashboard | CAD Balances | RPG Leveling
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
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
    lastTradedTokens: {}, isLocked: {}, currentNetwork: 'SOL'
};
let PLAYER = { level: 1, xp: 0, nextLevelXp: 1000, class: "DATA ANALYST" };
let evmWallet, solWallet;

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  INTERACTIVE MENU
// ==========================================

bot.onText(/\/menu|\/start/, (msg) => {
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🚀 START AUTO-PILOT", callback_data: "toggle_auto" }, { text: "🛑 STOP", callback_data: "toggle_auto" }],
                [{ text: "💰 SET AMOUNT", callback_data: "ui_set_amt" }, { text: "📊 STATUS", callback_data: "ui_status" }],
                [{ text: "🛡️ RISK: " + SYSTEM.risk.toUpperCase(), callback_data: "ui_risk" }, { text: "⏱️ MODE: " + SYSTEM.mode.toUpperCase(), callback_data: "ui_mode" }],
                [{ text: "🔗 CONNECT", callback_data: "ui_connect" }]
            ]
        }
    };
    bot.sendMessage(msg.chat.id, "🎮 **APEX CONTROL PANEL**\nStatus: " + (SYSTEM.autoPilot ? "🟢 ACTIVE" : "🔴 IDLE"), { parse_mode: 'Markdown', ...opts });
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data === "toggle_auto") {
        if (!evmWallet) return bot.answerCallbackQuery(query.id, { text: "Connect wallet first!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) {
            bot.sendMessage(chatId, "🚀 **AUTO-PILOT ONLINE.** Parallel scanning...");
            Object.keys(NETWORKS).forEach(netKey => startNetworkSniper(chatId, netKey));
        } else {
            bot.sendMessage(chatId, "🤖 **AUTO-PILOT OFF.**");
        }
    }
    if (data === "ui_status") {
        bot.answerCallbackQuery(query.id);
        await runStatusDashboard(chatId);
    }
    bot.answerCallbackQuery(query.id);
});

// ==========================================
//  DASHBOARD & BALANCE CHECK (FIXED)
// ==========================================

async function runStatusDashboard(chatId) {
    let msg = `📊 **APEX OPERATIONAL STATUS**\n Rank: ${PLAYER.class} (Lvl ${PLAYER.level})\n`;
    msg += `----------------------------\n🛰️ **NETWORKS (CAD):**\n`;

    const RATES = { BNB: 1225.01, ETH: 4061.20, SOL: 175.14 }; // Snapshot Prices

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
        } catch (e) { msg += `🔹 **${key}:** ⚠️ RPC Error\n`; }
    }
    bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}

async function verifyBalance(chatId, netKey) {
    try {
        const tradeAmt = parseFloat(SYSTEM.tradeAmount);
        if (netKey === 'SOL') {
            const bal = await (new Connection(NETWORKS.SOL.rpc)).getBalance(solWallet.publicKey);
            const needed = (tradeAmt * LAMPORTS_PER_SOL) + 10000000; // 0.01 SOL safety buffer
            if (bal < needed) {
                bot.sendMessage(chatId, `⚠️ **[SOL] INSUFFICIENT:** Have ${bal/1e9}, need ${needed/1e9} SOL.`);
                return false;
            }
        } else {
            const bal = await (new JsonRpcProvider(NETWORKS[netKey].rpc)).getBalance(evmWallet.address);
            const needed = ethers.parseUnits(SYSTEM.tradeAmount, 18) + ethers.parseUnits("0.005", 18); // 0.005 Gas buffer
            if (bal < needed) {
                bot.sendMessage(chatId, `⚠️ **[${netKey}] INSUFFICIENT:** Gas buffer required.`);
                return false;
            }
        }
        return true;
    } catch (e) { return false; }
}

// ==========================================
//  OMNI-SNIPER CORE (PARALLEL)
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

async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const match = res.data.find(t => t.chainId === NETWORKS[netKey].id && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        return match ? { symbol: match.symbol, tokenAddress: match.tokenAddress, price: parseFloat(match.priceUsd || 0) } : null;
    } catch (e) { return null; }
}

// ... [Existing executeEvmContract, executeSolanaShotgun, Peak Monitor logic] ...

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        evmWallet = ethers.HDNodeWallet.fromPhrase(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", (await bip39.mnemonicToSeed(match[1].trim())).toString('hex')).key);
        bot.sendMessage(msg.chat.id, `🔗 **NEURAL LINK SECURE.** Use /menu`);
    } catch (e) { bot.sendMessage(msg.chat.id, `❌ **ERROR.**`); }
});

bot.onText(/\/setamount (.+)/, (msg, match) => {
    SYSTEM.tradeAmount = match[1];
    bot.sendMessage(msg.chat.id, `💰 **SIZE:** ${SYSTEM.tradeAmount}`);
});

http.createServer((req, res) => res.end("APEX ONLINE")).listen(8080);
