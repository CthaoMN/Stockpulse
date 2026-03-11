# StockPulse

Automated Target.com stock monitor and auto-checkout bot for Pokémon TCG products. Listens for Discord stock alerts, adds items to cart via Chrome extension, and checks out — all from your real browser session.

## How It Works

```
Discord stock alert (PokeNotify, Zephyr, etc.)
    ↓ (2s polling)
StockPulse detects TCIN → verifies stock → queues ATC
    ↓
Chrome Extension: fires ATC API from your browser → verifies cart
    ↓
Chrome Extension: navigates to checkout → sets shipping/CVV → places order
    ↓
Order placed → Discord notification
```

Everything runs inside your real Chrome browser — no headless browsers, no detectable automation. PerimeterX (Target's bot detection) sees a normal user.

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
- **Discord User Token** — to listen for stock alerts
- **Listen Channels** — add channels to monitor (paste Discord URL or channel ID)

Click **Save All**.

### 4. Prepare Target

- Log into **target.com** in Chrome
- Make sure you have a **saved payment method** and **shipping address**
- Go to `target.com/checkout` → enter your password once to activate checkout scope

### 5. Run

- Open `http://localhost:3069` (Monitor dashboard)
- Add products by pasting Target URLs
- Check **On** and **CO** for products you want to auto-checkout
- Click **Start** — bot verifies your Discord role and begins monitoring

## Requirements

- **Node.js 18+**
- **Chrome browser**
- **Discord account** with access to a stock alert server
- **Target.com account** with saved payment and shipping address
- **"ACO OG" role** in the StockPulse Discord server

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
- **Discord Credentials** — user token with Test button to verify
- **Listen Channels** — channels to monitor for stock alerts (accepts Discord URLs)

### Advanced (Optional)
- Poll interval and alert cooldown
- Forward-only channels (copy messages without ATC)
- Webhook for checkout failures (alerts you to manually checkout)
- Webhook for log messages
- Webhook for stock alert forwarding

All config saves to `.stockpulse-config.json`. Credentials save to `.stockpulse-creds.json`.

### Getting Your Discord Token

1. Open Discord **in Chrome** (not the app)
2. F12 → **Network** tab
3. Send a message in any channel
4. Filter by `messages`
5. Click the request → Headers → copy `Authorization` value

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
- **Role verification** — requires "ACO OG" Discord role to start

## File Structure

```
stockpulse/
├── stockpulse.js              # Main server
├── dashboard.html             # Monitor dashboard
├── config.html                # Config page
├── package.json               # Dependencies
├── stockpulse-extension/      # Chrome extension
│   ├── manifest.json
│   ├── background.js
│   ├── popup.html
│   └── popup.js
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
| Discord token expired | Get new token from Discord Network tab |
| "ACCESS DENIED" | Need "ACO OG" role in the StockPulse Discord server |
| 429 rate limited | Normal during drops — bot keeps retrying automatically |
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
