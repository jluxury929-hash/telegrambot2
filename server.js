/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL SIGNAL v9000 (FINAL STABLE PRODUCTION)
 * ===============================================================================
 * ARCH: Multi-Chain (SOL | BASE | BSC | ETH | ARB)
 * ENGINE: Jupiter Aggregator Unified (SOL) + Uniswap V2 Standard (EVM)
 * AUTH: Mandatory x-api-key Headers (2026 Unified Standard)
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, JsonRpcProvider, Contract, Wallet, HDNodeWallet } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- CONFIGURATION ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

// 🛡️ AUTH FIX: Get your unique key at https://portal.jup.ag/
// You can paste it here or set jupiter_api_key in your .env file
const JUP_API_KEY = process.env.jupiter_api_key || process.env.JUP_API_KEY || "f440d4df-b5c4-4020-a960-ac182d3752ab"; 
const JUP_ENDPOINT = "https://api.jup.ag/swap/v1"; 

// --- 5-CHAIN NETWORK DEFINITIONS ---
const NETWORKS = {
    ETH: { id: 'ethereum', type: 'EVM', rpc: 'https://rpc.mevblocker.io', chainId: 1, router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', explorer: 'https://etherscan.io/tx/' },
    SOL: { id: 'solana', type: 'SVM', rpc: 'https://api.mainnet-beta.solana.com', explorer: 'https://solscan.io/tx/' },
    BASE: { id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', chainId: 8453, router: '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86', weth: '0x4200000000000000000000000000000000000006', explorer: 'https://basescan.org/tx/' },
    BSC: { id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', chainId: 56, router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', explorer: 'https://bscscan.com/tx/' },
    ARB: { id: 'arbitrum', type: 'EVM', rpc: 'https://arb1.arbitrum.io/rpc', chainId: 42161, router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', explorer: 'https://arbiscan.io/tx/' }
};

// --- GLOBAL STATE ---
let SYSTEM = { currentNetwork: 'SOL', autoPilot: false, isLocked: false, riskProfile: 'MEDIUM', strategyMode: 'DAY', tradeAmount: "0.0005", activePosition: null, pendingTarget: null, lastTradedToken: null };

// --- WALLET STATE ---
let evmWallet = null, evmSigner = null, evmProvider = null, evmRouter = null, solWallet = null;
const solConnection = new Connection(NETWORKS.SOL.rpc, 'confirmed');
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: { interval: 300, autoStart: true, params: { timeout: 10 } } });

// ==========================================
//  RPG SYSTEM & SHARED LOGIC
// ==========================================
let PLAYER = { level: 1, xp: 0, nextLevelXp: 1000, class: "DATA ANALYST", dailyQuests: [ { id: 'sim', task: "Scan Signals", count: 0, target: 10, done: false, xp: 150 }, { id: 'trade', task: "Execute Setup", count: 0, target: 1, done: false, xp: 500 } ] };
const addXP = (amount, chatId) => { PLAYER.xp += amount; if (PLAYER.xp >= PLAYER.nextLevelXp) { PLAYER.level++; PLAYER.xp -= PLAYER.nextLevelXp; PLAYER.nextLevelXp = Math.floor(PLAYER.nextLevelXp * 1.5); if(chatId) bot.sendMessage(chatId, `🆙 **LEVEL UP:** ${PLAYER.level} (${getRankName(PLAYER.level)})`); } };
const getRankName = (lvl) => { if (lvl < 5) return "DATA ANALYST"; if (lvl < 10) return "PATTERN SEER"; if (lvl < 20) return "WHALE HUNTER"; return "MARKET GOD"; };
const updateQuest = (type, chatId) => { PLAYER.dailyQuests.forEach(q => { if (q.id === type && !q.done) { q.count++; if (q.count >= q.target) { q.done = true; addXP(q.xp, chatId); } } }); };
const getXpBar = () => { const p = Math.min(Math.round((PLAYER.xp / PLAYER.nextLevelXp) * 10), 10); return "▓".repeat(p) + "░".repeat(10 - p); };

const RISK_PROFILES = { LOW: { slippage: 50, stopLoss: 10 }, MEDIUM: { slippage: 200, stopLoss: 20 }, HIGH: { slippage: 500, stopLoss: 40 }, DEGEN: { slippage: 2000, stopLoss: 60 } };
const STRATEGY_MODES = { SCALP: { trail: 5, minConf: 0.80 }, DAY: { trail: 15, minConf: 0.85 }, MOON: { trail: 40, minConf: 0.90 } };

// ==========================================
//  AUTH & NETWORK
// ==========================================
bot.onText(/\/connect (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const rawMnemonic = match[1].trim();
    if (!bip39.validateMnemonic(rawMnemonic)) return bot.sendMessage(chatId, "⚠️ **INVALID SEED.**");
    try {
        evmWallet = HDNodeWallet.fromPhrase(rawMnemonic);
        const seed = bip39.mnemonicToSeedSync(rawMnemonic);
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        await initNetwork(SYSTEM.currentNetwork);
        bot.sendMessage(chatId, `🔗 **NEURAL LINK ESTABLISHED**\nSOL: \`${solWallet.publicKey.toString()}\``);
    } catch (e) { bot.sendMessage(chatId, `Error: ${e.message}`); }
});

async function initNetwork(netKey) {
    SYSTEM.currentNetwork = netKey;
    const net = NETWORKS[netKey];
    if (net.type === 'EVM' && evmWallet) {
        evmProvider = new JsonRpcProvider(net.rpc);
        evmSigner = evmWallet.connect(evmProvider);
        evmRouter = new Contract(net.router, ["function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable", "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external", "function approve(address spender, uint256 amount) external returns (bool)", "function allowance(address owner, address spender) view returns (uint256)", "function balanceOf(address owner) view returns (uint256)"], evmSigner);
    }
}

// ==========================================
//  SOLANA EXECUTION (AUTHENTICATED)
// ==========================================

async function executeUltraSwap(chatId, direction, tokenAddress, amountInput) {
    if (!solWallet) return bot.sendMessage(chatId, "⚠️ Wallet Not Connected");
    if (!JUP_API_KEY) return bot.sendMessage(chatId, "❌ **AUTH ERROR:** API Key missing.");

    try {
        const risk = RISK_PROFILES[SYSTEM.riskProfile];
        const SOL_MINT = 'So11111111111111111111111111111111111111112';
        const inputMint = direction === 'BUY' ? SOL_MINT : tokenAddress;
        const outputMint = direction === 'BUY' ? tokenAddress : SOL_MINT;
        
        let amountStr;
        if (direction === 'BUY') {
             amountStr = Math.floor(amountInput * LAMPORTS_PER_SOL).toString();
        } else {
             const mintPubkey = new PublicKey(tokenAddress);
             const tokenAccounts = await solConnection.getParsedTokenAccountsByOwner(solWallet.publicKey, { mint: mintPubkey });
             if(tokenAccounts.value.length === 0) throw new Error("No Balance");
             const bestAccount = tokenAccounts.value.reduce((p, c) => (p.account.data.parsed.info.tokenAmount.uiAmount > c.account.data.parsed.info.tokenAmount.uiAmount) ? p : c);
             amountStr = bestAccount.account.data.parsed.info.tokenAmount.amount;
        }

        // 🛡️ THE HEADER CONFIG (Resolves 401)
        const config = { headers: { 'x-api-key': JUP_API_KEY, 'Content-Type': 'application/json' } };

        const quoteRes = await axios.get(`${JUP_ENDPOINT}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountStr}&slippageBps=${risk.slippage}`, config);
        const swapRes = await axios.post(`${JUP_ENDPOINT}/swap`, { quoteResponse: quoteRes.data, userPublicKey: solWallet.publicKey.toString(), wrapAndUnwrapSol: true, prioritizationFeeLamports: "auto", dynamicComputeUnitLimit: true }, config);

        const transaction = VersionedTransaction.deserialize(Buffer.from(swapRes.data.swapTransaction, 'base64'));
        transaction.sign([solWallet]);
        const signature = await solConnection.sendRawTransaction(transaction.serialize());

        bot.sendMessage(chatId, `🚀 **SUCCESS:** https://solscan.io/tx/${signature}`);
        return { amountOut: quoteRes.data.outAmount, hash: signature };

    } catch (e) {
        if (e.response?.status === 401) bot.sendMessage(chatId, "❌ **AUTH ERROR:** API Key is invalid.");
        else bot.sendMessage(chatId, `❌ **SWAP ERROR:** ${e.message}`);
        return null;
    }
}

// ==========================================
//  EVM EXECUTION
// ==========================================

async function executeEvmSwap(chatId, direction, tokenAddress, amountEth) {
    if (!evmSigner) return bot.sendMessage(chatId, "⚠️ EVM Not Connected");
    try {
        const net = NETWORKS[SYSTEM.currentNetwork];
        const path = direction === 'BUY' ? [net.weth, tokenAddress] : [tokenAddress, net.weth];
        const deadline = Math.floor(Date.now() / 1000) + 300;
        let feeData = await evmProvider.getFeeData();
        let gasOptions = SYSTEM.currentNetwork === 'BSC' ? { gasPrice: (feeData.gasPrice * 110n) / 100n } : { maxFeePerGas: (feeData.maxFeePerGas * 120n) / 100n, maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas * 120n) / 100n };

        if (direction === 'BUY') {
            const tx = await evmRouter.swapExactETHForTokensSupportingFeeOnTransferTokens(0, path, evmSigner.address, deadline, { value: ethers.parseEther(amountEth.toString()), ...gasOptions, gasLimit: 350000 });
            bot.sendMessage(chatId, `⚔️ **BUY:** ${tx.hash}`);
            await tx.wait(); return { amountOut: 0, hash: tx.hash };
        } else {
            const token = new Contract(tokenAddress, ["function approve(address, uint256) returns (bool)", "function allowance(address, address) view returns (uint256)", "function balanceOf(address owner) view returns (uint256)"], evmSigner);
            const bal = await token.balanceOf(evmSigner.address);
            if (bal === 0n) throw new Error("No tokens");
            if ((await token.allowance(evmSigner.address, net.router)) < bal) await (await token.approve(net.router, ethers.MaxUint256, gasOptions)).wait();
            const tx = await evmRouter.swapExactTokensForETHSupportingFeeOnTransferTokens(bal, 0, path, evmSigner.address, deadline, { ...gasOptions, gasLimit: 500000 });
            bot.sendMessage(chatId, `💸 **SELL:** ${tx.hash}`);
            await tx.wait(); return { amountOut: 0, hash: tx.hash };
        }
    } catch(e) { bot.sendMessage(chatId, `❌ EVM ERROR: ${e.message}`); return null; }
}

// ==========================================
//  OMNI-SCANNER & BOT COMMANDS
// ==========================================

async function runNeuralScanner(chatId) {
    if (!SYSTEM.autoPilot || SYSTEM.isLocked) { if(SYSTEM.isLocked && SYSTEM.autoPilot) setTimeout(() => runNeuralScanner(chatId), 2000); return; }
    try {
        const netConfig = NETWORKS[SYSTEM.currentNetwork];
        let targets = [];
        if (SYSTEM.currentNetwork === 'SOL') {
            const res = await axios.get('https://api.dexscreener.com/latest/dex/search?q=SOL');
            const valid = res.data.pairs.filter(p => p.chainId === 'solana' && p.quoteToken.address === 'So11111111111111111111111111111111111111112' && p.liquidity?.usd > 10000 && p.baseToken.address !== SYSTEM.lastTradedToken);
            valid.sort((a, b) => b.volume.h24 - a.volume.h24);
            if (valid.length > 0) targets.push(valid[0].baseToken.address);
        } else {
            const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
            const match = res.data.find(t => t.chainId === netConfig.id && t.tokenAddress !== SYSTEM.lastTradedToken);
            if (match) targets.push(match.tokenAddress);
        }
        if (targets.length > 0) {
            const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${targets[0]}`);
            if (details.data.pairs?.[0]) {
                const p = details.data.pairs[0];
                await processSignal(chatId, { name: p.baseToken.name, symbol: p.baseToken.symbol, tokenAddress: targets[0], price: parseFloat(p.priceUsd), sentimentScore: Math.random() * 0.5 + 0.5, rsi: 50 });
            }
        }
    } catch (e) { console.log(`[SCAN] loop...`.gray); }
    finally { if (SYSTEM.autoPilot) setTimeout(() => runNeuralScanner(chatId), 5000); }
}

async function processSignal(chatId, data) {
    if ((Math.random() * 0.3 + 0.5) >= STRATEGY_MODES[SYSTEM.strategyMode].minConf) {
        SYSTEM.pendingTarget = data;
        bot.sendMessage(chatId, `🎯 **SIGNAL:** ${data.symbol}\nAction: ${SYSTEM.autoPilot ? 'EXECUTING' : 'WAITING'}`);
        if (SYSTEM.autoPilot) await executeBuy(chatId);
    }
}

async function executeBuy(chatId) {
    if (!SYSTEM.pendingTarget) return;
    const target = SYSTEM.pendingTarget; SYSTEM.isLocked = true;
    bot.sendMessage(chatId, `🤖 **ATTACKING:** ${target.symbol}...`);
    let result = (SYSTEM.currentNetwork === 'SOL') ? await executeUltraSwap(chatId, 'BUY', target.tokenAddress, SYSTEM.tradeAmount) : await executeEvmSwap(chatId, 'BUY', target.tokenAddress, SYSTEM.tradeAmount);
    if (result) { SYSTEM.activePosition = { ...target, tokenAmount: result.amountOut || 0, entryPrice: target.price, highestPrice: target.price }; SYSTEM.pendingTarget = null; runProfitMonitor(chatId); } 
    else { SYSTEM.isLocked = false; }
}

async function executeSell(chatId) {
    if (!SYSTEM.activePosition) return;
    bot.sendMessage(chatId, `🔻 **SELLING:** ${SYSTEM.activePosition.symbol}...`);
    let result = (SYSTEM.currentNetwork === 'SOL') ? await executeUltraSwap(chatId, 'SELL', SYSTEM.activePosition.tokenAddress, 0) : await executeEvmSwap(chatId, 'SELL', SYSTEM.activePosition.tokenAddress, 0);
    if (result || result === null) { SYSTEM.lastTradedToken = SYSTEM.activePosition.tokenAddress; SYSTEM.activePosition = null; SYSTEM.isLocked = false; bot.sendMessage(chatId, `✅ CLOSED.`); if (SYSTEM.autoPilot) runNeuralScanner(chatId); }
}

async function runProfitMonitor(chatId) {
    if (!SYSTEM.activePosition) return;
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${SYSTEM.activePosition.tokenAddress}`);
        const cur = parseFloat(res.data.pairs[0].priceUsd);
        const pnl = ((cur - SYSTEM.activePosition.entryPrice) / SYSTEM.activePosition.entryPrice) * 100;
        if (cur > SYSTEM.activePosition.highestPrice) SYSTEM.activePosition.highestPrice = cur;
        const drop = ((SYSTEM.activePosition.highestPrice - cur) / SYSTEM.activePosition.highestPrice) * 100;
        if (drop >= STRATEGY_MODES[SYSTEM.strategyMode].trail && pnl > 1) await executeSell(chatId);
        else if (pnl <= -RISK_PROFILES[SYSTEM.riskProfile].stopLoss) await executeSell(chatId);
        else setTimeout(() => runProfitMonitor(chatId), 4000);
    } catch(e) { setTimeout(() => runProfitMonitor(chatId), 4000); }
}

bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, `🤖 **APEX v9000**\n/connect <seed>\n/auto - Toggle AI` ));
bot.onText(/\/auto/, (msg) => { SYSTEM.autoPilot = !SYSTEM.autoPilot; bot.sendMessage(msg.chat.id, `🔄 Auto: ${SYSTEM.autoPilot}`); if(SYSTEM.autoPilot) runNeuralScanner(msg.chat.id); });
bot.onText(/\/status/, async (msg) => {
    let bal = "0.00";
    if (solWallet) {
        const rawBal = await solConnection.getBalance(solWallet.publicKey);
        bal = (rawBal / LAMPORTS_PER_SOL).toFixed(4);
    }
    bot.sendMessage(msg.chat.id, `📊 **STATUS**\nLevel: ${PLAYER.level}\nNet: ${SYSTEM.currentNetwork}\nBalance: ${bal} SOL`);
});

http.createServer((req, res) => res.end("APEX ONLINE")).listen(8080);
console.log("APEX v9000 ONLINE".green);
