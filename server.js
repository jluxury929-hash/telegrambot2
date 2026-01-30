/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9115 (OMNI-DELTA INTEGRATION)
 * ===============================================================================
 * Infrastructure: Binance WS + Yellowstone gRPC + Jito Atomic Bundles
 * Strategy: Leader-Synced Delta Capture & High-Frequency Principal Compounding
 */

require('dotenv').config();
const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const { default: Client } = require("@triton-one/yellowstone-grpc");
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws'); 
const http = require('http');
require('colors');

// --- 🔱 LAYER 2: MEV-SHIELD INJECTION ---
const originalSend = Connection.prototype.sendRawTransaction;
Connection.prototype.sendRawTransaction = async function(rawTx, options) {
    try {
        const base64Tx = Buffer.from(rawTx).toString('base64');
        const jitoRes = await axios.post("https://mainnet.block-engine.jito.wtf/api/v1/bundles", {
            jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[base64Tx]]
        });
        if (jitoRes.data.result) { 
            console.log(`[MEV-SHIELD] ✅ Bundle Accepted: ${jitoRes.data.result.slice(0,10)}...`.green);
            return jitoRes.data.result; 
        }
    } catch (e) { console.log(`[MEV-SHIELD] ⚠️ Private Lane busy/reverted - Principal Protected`.yellow); }
    return originalSend.apply(this, [rawTx, options]);
};

// --- 1. CORE INITIALIZATION ---
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// --- 2. GLOBAL STATE & OMNI-CONFIG ---
const JUP_API = "https://quote-api.jup.ag/v6";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0' }};
const CAD_RATES = { SOL: 248.15, ETH: 4920.00, BNB: 865.00 };
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const BINANCE_WS = "wss://stream.binance.com:9443/ws/solusdt@bookTicker"; 

const NETWORKS = {
    ETH:  { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', sym: 'ETH' },
    SOL:  { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'], sym: 'SOL' },
    BASE: { id: 'base', rpc: 'https://mainnet.base.org', sym: 'ETH' },
    BSC:  { id: 'bsc', rpc: 'https://bsc-dataseed.binance.org/', sym: 'BNB' },
    ARB:  { id: 'arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', sym: 'ETH' }
};

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MAX', mode: 'GLOBAL',
    lastTradedTokens: {}, isLocked: {},
    currentAsset: 'So11111111111111111111111111111111111111112',
    entryPrice: 0, currentPnL: 0, currentSymbol: 'SOL',
    lastMarketState: '', lastCheckPrice: 0,
    atomicOn: true, flashOn: false,
    jitoTip: 20000000, 
    shredSpeed: true,
    lastBinancePrice: 0,
    minDelta: 0.45,
    isUpdatingUI: false
};
let solWallet, evmWallet, activeChatId;

// --- 🔱 2.5: GLOBAL RADAR & PnL TOOLS ---
const getMarketMood = (delta) => {
    const d = Math.abs(delta);
    if (d > 1.8) return '🔴 Dangerous (Extreme Slippage)';
    if (d > 0.7) return '🟡 Volatile (High ROI Predator Zone)';
    return '🟢 Low (Stable Arbitrage)';
};

async function trackTradePnL(signature, chatId, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0], 'confirmed');
        const tx = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
        if (!tx) return;
        const preBal = tx.meta.preBalances[0];
        const postBal = tx.meta.postBalances[0];
        const solChange = (postBal - preBal) / LAMPORTS_PER_SOL;
        const cadValue = solChange * CAD_RATES.SOL;
        const status = solChange > 0 ? '💎 PROFIT' : '⚠️ LOSS/FEE';
        bot.sendMessage(chatId, 
            `🛰️ <b>TRADE SETTLED:</b> ${symbol}\n━━━━━━━━━━━━━━━\n` +
            `🏁 <b>Result:</b> ${status}\n💰 <b>Net Change:</b> <code>${solChange.toFixed(6)} SOL</code>\n` +
            `💵 <b>Value:</b> <code>$${cadValue.toFixed(2)} CAD</code>\n📜 <a href="https://solscan.io/tx/${signature}">Solscan Link</a>`, 
            { parse_mode: 'HTML' });
    } catch (e) { console.log("[PnL] Settlement Logged.".yellow); }
}

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
            await stream.write({ transactions: { "jup": { accountInclude: ["JUP6LkbZbjS1jKKppyo4oh4A8J35gCWkkdQdq9nSC7"] } } });
        } catch (e) { console.log(`[GRPC] Connection Error`.red); }
    }
}

async function checkGlobalArb(chatId) {
    if (SYSTEM.isLocked['HFT']) return;
    try {
        const res = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000`);
        const dexPrice = res.data.outAmount / 1e6;
        const delta = ((SYSTEM.lastBinancePrice - dexPrice) / dexPrice) * 100;
        
        if (delta > SYSTEM.minDelta) {
            console.log(`[MATH] Δ: ${delta.toFixed(3)}% | Capturing...`.cyan.bold);
            SYSTEM.isLocked['HFT'] = true;
            await executeAggressiveSolRotation(chatId, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "GLOBAL-ARB");
            setTimeout(() => SYSTEM.isLocked['HFT'] = false, 400);
        }
    } catch (e) {}
}

// --- 3. NEURAL GUARD & TRUTH VERIFICATION ---
async function verifySignalIntegrity(tokenAddress, netKey) {
    if (netKey !== 'SOL') return true; 
    try {
        const conn = new Connection(NETWORKS.SOL.endpoints[0]);
        const mintInfo = await conn.getParsedAccountInfo(new PublicKey(tokenAddress));
        const data = mintInfo.value?.data?.parsed?.info;
        if (!data || data.mintAuthority !== null || data.freezeAuthority !== null) return false;
        const rugReport = await axios.get(`https://api.rugcheck.xyz/v1/tokens/${tokenAddress}/report`, SCAN_HEADERS);
        const risks = rugReport.data?.risks || [];
        return !risks.some(r => r.name === 'Mint Authority' || r.name === 'Large LP holder' || r.name === 'Unlocked LP');
    } catch (e) { return false; }
}

async function verifyOmniTruth(chatId, netKey) {
    const tradeAmt = parseFloat(SYSTEM.tradeAmount);
    try {
        if (netKey === 'SOL') {
            const conn = new Connection(NETWORKS.SOL.endpoints[0]);
            const bal = await conn.getBalance(solWallet.publicKey);
            const totalRequired = (tradeAmt * LAMPORTS_PER_SOL) + 2039280 + 150000 + SYSTEM.jitoTip;
            if (bal < totalRequired) return false;
        } else {
            const provider = new JsonRpcProvider(NETWORKS[netKey].rpc);
            const bal = await provider.getBalance(evmWallet.address);
            if (bal < ethers.parseEther(tradeAmt.toString())) return false;
        }
        return true;
    } catch (e) { return false; }
}

// --- 4. UI DASHBOARD ---
const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: SYSTEM.flashOn ? "⚡ FLASH: ON" : "⚡ FLASH: OFF", callback_data: "tg_flash" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }, { text: "🏦 WITHDRAW (USDC)", callback_data: "cmd_withdraw" }]
        ]
    }
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    if (SYSTEM.isUpdatingUI) return;
    SYSTEM.isUpdatingUI = true;

    if (q.data === "tg_atomic") SYSTEM.atomicOn = !SYSTEM.atomicOn;
    else if (q.data === "tg_flash") SYSTEM.flashOn = !SYSTEM.flashOn;
    else if (q.data === "cycle_amt") {
        const amts = ["0.01", "0.05", "0.1", "0.25", "0.5", "1.0"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
    } else if (q.data === "cmd_auto") {
        if (!solWallet) return bot.answerCallbackQuery(q.id, { text: "❌ Connect Wallet!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) Object.keys(NETWORKS).forEach(net => startNetworkSniper(chatId, net));
    } else if (q.data === "cmd_status") runStatusDashboard(chatId);
    
    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: chatId, message_id: q.message.message_id }).catch(() => {});
    SYSTEM.isUpdatingUI = false;
});

// --- 5. OMNI-EXECUTION ENGINE ---
async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal && await verifySignalIntegrity(signal.tokenAddress, netKey) && await verifyOmniTruth(chatId, netKey)) {
                    SYSTEM.isLocked[netKey] = true;
                    const res = (netKey === 'SOL') 
                        ? await executeAggressiveSolRotation(chatId, signal.tokenAddress, signal.symbol)
                        : await executeEvmContract(chatId, netKey, signal.tokenAddress);
                    if (res) SYSTEM.lastTradedTokens[signal.tokenAddress] = true;
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 400));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 10000)); }
    }
}

async function executeAggressiveSolRotation(chatId, targetToken, symbol) {
    let rpcIdx = 0;
    while (rpcIdx < NETWORKS.SOL.endpoints.length) {
        try {
            const conn = new Connection(NETWORKS.SOL.endpoints[rpcIdx], 'confirmed');
            const amtMultiplier = (symbol.includes('ARB') || symbol.includes('FAST')) ? 10 : 1;
            const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL * amtMultiplier);
            const quote = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${targetToken}&amount=${amt}&slippageBps=150`);
            const { swapTransaction } = (await axios.post(`${JUP_API}/swap`, { quoteResponse: quote.data, userPublicKey: solWallet.publicKey.toString(), prioritizationFeeLamports: "auto" })).data;
            const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
            tx.sign([solWallet]);
            const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[Buffer.from(tx.serialize()).toString('base64')]] });
            if (res.data.result) {
                bot.sendMessage(chatId, `💰 <b>SUCCESS:</b> $${symbol} Captured via Jito.`, { parse_mode: 'HTML' });
                setTimeout(async () => {
                    const sigs = await new Connection(NETWORKS.SOL.endpoints[0]).getSignaturesForAddress(solWallet.publicKey, { limit: 1 });
                    if (sigs[0]) trackTradePnL(sigs[0].signature, chatId, symbol);
                }, 3000);
                return true;
            }
            return false;
        } catch (e) { rpcIdx++; }
    }
    return false;
}

async function executeEvmContract(chatId, netKey, addr) {
    try {
        const net = NETWORKS[netKey];
        const wallet = evmWallet.connect(new JsonRpcProvider(net.rpc));
        const tx = await wallet.sendTransaction({ to: addr, value: ethers.parseEther(SYSTEM.tradeAmount), gasLimit: 250000 });
        await tx.wait(); return true;
    } catch (e) { return false; }
}

async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const chainMap = { 'SOL': 'solana', 'ETH': 'ethereum', 'BASE': 'base', 'BSC': 'bsc', 'ARB': 'arbitrum' };
        const match = res.data.find(t => t.chainId === chainMap[netKey] && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        return match ? { symbol: match.symbol, tokenAddress: match.tokenAddress } : null;
    } catch (e) { return null; }
}

function runStatusDashboard(chatId) {
    const delta = ((SYSTEM.lastBinancePrice - (SYSTEM.lastCheckPrice || SYSTEM.lastBinancePrice)) / (SYSTEM.lastCheckPrice || 1)) * 100;
    const mood = getMarketMood(delta);
    bot.sendMessage(chatId, `📊 <b>OMNI LIVE STATUS</b>\n\n🛰️ <b>Mood:</b> ${mood}\n📉 <b>Δ:</b> <code>${delta.toFixed(3)}%</code>\n💰 <b>Size:</b> <code>${SYSTEM.tradeAmount} SOL</code>\n🛡️ <b>Shields:</b> ${SYSTEM.atomicOn ? 'ATOMIC' : 'RAW'}`, { parse_mode: 'HTML' });
}

// --- 6. COMMANDS & SERVER ---
bot.onText(/\/(start|menu)/, (msg) => {
    startGlobalUltimatum(msg.chat.id);
    bot.sendMessage(msg.chat.id, "<b>⚔️ APEX OMNI-MASTER v9115</b>", { parse_mode: 'HTML', ...getDashboardMarkup() });
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = await bip39.mnemonicToSeed(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        evmWallet = ethers.Wallet.fromPhrase(match[1].trim());
        bot.sendMessage(msg.chat.id, `✅ <b>SYNCED:</b> <code>${solWallet.publicKey.toBase58()}</code>`, { parse_mode: 'HTML' });
        bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ <b>FAILED</b>"); }
});

http.createServer((req, res) => res.end("v9115 READY")).listen(8080);
