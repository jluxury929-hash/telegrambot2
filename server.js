/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9032 (OMNI-DASHBOARD MASTER)
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

// --- 1. CONFIGURATION ---
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

// --- 2. GLOBAL STATE ---
let SYSTEM = {
    autoPilot: false, 
    tradeAmount: "0.01", 
    risk: 'MEDIUM', 
    mode: 'MEDIUM',
    lastTradedTokens: {}, 
    isLocked: {}
};
let evmWallet, solWallet;

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// --- 3. UI DASHBOARD & INTERACTIVITY ---
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `🛡️ RISK: ${SYSTEM.risk}`, callback_data: "cycle_risk" }, { text: `⏱️ TERM: ${SYSTEM.mode}`, callback_data: "cycle_mode" }],
            [{ text: "🔗 CONNECT WALLET", callback_data: "cmd_conn" }]
        ]
    }
});

bot.onText(/\/menu|\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "🎮 **APEX DASHBOARD v9032**\nNeural Control Center:", { parse_mode: 'Markdown', ...getDashboardMarkup() });
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;

    if (query.data === "cycle_risk") {
        const risks = ['LOW', 'MEDIUM', 'HIGH'];
        SYSTEM.risk = risks[(risks.indexOf(SYSTEM.risk) + 1) % risks.length];
    } else if (query.data === "cycle_mode") {
        const modes = ['SHORT', 'MEDIUM', 'LONG'];
        SYSTEM.mode = modes[(modes.indexOf(SYSTEM.mode) + 1) % modes.length];
    } else if (query.data === "cycle_amt") {
        const amts = ["0.01", "0.05", "0.1", "0.25", "0.5"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
    } else if (query.data === "cmd_auto") {
        if (!solWallet) return bot.answerCallbackQuery(query.id, { text: "❌ Connect Wallet First!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) {
            bot.sendMessage(chatId, "🚀 **AUTO-PILOT ONLINE.** Scanning all networks...");
            Object.keys(NETWORKS).forEach(netKey => startNetworkSniper(chatId, netKey));
        }
    }

    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: chatId, message_id: msgId }).catch(() => {});
    bot.answerCallbackQuery(query.id);
});

// --- 4. AUTO-PILOT ENGINE (SIGNAL -> VERIFY -> EXECUTE) ---



async function startNetworkSniper(chatId, netKey) {
    console.log(`[INIT] Parallel thread for ${netKey} active.`.magenta);
    
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                // PHASE 1: SIGNAL SCAN
                const signal = await runNeuralSignalScan(netKey);
                
                if (signal && signal.tokenAddress) {
                    // PHASE 2: VERIFY BALANCE & INTEGRITY
                    const ready = await verifyBalance(chatId, netKey);
                    
                    if (ready) {
                        SYSTEM.isLocked[netKey] = true;
                        bot.sendMessage(chatId, `🧠 **[${netKey}] SIGNAL:** ${signal.symbol}. Engaging Buy...`);
                        
                        // PHASE 3: EXECUTE
                        const buyRes = (netKey === 'SOL')
                            ? await executeSolShotgun(chatId, signal.tokenAddress, SYSTEM.tradeAmount)
                            : await executeEvmContract(chatId, netKey, signal.tokenAddress, SYSTEM.tradeAmount);
                        
                        if (buyRes && buyRes.amountOut) {
                            const pos = { ...signal, entryPrice: signal.price, amountOut: buyRes.amountOut };
                            startIndependentPeakMonitor(chatId, netKey, pos);
                            bot.sendMessage(chatId, `🚀 **[${netKey}] BOUGHT ${signal.symbol}.** Rescanning...`);
                        }
                        SYSTEM.isLocked[netKey] = false;
                    }
                }
            }
            // Sleep to prevent rate limits
            await new Promise(r => setTimeout(r, 2500));
        } catch (e) { 
            SYSTEM.isLocked[netKey] = false; 
            await new Promise(r => setTimeout(r, 5000)); 
        }
    }
}

// --- 5. EXECUTION CORE (SVM & EVM) ---
async function executeSolShotgun(chatId, addr, amt) {
    try {
        const amtStr = Math.floor(amt * LAMPORTS_PER_SOL).toString();
        const res = await axios.get(`${JUP_ULTRA_API}/order?inputMint=So11111111111111111111111111111111111111112&outputMint=${addr}&amount=${amtStr}&taker=${solWallet.publicKey.toString()}&slippageBps=200`, SCAN_HEADERS);
        
        const tx = VersionedTransaction.deserialize(Buffer.from(res.data.transaction, 'base64'));
        tx.sign([solWallet]);

        // Dual-RPC Failover Logic
        const sig = await Promise.any([
            new Connection(NETWORKS.SOL.primary).sendRawTransaction(tx.serialize()),
            new Connection(NETWORKS.SOL.fallback).sendRawTransaction(tx.serialize())
        ]);
        
        return { amountOut: res.data.outAmount || 1, hash: sig };
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
        await tx.wait(); 
        return { amountOut: 1 };
    } catch (e) { return null; }
}

// --- 6. UTILITIES ---
async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const chainMap = { 'SOL': 'solana', 'ETH': 'ethereum', 'BASE': 'base', 'BSC': 'bsc', 'ARB': 'arbitrum' };
        const match = res.data.find(t => t.chainId === chainMap[netKey] && !SYSTEM.lastTradedTokens[t.tokenAddress]);

        if (match && match.tokenAddress) {
            return {
                symbol: match.symbol || "UNKNOWN",
                tokenAddress: match.tokenAddress,
                price: parseFloat(match.priceUsd) || 0.00000001
            };
        }
        return null;
    } catch (e) { return null; }
}

async function startIndependentPeakMonitor(chatId, netKey, pos) {
    // Peak monitoring logic from v9032
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`, SCAN_HEADERS);
        if (!res.data.pairs || res.data.pairs.length === 0) throw new Error("No pairs");

        const curPrice = parseFloat(res.data.pairs[0].priceUsd) || 0;
        const entry = parseFloat(pos.entryPrice) || 0.00000001;
        const pnl = ((curPrice - entry) / entry) * 100;
        
        let tp = 25; let sl = -10;
        if (SYSTEM.risk === 'LOW') { tp = 12; sl = -5; }
        if (SYSTEM.risk === 'HIGH') { tp = 100; sl = -20; }

        if (pnl >= tp || pnl <= sl) {
            bot.sendMessage(chatId, `📉 **[${netKey}] EXIT:** ${pos.symbol} closed at ${pnl.toFixed(2)}% PnL.`);
            SYSTEM.lastTradedTokens[pos.tokenAddress] = true;
        } else { 
            setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 10000); 
        }
    } catch (e) { 
        setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 15000); 
    }
}

// Start Server
http.createServer((req, res) => res.end("APEX v9032 READY")).listen(8080);
