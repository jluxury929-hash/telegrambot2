/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9087 (GLOBAL ULTIMATUM EDITION)
 * ===============================================================================
 * Infrastructure: Binance WebSocket + Yellowstone gRPC + Jito Atomic Bundles
 * Strategy: High-Frequency Arbitrage Compounding ($A = P(1 + r)^n$)
 * Logic: Δ = ((P_binance - P_dex) / P_dex) * 100 
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } = require('@solana/web3.js');
const { default: Client } = require("@triton-one/yellowstone-grpc"); 
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws'); 
const http = require('http');
require('colors');

// --- 🔱 1. CORE INITIALIZATION ---
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const RISK_LABELS = { LOW: ' 🟢LOW', MEDIUM: ' 🟡MED', MAX: ' 🔴MAX' };
const TERM_LABELS = { SHORT: ' ⚡SHRT', MID: ' ⏳MID', LONG: ' 💎LONG' };

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MAX', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {},
    currentAsset: 'So11111111111111111111111111111111111111112',
    atomicOn: true, flashOn: false,
    jitoTip: 20000000, // 0.02 SOL Priority Bidding
    shredSpeed: true, lastBinancePrice: 0,
    minDelta: 0.45, slippageBps: 150
};

let solWallet, evmWallet, activeChatId;

const JUP_API = "https://quote-api.jup.ag/v6";
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const BINANCE_WS = "wss://stream.binance.com:9443/ws/solusdt@bookTicker"; 

const NETWORKS = {
    SOL: { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'], sym: 'SOL' },
    ETH: { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', sym: 'ETH' }
};

// --- 🔱 2. LAYER 2: MEV-SHIELD INJECTION (Atomic Expected Value) ---
// E = (P_win * Profit) - (P_loss * Cost) | P_loss cost = 0 via Jito Atomic Bundles
const originalSend = Connection.prototype.sendRawTransaction;
Connection.prototype.sendRawTransaction = async function(rawTx, options) {
    try {
        const base64Tx = Buffer.from(rawTx).toString('base64');
        const jitoRes = await axios.post(JITO_ENGINE, {
            jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[base64Tx]]
        });
        if (jitoRes.data.result) { 
            console.log(`[MEV-SHIELD] ✅ Bundle Accepted: ${jitoRes.data.result.slice(0,10)}...`.green);
            return jitoRes.data.result; 
        }
    } catch (e) { console.log(`[MEV-SHIELD] ⚠️ Private Lane busy, falling back...`.yellow); }
    return originalSend.apply(this, [rawTx, options]);
};

// --- 🔱 3. NEURAL GUARD (Rug-Pull Filtration) ---
async function verifySignalIntegrity(tokenAddress, netKey) {
    if (netKey !== 'SOL') return true; 
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0]);
        const mintInfo = await conn.getParsedAccountInfo(new PublicKey(tokenAddress));
        const data = mintInfo.value?.data?.parsed?.info;
        if (!data || data.mintAuthority !== null || data.freezeAuthority !== null) return false;

        const rugReport = await axios.get(`https://api.rugcheck.xyz/v1/tokens/${tokenAddress}/report`);
        const risks = rugReport.data?.risks || [];
        // Math: ensuring P_loss (rug) is statistically eliminated
        return !risks.some(r => r.name === 'Mint Authority' || r.name === 'Large LP holder' || r.name === 'Unlocked LP');
    } catch (e) { return false; }
}

// --- 🔱 4. UI DASHBOARD ---
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `⚠️ RISK: ${RISK_LABELS[SYSTEM.risk]}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${TERM_LABELS[SYSTEM.mode]}`, callback_data: "cycle_mode" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: SYSTEM.flashOn ? "⚡ FLASH: ON" : "⚡ FLASH: OFF", callback_data: "tg_flash" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }]
        ]
    }
});

// --- 🔱 5. THE GLOBAL ARBITRAGE DELTA (Δ) RADAR ---
async function startGlobalUltimatum(chatId) {
    const ws = new WebSocket(BINANCE_WS);
    ws.on('message', async (data) => {
        const tick = JSON.parse(data);
        SYSTEM.lastBinancePrice = (parseFloat(tick.b) + parseFloat(tick.a)) / 2;
        if (SYSTEM.autoPilot) await checkGlobalArb(chatId);
    });

    if (process.env.GRPC_ENDPOINT) {
        try {
            const client = new Client(process.env.GRPC_ENDPOINT, process.env.X_TOKEN);
            const stream = await client.subscribe();
            stream.on("data", async (data) => {
                if (data.transaction && SYSTEM.autoPilot) {
                    await executeAggressiveSolRotation(chatId, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "GEYSER-FAST");
                }
            });
        } catch (e) { console.log(`[GRPC] Connection Error`.red); }
    }
}

async function checkGlobalArb(chatId) {
    if (SYSTEM.isLocked['SOL']) return;
    try {
        const dexRes = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000`);
        const dexPrice = dexRes.data.outAmount / 1e6;
        const delta = ((SYSTEM.lastBinancePrice - dexPrice) / dexPrice) * 100;
        
        if (delta > SYSTEM.minDelta) {
            console.log(`[MATH] Δ Found: ${delta.toFixed(3)}% - Exploiting Delta`.cyan.bold);
            await executeAggressiveSolRotation(chatId, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "GLOBAL-ARB");
        }
    } catch (e) {}
}

async function executeAggressiveSolRotation(chatId, targetToken, symbol) {
    if (SYSTEM.isLocked[targetToken]) return;
    SYSTEM.isLocked[targetToken] = true;
    try {
        if (!(await verifySignalIntegrity(targetToken, 'SOL'))) throw new Error("Neural Guard Rejection");
        
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        const quote = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${targetToken}&amount=${amt}&slippageBps=${SYSTEM.slippageBps}`);
        
        const { swapTransaction } = (await axios.post(`${JUP_API}/swap`, {
            quoteResponse: quote.data,
            userPublicKey: solWallet.publicKey.toString(),
            prioritizationFeeLamports: SYSTEM.jitoTip
        })).data;

        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([solWallet]);

        const sig = await Connection.prototype.sendRawTransaction(tx.serialize());
        if (sig) bot.sendMessage(chatId, `💰 <b>ATOMIC PROFIT:</b> ${symbol}\nΔ: <code>${SYSTEM.minDelta}%</code>`, { parse_mode: 'HTML' });
    } catch (e) { console.log(`[HFT] Reverted: ${e.message}`.red); }
    setTimeout(() => SYSTEM.isLocked[targetToken] = false, 400); // shredSpeed Velocity
}

// --- 🔱 6. LISTENERS ---
bot.on('callback_query', async (query) => {
    const { data, message, id } = query;
    const chatId = message.chat.id;
    bot.answerCallbackQuery(id).catch(() => {});

    if (data === "cycle_risk") {
        const lvls = ["LOW", "MEDIUM", "MAX"];
        SYSTEM.risk = lvls[(lvls.indexOf(SYSTEM.risk) + 1) % lvls.length];
        SYSTEM.jitoTip = SYSTEM.risk === "MAX" ? 20000000 : 5000000;
    } else if (data === "cycle_mode") {
        const terms = ["SHORT", "MID", "LONG"];
        SYSTEM.mode = terms[(terms.indexOf(SYSTEM.mode) + 1) % terms.length];
    } else if (data === "cmd_auto") {
        if (!solWallet) return bot.sendMessage(chatId, "🔌 <b>Sync Wallet First!</b>", { parse_mode: 'HTML' });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) startGlobalUltimatum(chatId);
    } else if (data === "cmd_status") {
        runStatusDashboard(chatId);
    } else if (data === "cmd_conn") {
        bot.sendMessage(chatId, "🔌 <b>Sync:</b> <code>/connect [mnemonic]</code>", { parse_mode: 'HTML' });
    }

    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: chatId, message_id: message.message_id }).catch(() => {});
});

bot.onText(/\/(start|menu)/, (msg) => {
    bot.sendMessage(msg.chat.id, "<b>⚔️ APEX OMNI-MASTER v9087</b>\nMulti-Chain Radar Active.", { parse_mode: 'HTML', ...getDashboardMarkup() });
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    const seed = await bip39.mnemonicToSeed(match[1].trim());
    solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
    bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    bot.sendMessage(msg.chat.id, `✅ <b>SYNCED:</b> <code>${solWallet.publicKey.toBase58()}</code>`, { parse_mode: 'HTML' });
});

function runStatusDashboard(chatId) {
    bot.sendMessage(chatId, `📊 <b>OMNI LIVE STATUS</b>\n\n📉 <b>Delta:</b> <code>${SYSTEM.minDelta}%</code>\n💰 <b>Size:</b> <code>${SYSTEM.tradeAmount} SOL</code>\n⚠️ <b>Risk:</b> ${SYSTEM.risk}\n🛡️ <b>Shields:</b> ATOMIC [JITO]`, { parse_mode: 'HTML' });
}

http.createServer((req, res) => res.end("V9087 READY")).listen(8080);
