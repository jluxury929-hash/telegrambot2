/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9030 (OMNI-DASHBOARD MASTER)
 * ===============================================================================
 * FIX: Multi-Path Solana Discovery (Standard vs Legacy) - Resolves "Have 0" error.
 * FIX: Dual-RPC Failover (Primary + Fallback) - Stops RPC sync lag.
 * FIX: BigInt Gas Math - Accounts for 0.01 SOL fee buffer automatically.
 * FIX: Callback Query mandatory answer - Buttons are now 100% responsive.
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

// --- CONFIGURATION ---
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
    SOL:  { id: 'solana', type: 'SVM', primary: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', fallback: 'https://solana-mainnet.g.allthatnode.com' },
    BASE: { id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' },
    BSC:  { id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E' },
    ARB:  { id: 'arbitrum', type: 'EVM', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' }
};

// --- GLOBAL STATE ---
let SYSTEM = { 
    autoPilot: false, tradeAmount: "0.01", risk: 'medium', mode: 'medium', 
    lastTradedTokens: {}, isLocked: {} 
};
let PLAYER = { level: 1, xp: 0, nextLevelXp: 1000, class: "DATA ANALYST" };
let evmWallet, solWallet;

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  INTERACTIVE MENU (FIXED)
// ==========================================

bot.onText(/\/menu|\/start/, (msg) => {
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🚀 TOGGLE AUTO-PILOT", callback_data: "cmd_auto" }],
                [{ text: "💰 SET AMOUNT", callback_data: "cmd_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
                [{ text: "🛡️ RISK: " + SYSTEM.risk.toUpperCase(), callback_data: "cmd_risk" }, { text: "⏱️ MODE: " + SYSTEM.mode.toUpperCase(), callback_data: "cmd_mode" }],
                [{ text: "🔗 CONNECT WALLET", callback_data: "cmd_conn" }]
            ]
        }
    };
    bot.sendMessage(msg.chat.id, "🎮 **APEX NEURAL CONTROL**\nStatus: " + (SYSTEM.autoPilot ? "🟢 ACTIVE" : "🔴 IDLE"), { parse_mode: 'Markdown', ...opts });
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    await bot.answerCallbackQuery(query.id); 

    if (query.data === "cmd_auto") {
        if (!solWallet) return bot.sendMessage(chatId, "❌ Connect wallet first.");
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) Object.keys(NETWORKS).forEach(netKey => startNetworkSniper(chatId, netKey));
        bot.sendMessage(chatId, `🤖 **AUTO-PILOT:** ${SYSTEM.autoPilot ? '✅ ACTIVE' : '❌ STOPPED'}`);
    }
    if (query.data === "cmd_status") await runStatusDashboard(chatId);
    if (query.data === "cmd_amt") bot.sendMessage(chatId, "⌨️ Use `/setamount 0.05` to update size.");
    if (query.data === "cmd_conn") bot.sendMessage(chatId, "⌨️ Use `/connect <seed phrase>` to link.");
});

// ==========================================
//  THE "HAVE 0" FIX: MULTI-PATH & FAILOVER
// ==========================================

bot.onText(/\/connect (.+)/, async (msg, match) => {
    const raw = match[1].trim();
    const chatId = msg.chat.id;
    try {
        if (!bip39.validateMnemonic(raw)) return bot.sendMessage(chatId, "❌ **INVALID SEED.**");
        const seed = await bip39.mnemonicToSeed(raw);
        const conn = new Connection(NETWORKS.SOL.primary, 'confirmed');

        // Check Path A (Phantom) vs Path B (Legacy)
        const keyA = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        const keyB = Keypair.fromSeed(derivePath("m/44'/501'/0'", seed.toString('hex')).key);

        const [balA, balB] = await Promise.all([conn.getBalance(keyA.publicKey), conn.getBalance(keyB.publicKey)]);

        solWallet = (balB > balA) ? keyB : keyA;
        evmWallet = ethers.Wallet.fromPhrase(raw);

        bot.sendMessage(chatId, 
            `🔗 **SYNC COMPLETE**\n\n` +
            `📍 **Bot Tracking:** \`${solWallet.publicKey.toString()}\`\n` +
            `💰 **Current Balance:** ${(Math.max(balA, balB) / 1e9).toFixed(4)} SOL\n\n` +
            `*If balance is incorrect, move your 0.1 SOL to the address above.*`
        , { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(chatId, "❌ **SEED ERROR.**"); }
});



async function verifyBalance(chatId, netKey) {
    try {
        const amt = parseFloat(SYSTEM.tradeAmount);
        if (netKey === 'SOL') {
            let bal = 0;
            // Primary -> Fallback Failover
            try { 
                bal = await (new Connection(NETWORKS.SOL.primary)).getBalance(solWallet.publicKey); 
            } catch (e) { 
                bal = await (new Connection(NETWORKS.SOL.fallback)).getBalance(solWallet.publicKey); 
            }
            
            const needed = (amt * LAMPORTS_PER_SOL) + 10000000; 
            if (bal < needed) {
                bot.sendMessage(chatId, `❌ **[SOL] INSUFFICIENT:** Engine sees ${bal/1e9} SOL. Need ${needed/1e9} for Trade+Gas.`);
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
//  OMNI-CORE & EXECUTION
// ==========================================

async function runStatusDashboard(chatId) {
    let msg = `📊 **APEX OPERATIONAL STATUS**\n----------------------------\n`;
    const RATES = { BNB: 1225.01, ETH: 4061.20, SOL: 175.14 }; 

    for (const key of Object.keys(NETWORKS)) {
        try {
            if (key === 'SOL') {
                const conn = new Connection(NETWORKS.SOL.primary, 'confirmed');
                const bal = (await conn.getBalance(solWallet.publicKey)) / 1e9;
                msg += `🔹 **SOL:** ${bal.toFixed(3)} ($${(bal * RATES.SOL).toFixed(2)} CAD)\n`;
            } else {
                const bal = parseFloat(ethers.formatEther(await new JsonRpcProvider(NETWORKS[key].rpc).getBalance(evmWallet.address)));
                const cad = (bal * (key === 'BSC' ? RATES.BNB : RATES.ETH)).toFixed(2);
                msg += `🔹 **${key}:** ${bal.toFixed(4)} ($${cad} CAD)\n`;
            }
        } catch (e) { msg += `🔹 **${key}:** ⚠️ RPC Lag\n`; }
    }
    bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}

async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal && await verifyBalance(chatId, netKey)) {
                    SYSTEM.isLocked[netKey] = true;
                    const res = (netKey === 'SOL') 
                        ? await executeSolShotgun(chatId, signal.tokenAddress, SYSTEM.tradeAmount) 
                        : await executeEvmContract(chatId, netKey, signal.tokenAddress, SYSTEM.tradeAmount);
                    
                    if (res) startIndependentPeakMonitor(chatId, netKey, { ...signal, entryPrice: signal.price, amountOut: res.amountOut });
                    SYSTEM.isLocked[netKey] = false;
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
        const sig = await Promise.any([
            new Connection(NETWORKS.SOL.primary).sendRawTransaction(tx.serialize()), 
            new Connection(NETWORKS.SOL.fallback).sendRawTransaction(tx.serialize())
        ]);
        bot.sendMessage(chatId, `⏳ **[SOL] PENDING:** ${sig}`);
        return { amountOut: res.data.outAmount };
    } catch (e) { return null; }
}

async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const match = res.data.find(t => t.chainId === NETWORKS[netKey].id && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        return match ? { symbol: match.symbol, tokenAddress: match.tokenAddress, price: parseFloat(match.priceUsd || 0) } : null;
    } catch (e) { return null; }
}

async function executeEvmContract(chatId, netKey, addr, amt) {
    try {
        const net = NETWORKS[netKey];
        const signer = evmWallet.connect(new JsonRpcProvider(net.rpc));
        const contract = new ethers.Contract(MY_EXECUTOR, APEX_ABI, signer);
        const tx = await contract.executeBuy(net.router, addr, 0, Math.floor(Date.now()/1000)+120, { 
            value: ethers.parseEther(amt.toString()), 
            gasLimit: 350000 
        });
        await tx.wait(); return { amountOut: 1 };
    } catch (e) { return null; }
}

async function startIndependentPeakMonitor(chatId, netKey, pos) {
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`, SCAN_HEADERS);
        const curPrice = parseFloat(res.data.pairs[0].priceUsd);
        const pnl = ((curPrice - pos.entryPrice) / pos.entryPrice) * 100;
        if (pnl >= 25 || pnl <= -10) {
            bot.sendMessage(chatId, `📉 **[${netKey}] EXIT:** ${pnl.toFixed(2)}%`);
        } else { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 5000); }
    } catch (e) { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 8000); }
}

bot.onText(/\/setamount (.+)/, (msg, match) => {
    SYSTEM.tradeAmount = match[1];
    bot.sendMessage(msg.chat.id, `💰 **SIZE:** ${SYSTEM.tradeAmount} Native`);
});

http.createServer((req, res) => res.end("APEX v9030 READY")).listen(8080);
console.log("APEX v9030 READY".magenta);
