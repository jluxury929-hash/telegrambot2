/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9029 (OMNI-DASHBOARD MASTER)
 * ===============================================================================
 * FIX: Native BigInt math for gas buffers (No more "Have 0" false positives).
 * FIX: Button unresponsiveness (Mandatory answerCallbackQuery integration).
 * FIX: Solana Failover (Primary + Fallback RPC logic).
 * FEATURES: Persistent /menu | CAD Dashboard | 24/7 Parallel Workers.
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
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'x-api-key': 'f440d4df-b5c4-4020-a960-ac182d3752ab' }};

const NETWORKS = {
    ETH:  { id: 'ethereum', type: 'EVM', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' },
    SOL:  { id: 'solana', type: 'SVM', primary: 'https://api.mainnet-beta.solana.com', fallback: 'https://solana-mainnet.g.allthatnode.com' },
    BASE: { id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' },
    BSC:  { id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E' },
    ARB:  { id: 'arbitrum', type: 'EVM', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' }
};

// --- STATE ---
let SYSTEM = { autoPilot: false, tradeAmount: "0.01", risk: 'medium', mode: 'medium', lastTradedTokens: {}, isLocked: {} };
let PLAYER = { level: 1, xp: 0, nextLevelXp: 1000, class: "DATA ANALYST" };
let evmWallet, solWallet;

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  MENU & BUTTON LOGIC (FIXED)
// ==========================================

bot.onText(/\/menu|\/start/, (msg) => {
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🚀 TOGGLE AUTO-PILOT", callback_data: "cmd_auto" }],
                [{ text: "💰 SET AMOUNT", callback_data: "cmd_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
                [{ text: "🛡️ RISK: " + SYSTEM.risk.toUpperCase(), callback_data: "cmd_risk" }, { text: "⏱️ MODE: " + SYSTEM.mode.toUpperCase(), callback_data: "cmd_mode" }],
                [{ text: "🔗 CONNECT", callback_data: "cmd_conn" }]
            ]
        }
    };
    bot.sendMessage(msg.chat.id, "🎮 **APEX NEURAL CONTROL**\nStatus: " + (SYSTEM.autoPilot ? "🟢 ACTIVE" : "🔴 IDLE"), { parse_mode: 'Markdown', ...opts });
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    await bot.answerCallbackQuery(query.id); // FIXED: Clears the button loading state

    switch (query.data) {
        case "cmd_auto":
            if (!solWallet) return bot.sendMessage(chatId, "❌ Connect wallet first.");
            SYSTEM.autoPilot = !SYSTEM.autoPilot;
            if (SYSTEM.autoPilot) Object.keys(NETWORKS).forEach(netKey => startNetworkSniper(chatId, netKey));
            bot.sendMessage(chatId, `🤖 **AUTO-PILOT:** ${SYSTEM.autoPilot ? '✅ ACTIVE' : '❌ STOPPED'}`);
            break;
        case "cmd_status":
            await runStatusDashboard(chatId);
            break;
        case "cmd_amt":
            bot.sendMessage(chatId, "⌨️ Type `/setamount 0.05` to update.");
            break;
    }
});

// ==========================================
//  DIAGNOSTICS: BALANCE REDUNDANCY
// ==========================================

async function runStatusDashboard(chatId) {
    let msg = `📊 **APEX OPERATIONAL STATUS**\n Rank: ${PLAYER.class} (Lvl ${PLAYER.level})\n`;
    const RATES = { BNB: 1225.01, ETH: 4061.20, SOL: 175.14 }; 

    for (const key of Object.keys(NETWORKS)) {
        try {
            if (key === 'SOL') {
                const conn = new Connection(NETWORKS.SOL.primary, 'confirmed');
                const bal = (await conn.getBalance(solWallet.publicKey)) / 1e9;
                msg += `🔹 **SOL:** ${bal.toFixed(3)} ($${(bal * RATES.SOL).toFixed(2)} CAD)\n`;
            } else {
                const bal = parseFloat(ethers.formatEther(await new JsonRpcProvider(NETWORKS[key].rpc).getBalance(evmWallet.address)));
                const sym = key === 'BSC' ? 'BNB' : 'ETH';
                const cad = (bal * (sym === 'BNB' ? RATES.BNB : RATES.ETH)).toFixed(2);
                msg += `🔹 **${key}:** ${bal.toFixed(4)} ${sym} ($${cad} CAD)\n`;
            }
        } catch (e) { msg += `🔹 **${key}:** ⚠️ RPC Lag\n`; }
    }
    bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}

async function verifyBalance(chatId, netKey) {
    try {
        const amt = parseFloat(SYSTEM.tradeAmount);
        if (netKey === 'SOL') {
            let bal = 0;
            try { bal = await (new Connection(NETWORKS.SOL.primary)).getBalance(solWallet.publicKey); }
            catch (e) { bal = await (new Connection(NETWORKS.SOL.fallback)).getBalance(solWallet.publicKey); }
            
            const needed = (amt * LAMPORTS_PER_SOL) + 10000000; // Trade + 0.01 SOL buffer
            if (bal < needed) {
                bot.sendMessage(chatId, `❌ **[SOL] INSUFFICIENT:** Have ${bal/1e9}, need ${needed/1e9} SOL (Inc. Gas).`);
                return false;
            }
        } else {
            const bal = await (new JsonRpcProvider(NETWORKS[netKey].rpc)).getBalance(evmWallet.address);
            const needed = ethers.parseEther(SYSTEM.tradeAmount) + ethers.parseEther("0.006"); 
            if (bal < needed) return false;
        }
        return true;
    } catch (e) { return false; }
}

// ==========================================
//  OMNI-ENGINE WORKERS
// ==========================================

async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal) {
                    if (await verifyBalance(chatId, netKey)) {
                        SYSTEM.isLocked[netKey] = true;
                        const res = (netKey === 'SOL') ? await executeSolShotgun(chatId, signal.tokenAddress, SYSTEM.tradeAmount) : await executeEvmContract(chatId, netKey, signal.tokenAddress, SYSTEM.tradeAmount);
                        if (res) startIndependentPeakMonitor(chatId, netKey, { ...signal, entryPrice: signal.price, amountOut: res.amountOut });
                        SYSTEM.isLocked[netKey] = false;
                    }
                }
            }
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 5000)); }
    }
}

async function executeSolShotgun(chatId, addr, amt) {
    try {
        const res = await axios.get(`${JUP_ULTRA_API}/order?inputMint=So11111111111111111111111111111111111111112&outputMint=${addr}&amount=${Math.floor(amt * 1e9)}&taker=${solWallet.publicKey.toString()}&slippageBps=200`, SCAN_HEADERS);
        const tx = VersionedTransaction.deserialize(Buffer.from(res.data.transaction, 'base64'));
        tx.sign([solWallet]);
        const sig = await Promise.any([new Connection(NETWORKS.SOL.primary).sendRawTransaction(tx.serialize()), new Connection(NETWORKS.SOL.fallback).sendRawTransaction(tx.serialize())]);
        bot.sendMessage(chatId, `⏳ **[SOL] PENDING:** ${sig}`);
        return { amountOut: res.data.outAmount };
    } catch (e) { return null; }
}

// ... [Existing executeEvmContract, Peak Monitor, runNeuralSignalScan] ...

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const raw = match[1].trim();
        evmWallet = ethers.Wallet.fromPhrase(raw);
        const seed = await bip39.mnemonicToSeed(raw);
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.sendMessage(msg.chat.id, `🔗 **SYNCED:** \`${solWallet.publicKey.toString()}\``);
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ **SEED ERROR.**"); }
});

bot.onText(/\/setamount (.+)/, (msg, match) => {
    SYSTEM.tradeAmount = match[1];
    bot.sendMessage(msg.chat.id, `💰 **SIZE:** ${SYSTEM.tradeAmount}`);
});

http.createServer((req, res) => res.end("APEX v9029 ONLINE")).listen(8080);
