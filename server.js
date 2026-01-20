/**
 * ===============================================================================
 * ⚡ APEX TITAN v500.0 (HYBRID SINGULARITY)
 * ===============================================================================
 * A professional, interactive AI Trading Bot for Telegram.
 * * COMMANDS:
 * /start       - Initialize the bot
 * /auto        - Toggle between Manual (Safe) and Auto-Trade (Fast)
 * /setamount   - Set your trade size (e.g., /setamount 0.1)
 * /scan        - Force an AI scan right now
 * /wallet      - Check balance and settings
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const axios = require('axios');
const Sentiment = require('sentiment');
const fs = require('fs');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');
require('colors');

// ==========================================
// 1. CONFIGURATION & SAFETY
// ==========================================
const TELEGRAM_TOKEN = '8041662519:AAE3NRrjFJsOQzmfxkx5OX5A-X-ACVaP0Qk'; // Your Bot Token
// Note: Chat ID is now dynamic. We learn it when you type /start.
let TARGET_CHAT_ID = process.env.TELEGRAM_CHAT_ID; 

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const EXECUTOR_ADDRESS = process.env.EXECUTOR_ADDRESS;

// SAFETY CHECK
if (!PRIVATE_KEY || !PRIVATE_KEY.startsWith("0x")) {
    console.error("❌ CRITICAL ERROR: Invalid PRIVATE_KEY in .env file.".red);
    process.exit(1);
}

// NETWORK CONFIGURATION
const NETWORKS = {
    ETHEREUM: { 
        name: "Ethereum",
        chainId: 1, 
        rpc: process.env.ETH_RPC || "https://eth.llamarpc.com", 
        relay: "https://relay.flashbots.net" 
    },
    BASE: { 
        name: "Base",
        chainId: 8453, 
        rpc: process.env.BASE_RPC || "https://mainnet.base.org" 
    }
};

// Select Active Network (Default: ETHEREUM)
const CURRENT_CHAIN = NETWORKS.ETHEREUM;

// USER SETTINGS (Mutable via Telegram)
const USER_CONFIG = {
    tradeAmount: "0.01", // Default amount in ETH
    autoTrade: false,    // Default to Manual Mode (Safest)
    minerBribe: 50       // Bribe percentage (0-99)
};

// AI SOURCES
const AI_SITES = [
    "https://api.crypto-ai-signals.com/v1/latest",
    "https://top-trading-ai-blog.com/alerts"
];

// ==========================================
// 2. INITIALIZATION
// ==========================================
console.clear();
console.log(`╔════════════════════════════════╗`.cyan);
console.log(`║ ⚡ APEX TITAN v500.0 ONLINE   ║`.cyan);
console.log(`╚════════════════════════════════╝`.cyan);

// Init Providers & Wallet
const provider = new JsonRpcProvider(CURRENT_CHAIN.rpc, CURRENT_CHAIN.chainId);
const wallet = new Wallet(PRIVATE_KEY, provider);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const sentiment = new Sentiment();

// Init Flashbots (Optional)
let flashbots = null;
if (CURRENT_CHAIN.chainId === 1) {
    FlashbotsBundleProvider.create(provider, Wallet.createRandom(), CURRENT_CHAIN.relay)
        .then(fb => { 
            flashbots = fb; 
            console.log("[SYSTEM] Flashbots Protection: Active".green); 
        })
        .catch(e => console.log("[SYSTEM] Flashbots Init Failed (Non-fatal)".yellow));
}

// Init Contract
let executorContract = null;
if (ethers.isAddress(EXECUTOR_ADDRESS)) {
    executorContract = new Contract(EXECUTOR_ADDRESS, [
        "function executeComplexPath(string[] path,uint256 amount) external payable"
    ], wallet);
}

// Health Server
http.createServer((req, res) => {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "Online", chain: CURRENT_CHAIN.name, config: USER_CONFIG }));
}).listen(8080, () => console.log("[SYSTEM] Health Monitor Active on 8080".gray));


// ==========================================
// 3. TELEGRAM INTERFACE
// ==========================================

// /start - The main entry point
bot.onText(/\/start/, (msg) => {
    TARGET_CHAT_ID = msg.chat.id;
    const welcomeMsg = `
⚡ **APEX TITAN v500.0 IS READY**

I am connected to **${CURRENT_CHAIN.name}**.
Current Balance: Loading...

**🕹 CONTROL PANEL:**
/scan - Force AI Analysis
/auto - Toggle Auto-Trading
/setamount <val> - Set Trade Size
/wallet - View Status

_Current Mode:_ ${USER_CONFIG.autoTrade ? "⚡ AUTO (High Speed)" : "🛡 MANUAL (Safe)"}
    `;
    bot.sendMessage(TARGET_CHAT_ID, welcomeMsg, { parse_mode: "Markdown" });
});

// /setamount - Change trade size
bot.onText(/\/setamount (.+)/, (msg, match) => {
    const amount = parseFloat(match[1]);
    if (!amount || amount <= 0) return bot.sendMessage(msg.chat.id, "❌ Invalid amount. Usage: `/setamount 0.05`");
    
    USER_CONFIG.tradeAmount = amount.toString();
    bot.sendMessage(msg.chat.id, `✅ Trade Amount Updated: **${amount} ETH**`, { parse_mode: "Markdown" });
});

// /auto - Toggle Safety Mode
bot.onText(/\/auto/, (msg) => {
    USER_CONFIG.autoTrade = !USER_CONFIG.autoTrade;
    const status = USER_CONFIG.autoTrade ? "⚡ ON (Automatic Execution)" : "🛡 OFF (Manual Confirm)";
    bot.sendMessage(msg.chat.id, `🔄 Auto-Trading: **${status}**`, { parse_mode: "Markdown" });
});

// /wallet - Status Check
bot.onText(/\/wallet/, async (msg) => {
    const bal = await provider.getBalance(wallet.address);
    const balFmt = ethers.formatEther(bal);
    const msgText = `
💼 **WALLET STATUS**
------------------
💰 **Balance:** ${parseFloat(balFmt).toFixed(4)} ETH
🔗 **Chain:** ${CURRENT_CHAIN.name}
⚙️ **Config:** ${USER_CONFIG.tradeAmount} ETH / Trade
🤖 **Auto-Mode:** ${USER_CONFIG.autoTrade ? "Enabled" : "Disabled"}
    `;
    bot.sendMessage(msg.chat.id, msgText, { parse_mode: "Markdown" });
});

// /scan - Manual AI Trigger
bot.onText(/\/scan/, (msg) => {
    bot.sendMessage(msg.chat.id, "🧠 Scanning markets...");
    runAIScan();
});

// Button Handler (For Manual Trades)
bot.on('callback_query', async (query) => {
    const data = query.data;
    if (data.startsWith("BUY_")) {
        const token = data.split("_")[1];
        bot.answerCallbackQuery(query.id, { text: `Initiating buy for ${token}...` });
        await executeTrade(token, "Manual Approval");
    }
});


// ==========================================
// 4. AI & TRADING ENGINE
// ==========================================

async function runAIScan() {
    console.log("[AI] Scanning sources...".yellow);
    
    // 1. Fetch Data
    for (const url of AI_SITES) {
        try {
            const res = await axios.get(url, { timeout: 5000 });
            const text = JSON.stringify(res.data);
            
            // 2. Analyze
            const analysis = sentiment.analyze(text);
            const tickers = text.match(/\$[A-Z]{2,6}/g);

            if (tickers && analysis.score > 0) {
                const token = tickers[0].replace('$', '');
                const confidence = analysis.comparative; // 0 to 1+
                
                // 3. Act
                handleSignal(token, confidence, analysis.words);
                break; // Stop after finding one to avoid spam
            }
        } catch (e) {
            // Silent fail on network errors
        }
    }
}

function handleSignal(token, confidence, keywords) {
    if (!TARGET_CHAT_ID) return;

    const why = keywords.join(", ") || "General market sentiment";
    const amount = USER_CONFIG.tradeAmount;
    
    const message = `
🚀 **AI SIGNAL: ${token}**
--------------------
🧠 **Confidence:** ${(confidence * 100).toFixed(0)}%
📝 **Reasoning:** _"${why}"_
💰 **Action:** Buy ${amount} ETH
    `;

    if (USER_CONFIG.autoTrade) {
        bot.sendMessage(TARGET_CHAT_ID, `${message}\n⚡ **Auto-Executing...**`, { parse_mode: "Markdown" });
        executeTrade(token, "AI Auto-Pilot");
    } else {
        const opts = {
            reply_markup: {
                inline_keyboard: [[{ text: `✅ BUY ${token} NOW`, callback_data: `BUY_${token}` }]]
            },
            parse_mode: "Markdown"
        };
        bot.sendMessage(TARGET_CHAT_ID, message, opts);
    }
}

async function executeTrade(token, source) {
    if (!executorContract) {
        if (TARGET_CHAT_ID) bot.sendMessage(TARGET_CHAT_ID, "❌ **Error:** Executor Contract Address not set in .env");
        return;
    }

    try {
        console.log(`[TRADE] Executing ${token}...`.magenta);
        const amountWei = ethers.parseEther(USER_CONFIG.tradeAmount);
        
        // Define path (Simple V2/V3 Swap Path)
        const path = ["ETH", token]; 

        // 1. Prepare Transaction
        const txRequest = await executorContract.populateTransaction.executeComplexPath(path, amountWei, {
            value: amountWei,
            gasLimit: 500000n
        });

        // 2. Send (Flashbots or Regular)
        let txHash;
        if (flashbots && USER_CONFIG.minerBribe > 0) {
            // Advanced: Flashbots Bundle
            const block = await provider.getBlockNumber() + 1;
            const bundle = [{ signer: wallet, transaction: txRequest }];
            const resp = await flashbots.sendBundle(bundle, block);
            if ('error' in resp) throw new Error(resp.error.message);
            txHash = "Flashbots Bundle Submitted";
        } else {
            // Standard: Direct Mempool
            const tx = await wallet.sendTransaction(txRequest);
            txHash = tx.hash;
        }

        bot.sendMessage(TARGET_CHAT_ID, `✅ **ORDER SENT**\nHash: \`${txHash}\`\nSource: ${source}`, { parse_mode: "Markdown" });

    } catch (e) {
        console.error(`[TRADE FAIL] ${e.message}`.red);
        if (TARGET_CHAT_ID) bot.sendMessage(TARGET_CHAT_ID, `❌ **TRADE FAILED**\nReason: ${e.message.substring(0, 100)}...`);
    }
}

// ==========================================
// 5. MAIN LOOP
// ==========================================
// Scan every 60 seconds automatically
setInterval(runAIScan, 60000);
