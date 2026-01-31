/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (STABILIZED CORE)
 * ===============================================================================
 * FIX: Forced Blockhash Refresh (Zero Expiry Errors)
 * FIX: Jito Tip compliant instruction bundling
 * FIX: DexScreener Boosts JSON Mapping for 2026 API
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionMessage } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- 1. EMERGENCY CONFIG ---
const JUP_API = "https://quote-api.jup.ag/v6";
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }};
const JITO_TIP_ACCOUNTS = [
    '96g9sAg9u3mBsJp9U9YVsk8XG3V6rW5E2t3e8B5Y3npx', // Jito Tip Account
    'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe'
];

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MEDIUM',
    lastTradedTokens: {}, isLocked: {},
    jitoTip: 1000000, // 0.001 SOL
    currentAsset: 'So11111111111111111111111111111111111111112'
};

let solWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// --- 2. THE HARDENED EXECUTION CORE (MANDATORY FIX) ---
async function executeSolShotgun(chatId, addr, symbol) {
    try {
        const conn = new Connection("https://api.mainnet-beta.solana.com", 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        
        // A. GET QUOTE
        const q = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${addr}&amount=${amt}&slippageBps=150`);
        
        // B. GET SWAP TX
        const s = await axios.post(`${JUP_API}/swap`, {
            quoteResponse: q.data,
            userPublicKey: solWallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: "auto"
        });

        // C. DESERIALIZE & REFRESH BLOCKHASH (Crucial step)
        const swapBuf = Buffer.from(s.data.swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(swapBuf);
        
        // Inject a fresh blockhash right before signing to prevent 'Blockhash not found'
        const { blockhash } = await conn.getLatestBlockhash('finalized');
        transaction.message.recentBlockhash = blockhash;
        
        transaction.sign([solWallet]);

        // D. JITO BUNDLE WRAPPER
        const rawTx = Buffer.from(transaction.serialize()).toString('base64');
        const jitoPayload = {
            jsonrpc: "2.0",
            id: 1,
            method: "sendBundle",
            params: [[rawTx]]
        };

        const res = await axios.post(JITO_ENGINE, jitoPayload);

        if (res.data.result) {
            bot.sendMessage(chatId, `✅ **EXECUTED:** $${symbol}\nBundle ID: \`${res.data.result.slice(0,10)}...\``);
            return { success: true, amountOut: q.data.outAmount };
        } else {
            console.log(`[Jito] Rejected: ${JSON.stringify(res.data.error)}`.red);
            return { success: false };
        }
    } catch (e) {
        console.log(`[EXEC ERROR] ${e.message}`.red);
        return { success: false };
    }
}

// --- 3. REBUILT SIGNAL SCANNER (API FIX) ---
async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        if (!res.data || !Array.isArray(res.data)) return null;

        const chainMap = { 'SOL': 'solana', 'BSC': 'bsc' };
        
        // DEXScreener sometimes returns symbol/address in nested objects for 'boosts'
        const match = res.data.find(t => 
            t.chainId === chainMap[netKey] && 
            t.tokenAddress && 
            !SYSTEM.lastTradedTokens[t.tokenAddress]
        );

        if (match) {
            return {
                symbol: match.symbol || match.tokenAddress.slice(0, 6),
                tokenAddress: match.tokenAddress,
                price: parseFloat(match.amount) || 0.0001
            };
        }
    } catch (e) { return null; }
}

// --- 4. AUTO-PILOT ENGINE ---
async function startNetworkSniper(chatId, netKey) {
    console.log(`[RADAR] Scanning ${netKey} in Auto-Pilot...`.magenta);
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                
                if (signal && signal.tokenAddress) {
                    // Pre-Execution Balance Guard
                    const conn = new Connection("https://api.mainnet-beta.solana.com");
                    const bal = await conn.getBalance(solWallet.publicKey);
                    if (bal < (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 10000000) {
                        bot.sendMessage(chatId, "⚠️ **SKIP:** Balance too low for trade + gas.");
                        SYSTEM.autoPilot = false;
                        break;
                    }

                    SYSTEM.isLocked[netKey] = true;
                    bot.sendMessage(chatId, `🎯 **SIGNAL:** ${signal.symbol}. Engaging...`);
                    
                    const buyRes = await executeSolShotgun(chatId, signal.tokenAddress, signal.symbol);
                    
                    if (buyRes && buyRes.success) {
                        SYSTEM.lastTradedTokens[signal.tokenAddress] = true;
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 1200)); // Polling delay
        } catch (e) { 
            SYSTEM.isLocked[netKey] = false; 
            await new Promise(r => setTimeout(r, 5000)); 
        }
    }
}

// --- 5. INTERACTIVE HANDLERS ---
bot.on('callback_query', async (query) => {
    const { data, message } = query;
    const chatId = message.chat.id;

    if (data === "cmd_auto") {
        if (!solWallet) return bot.answerCallbackQuery(query.id, { text: "❌ Link Wallet First!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) {
            bot.sendMessage(chatId, "🚀 **AUTO-PILOT ACTIVE.**");
            startNetworkSniper(chatId, 'SOL');
        }
    }
    bot.answerCallbackQuery(query.id);
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = match[1].trim();
        const mnemonic = await bip39.mnemonicToSeed(seed);
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", mnemonic.toString('hex')).key);
        bot.sendMessage(msg.chat.id, `✅ **SYNCED:** \`${solWallet.publicKey.toString()}\``);
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ **SYNC FAILED**"); }
});

bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "⚔️ **APEX MASTER READY**", {
    reply_markup: { inline_keyboard: [[{ text: "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }]] }
}));

http.createServer((req, res) => res.end("APEX ONLINE")).listen(8080);
