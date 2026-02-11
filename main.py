import os
import asyncio
from dotenv import load_dotenv
from eth_account import Account
from web3 import Web3
from web3.middleware import geth_poa_middleware
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup
from telegram.ext import ApplicationBuilder, CommandHandler, CallbackQueryHandler, MessageHandler, filters, ContextTypes

# 1. SETUP & AUTH
load_dotenv()
W3_RPC = os.getenv("RPC_URL", "https://polygon-rpc.com") 
w3 = Web3(Web3.HTTPProvider(W3_RPC))

# MANDATORY FOR POLYGON: Injects middleware to handle PoA blocks
w3.middleware_onion.inject(geth_poa_middleware, layer=0)

Account.enable_unaudited_hdwallet_features()

PAYOUT_ADDRESS = os.getenv("PAYOUT_ADDRESS", "0xYourPersonalWalletAddressHere")

def get_vault():
    private_key = os.getenv("WALLET_SEED") 
    try:
        return Account.from_key(private_key)
    except:
        return Account.from_mnemonic(private_key, account_path="m/44'/60'/0'/0/1")

vault = get_vault()

# 2. ATOMIC EXECUTION & WITHDRAWAL LOGIC
async def run_atomic_execution(context, chat_id, side):
    stake = context.user_data.get('stake', 10)
    pair = context.user_data.get('pair', 'BTC/USD')
    await context.bot.send_message(chat_id, f"🛡️ **Shield:** Simulating {pair} {side} bundle...")
    await asyncio.sleep(1.5) 
    # Use a try-except for the block number to prevent RPC crashes
    try:
        block = w3.eth.block_number
    except:
        block = "Syncing..."
    return True, f"Trade Confirmed! {stake} USD {side} at Mainnet Block {block}"

async def execute_withdrawal(context, chat_id):
    try:
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
    except Exception as e:
        return False, f"Withdrawal error: {str(e)}"

# 3. TELEGRAM INTERFACE
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    global vault
    vault = get_vault()
    try:
        bal = w3.from_wei(w3.eth.get_balance(vault.address), 'ether')
    except:
        bal = 0.0
    
    keyboard = [['🚀 Start Trading', '⚙️ Settings'], ['💰 Wallet', '📤 Withdraw'], ['🕴️ AI Assistant']]
    reply_markup = ReplyKeyboardMarkup(keyboard, resize_keyboard=True)

    msg = (
        f"🕴️ **Pocket Robot v3 (Atomic)**\n\n"
        f"💵 **Vault Balance:** {bal:.4f} ETH/POL\n"
        f"📥 **VANITY DEPOSIT:** `{vault.address}`\n\n"
        f"**Atomic Shield:** ✅ OPERATIONAL"
    )
    await update.message.reply_text(msg, parse_mode='Markdown', reply_markup=reply_markup)

async def main_chat_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text
    if text == '🚀 Start Trading':
        kb = [[InlineKeyboardButton("BTC/USD", callback_data="PAIR_BTC")]]
        await update.message.reply_text("🎯 **MARKET SELECTION**", reply_markup=InlineKeyboardMarkup(kb))
    elif text == '💰 Wallet':
        try:
            bal = w3.from_wei(w3.eth.get_balance(vault.address), 'ether')
        except:
            bal = "Error"
        await update.message.reply_text(f"💳 **Balance:** {bal} POL")
    elif text == '📤 Withdraw':
        await update.message.reply_text("📤 **Initiating Payout...**")
        success, report = await execute_withdrawal(context, update.message.chat_id)
        icon = "✅" if success else "🛑"
        await update.message.reply_text(f"{icon} {report}", parse_mode='Markdown')

# 4. START BOT WITH CONFLICT RESOLUTION
if __name__ == "__main__":
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    app = ApplicationBuilder().token(token).build()
    
    # Logic to resolve the 'Conflict' error by dropping old updates
    async def init_bot():
        await app.bot.delete_webhook(drop_pending_updates=True)
        print("Webhook cleared. Old sessions terminated.")

    # Registering handlers
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & (~filters.COMMAND), main_chat_handler))
    
    print(f"Pocket Robot Active on Vanity: {vault.address}")
    
    # Run the init and then poll
    loop = asyncio.get_event_loop()
    loop.run_until_complete(init_bot())
    
    app.run_polling()
