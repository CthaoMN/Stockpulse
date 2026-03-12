# StockPulse

Automated Target.com stock monitor and auto-checkout bot for Pokémon TCG products. Watches Discord stock alert channels via Chrome extension, adds items to cart, and checks out — all from your real browser session. No Discord user tokens, no ban risk.

## How It Works

```
You browse Discord in Chrome (PokeNotify, Zephyr, etc.)
    ↓
Chrome Extension watches for new messages in the channel (DOM scraping)
    ↓
Extension detects TCIN from embed fields → sends to StockPulse
    ↓
StockPulse verifies stock via Target API → queues ATC
    ↓
Extension: fires ATC API from your browser → verifies cart
    ↓
Extension: navigates to checkout → sets shipping/CVV → places order
    ↓
Order placed → Discord bot notifies your server
```

No headless browsers, no API tokens, no detectable automation. PerimeterX (Target's bot detection) sees a normal user. Discord sees a normal user browsing the web app.

## Quick Start

### 1. Install

```bash
git clone https://github.com/YOUR_USERNAME/stockpulse.git
cd stockpulse
npm install
node stockpulse.js
```

### 2. Chrome Extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `stockpulse-extension` folder
4. Extension icon appears with ✓ badge

### 3. Configure

Open `http://localhost:3069/config` and fill in:

- **Target password** — for auto re-authentication during checkout
- **CVV** — for auto-checkout
- **Listen Channels** — add channels to monitor (paste Discord URL or channel ID)

Click **Save All**.

### 4. Prepare Target

- Log into **target.com** in Chrome
- Make sure you have a **saved payment method** and **shipping address**
- Go to `target.com/checkout` → enter your password once to activate checkout scope

### 5. Run

1. Open `http://localhost:3069` → click **Start**
2. Open Discord in Chrome → navigate to your stock alert channel
3. Keep both tabs open — the extension monitors everything automatically

## Requirements

- **Node.js 18+**
- **Chrome browser**
- **Discord stock alert server** membership (PokeNotify, Zephyr, etc.)
- **Target.com account** with saved payment and shipping address

## How Discord Monitoring Works

Unlike traditional bots that use Discord API tokens (which get banned), StockPulse uses a **DOM watcher** approach:

1. You open Discord **in Chrome** like a normal user
2. Navigate to the stock alert channel
3. The Chrome extension injects a content script into the Discord page
4. When new messages appear, the script reads embed fields from the DOM
5. Extracts TCINs and product names from the message content
6. Sends alerts to StockPulse server via the extension's background script

**Why this doesn't get banned:**
- No Discord API calls
- No user token or bot token reading from their server
- You're just a normal user with a Chrome extension (like any ad blocker)
- Discord's CSP is bypassed via the extension's background script relay

## Dashboard

The monitor dashboard at `http://localhost:3069` shows:

- Real-time log of all activity
- Product list with On/CO toggles
- ⚡ test button per product (fires real ATC + checkout)
- Start/Stop controls

### Adding Products

Paste any Target URL in the add bar:
- Product page: `https://www.target.com/p/-/A-95230445`
- Category page: `https://www.target.com/pl/522435401`
- Just the TCIN: `95230445`

### Product Controls

| Control | Function |
|---|---|
| **On** | Enable monitoring for this product |
| **CO** | Enable auto-checkout for this product |
| **⚡** | Test full ATC + checkout (places real order!) |

## Config Page

All settings at `http://localhost:3069/config`:

### Main Settings
- **Target Store** — ZIP code, Store ID (used for stock verification)
- **Checkout** — ATC quantity, max orders per SKU per day, Target password, CVV
- **Discord Credentials** — user token (optional, only needed for role verification)
- **Listen Channels** — channels to monitor (accepts Discord URLs or channel IDs)

### Advanced (Optional)
- Poll interval and alert cooldown
- Forward-only channels (copy messages to your server without ATC)
- Webhook for stock alert forwarding
- Webhook for checkout failures
- Webhook for log messages

All config saves to `.stockpulse-config.json`. Credentials save to `.stockpulse-creds.json`.

## Discord Bot (for sharing alerts)

StockPulse includes a Discord bot that forwards stock alerts to your own server so other users can benefit. When the DOM watcher detects an alert, the bot posts it as a rich embed.

### Bot Setup

1. Go to https://discord.com/developers/applications
2. Create new application → go to **Bot** tab → **Reset Token** → copy token
3. Enable **Message Content Intent** and **Server Members Intent**
4. Go to **OAuth2** → **URL Generator** → check `bot` scope + `Send Messages`, `Embed Links`, `Read Message History`
5. Copy invite URL → open in browser → select your server → Authorize
6. Set `DISCORD_BOT_TOKEN` and `DISCORD_BOT_CHANNEL_ID` in stockpulse.js

## How Checkout Works

### ATC (Add to Cart)
1. Extension fires POST to Target's cart API from a real browser tab
2. If auth fails (401) → reloads page once to refresh PerimeterX cookies
3. Verifies items are actually in cart before proceeding
4. Multiple items queue up → all added to cart before checkout

### Checkout
1. Navigates to `target.com/checkout` to initialize payment session
2. If login prompt appears → auto-enters your saved Target password
3. Sets shipping address and fulfillment type for each item
4. Sets CVV on payment method
5. Hammers place order endpoint at 50ms intervals until success or cart empty

### Session Management
- **Cookie sync** — extension syncs all cookies to server every 30 seconds
- **PX keepalive** — refreshes target.com tab every 5 minutes
- **Auth keepalive** — re-authenticates every 30 minutes to maintain checkout scope
- **Service worker keepalive** — Chrome alarm prevents extension from sleeping

## Safeguards

- **1 order per SKU per day** — prevents duplicate orders (configurable)
- **Third-party seller block** — only buys from Target, not marketplace sellers
- **Price verification** — blocks checkout if MSRP is unverified
- **Per-product toggle** — On/CO checkboxes per product
- **Duplicate ATC prevention** — won't queue same SKU twice
- **Stock verification** — confirms stock via Redsky API before ATC
- **Role verification** — optionally requires Discord role to start (for distribution)

## File Structure

```
stockpulse/
├── stockpulse.js              # Main server
├── dashboard.html             # Monitor dashboard
├── config.html                # Config page
├── package.json               # Dependencies
├── stockpulse-extension/      # Chrome extension
│   ├── manifest.json
│   ├── background.js          # Cookie sync, ATC, checkout, alert relay
│   ├── discord-watcher.js     # DOM scraper for Discord stock alerts
│   ├── popup.html             # Extension popup UI
│   └── popup.js               # Popup logic
├── .stockpulse-config.json    # Saved config (gitignored)
├── .stockpulse-creds.json     # Saved credentials (gitignored)
├── .stockpulse-products.json  # Saved product states (gitignored)
└── stockpulse.log             # Log file (gitignored)
```

## Troubleshooting

| Issue | Fix |
|---|---|
| ATC returns 401 | Go to target.com/checkout → enter password |
| "No payment method" | Enter password at checkout to activate ecom.med scope |
| "MISSING_ADDRESS" | Add a default shipping address at target.com/account |
| Extension shows ✗ | Start StockPulse: `node stockpulse.js` |
| No alerts detected | Make sure Discord tab is open on the correct channel |
| "Monitor is STOPPED" | Click Start on the dashboard first |
| 429 rate limited | Normal during drops — bot keeps retrying at 50ms |
| Products show SCAN | Click "Scan MSRPs" to detect prices |

## .gitignore

```
node_modules/
.stockpulse-config.json
.stockpulse-creds.json
.stockpulse-products.json
stockpulse.log
```

## Disclaimer

This tool is for educational purposes only. Use at your own risk. Automated purchasing may violate Target's Terms of Service. The authors are not responsible for any account suspensions, order cancellations, or other consequences.

## License

MIT
