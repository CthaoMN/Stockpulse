# StockPulse

Automated Target.com stock monitor and checkout bot for Pokémon TCG products. Listens for Discord stock alerts, adds items to cart via Chrome extension, and auto-checkouts — all from your real browser session.

## How It Works

```
Discord stock alert (PokeNotify, Zephyr, etc.)
    ↓ (2s polling)
StockPulse detects TCIN → verifies stock → queues ATC
    ↓ (1s pickup)
Chrome Extension: loads product page → fires ATC API → verifies cart
    ↓ (instant)
Chrome Extension: navigates to checkout → sets shipping/CVV → hammers place order
    ↓
Order placed → Discord notification
```

Everything runs inside your real Chrome browser — no headless browsers, no detectable automation. PerimeterX (Target's bot detection) sees a normal user.

## Components

| Component | Purpose |
|---|---|
| `stockpulse.js` | Node.js server — Discord listener, dashboard, API |
| `dashboard.html` | Web UI — product management, settings, logs |
| `stockpulse-extension/` | Chrome extension — cookie sync, ATC, checkout |
| `package.json` | Dependencies |

## Features

### Stock Detection
- **Discord listener** — monitors stock alert channels using Discord user token
- **Multi-channel support** — listen to multiple Discord channels simultaneously
- **Forward alerts** — copies stock alerts to your own Discord server
- **Announcement forwarding** — forward any channel's messages (not just stock alerts)

### Auto-Checkout
- **Browser-based ATC** — injects API calls into real target.com tab (bypasses PerimeterX)
- **Cart verification** — confirms items are actually in cart before checkout
- **Batch ATC** — queues multiple items, adds all to cart, then checkouts once
- **Aggressive checkout retry** — hammers checkout endpoint until success, cart empty, or OOS
- **Auto CVV** — stores CVV locally, sets it automatically during checkout
- **Auto shipping** — sets shipping address and fulfillment type automatically
- **Auto re-authentication** — detects password prompt, fills password, submits

### Safeguards
- **1 order per SKU per day** — configurable daily limit prevents duplicate orders
- **Third-party seller block** — refuses to checkout items not sold by Target
- **Price verification** — blocks checkout if MSRP is unverified ($0)
- **Per-product toggle** — On/Off and CO (auto-checkout) checkboxes per product
- **Duplicate ATC prevention** — won't queue same SKU twice

### Session Management
- **Chrome extension auto-sync** — cookies synced every 30 seconds
- **PX keepalive** — refreshes target.com tab every 5 minutes to keep PerimeterX cookies fresh
- **Auth keepalive** — re-authenticates every 30 minutes to maintain ecom.med checkout scope
- **Password storage** — Target password stored locally for automatic re-authentication

### Dashboard
- **Real-time logs** — every step logged with timestamps
- **Product management** — add by URL, bulk add from category pages
- **MSRP detection** — auto-detects prices from Target's Redsky API
- **Configurable quantity** — adjust ATC quantity globally
- **Test checkout button** — ⚡ button to test full ATC→checkout flow per product
- **Discord channel toggles** — enable/disable channels from the UI

### Discord Integration
- **Stock alert forwarding** — forwards alerts to your server
- **Successful checkout notifications** — green embed on order placed
- **Failed checkout alerts** — red embed when checkout fails but item is in cart
- **Remote commands** — `!ping`, `!status`, `!stop`, `!start` from Discord

## Setup

### Prerequisites
- Node.js 18+
- Chrome browser
- Discord account with access to a stock alert server (e.g. PokeNotify)
- Target.com account with saved payment method and shipping address

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/stockpulse.git
cd stockpulse
npm install
```

### Configuration

Edit `stockpulse.js` and update the CONFIG section:

```javascript
var CONFIG = {
  // Discord webhooks (create in your server → channel settings → integrations → webhooks)
  DISCORD_WEBHOOK: "https://discord.com/api/webhooks/...",           // Stock alerts
  DISCORD_CHECKOUT_WEBHOOK: "https://discord.com/api/webhooks/...",  // Successful orders
  DISCORD_CHECKOUT_FAILED_WEBHOOK: "https://discord.com/api/webhooks/...", // Failed checkouts
  DISCORD_FORWARD_WEBHOOK: "https://discord.com/api/webhooks/...",   // Forwarded alerts

  // Target store
  ZIP_CODE: "55372",
  STORE_ID: "1368",

  // Discord listener
  DISCORD_USER_TOKEN: "YOUR_DISCORD_USER_TOKEN",  // See "Getting Discord Token" below
  DISCORD_LISTEN_CHANNELS: {
    "target_10plus": { id: "CHANNEL_ID", name: "Target (10+ Stock)" },
  },
  DISCORD_ACTIVE_CHANNELS: ["target_10plus"],

  // Checkout
  ATC_QTY: 2,              // Default quantity per item
  MAX_ORDERS_PER_SKU_PER_DAY: 1,  // Max 1 auto-order per SKU per day
};
```

### Getting Discord User Token

1. Open Discord in Chrome (not the app)
2. F12 → Network tab
3. Send a message in any channel
4. Filter network requests by `messages`
5. Click the request → Headers → find `Authorization` value
6. Copy that value — that's your user token

> **Note:** Using user tokens is against Discord's TOS. Use a secondary account.

### Chrome Extension Setup

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `stockpulse-extension` folder
4. The extension icon should appear with a ✓ badge

### First Run

```bash
node stockpulse.js
```

1. Open `http://localhost:3069` in Chrome
2. Go to **Settings**:
   - Save your **Target password** (for auto re-authentication)
   - Save your **CVV** (for auto-checkout)
3. Make sure you're **logged into target.com** in Chrome
4. The extension will auto-sync cookies (green ✓ badge)
5. Add products by pasting Target URLs
6. Check **On** and **CO** for products you want to auto-checkout
7. Click **Scan MSRPs** to detect prices

## Usage

### Daily Operation

1. Start StockPulse: `node stockpulse.js`
2. Keep Chrome open with a target.com tab
3. The system runs automatically:
   - Discord alerts trigger ATC + checkout
   - Extension keeps session alive
   - Dashboard shows real-time status

### Adding Products

Paste any Target URL in the dashboard:
- Single product: `https://www.target.com/p/-/A-95230445`
- Category page: `https://www.target.com/pl/522435401`
- Just the TCIN: `95230445`

### Dashboard Controls

| Control | Function |
|---|---|
| **On** checkbox | Enable/disable monitoring for a product |
| **CO** checkbox | Enable/disable auto-checkout for a product |
| **⚡** button | Test full ATC + checkout flow (will place real order!) |
| **Qty** input | Set global ATC quantity (default: 2) |
| **Scan MSRPs** | Detect prices from Target API |
| **Settings** | CVV, Target password |

### Discord Commands

Type in your Discord command channel:

| Command | Action |
|---|---|
| `!ping` | Check if bot is alive |
| `!status` | Show full status |
| `!stop` | Stop Discord listener |
| `!start` | Restart listener |

## Architecture

### Why Chrome Extension?

Target uses PerimeterX (PX) for bot detection. PX validates:
- Browser fingerprint
- Cookie chain (`_px3`, `_pxvid`, etc.)
- Request origin

Node.js `fetch` calls get blocked because they can't replicate browser fingerprints. The Chrome extension injects API calls into a real target.com tab, so PX sees a legitimate browser request.

### Checkout Flow

```
1. ATC (Add to Cart)
   └─ Extension finds target.com tab
   └─ Fires POST to cart_items API from page context
   └─ Verifies cart has items
   └─ If 401: reloads page for PX refresh, retries

2. Checkout Setup
   └─ Navigates to target.com/checkout
   └─ Gets cart_views (items, addresses, payment)
   └─ If no payment: auto-enters password (ecom.med re-auth)
   └─ Sets shipping fulfillment + address for each item
   └─ Sets CVV on payment instruction

3. Place Order
   └─ POST to checkout endpoint
   └─ Retries indefinitely on 429/503 (rate limited)
   └─ Stops on: success, 401/403, cart empty, OOS
   └─ Re-sets CVV if it expires mid-retry
   └─ Verifies cart every 100 attempts
```

### Session Management

```
Chrome Extension (every 30s):
  └─ Syncs all cookies to StockPulse server
  └─ Includes HttpOnly cookies (accessToken, refreshToken)
  └─ Includes PX cookies (_px3, _pxvid, pxcts)

PX Keepalive (every 5 min):
  └─ Reloads target.com tab → refreshes PX cookies

Auth Keepalive (every 30 min):
  └─ Visits checkout page
  └─ If login prompt: enters password → submits
  └─ Maintains ecom.med scope for checkout
```

## File Structure

```
stockpulse/
├── stockpulse.js              # Main server
├── dashboard.html             # Web dashboard
├── package.json               # Dependencies
├── stockpulse-extension/      # Chrome extension
│   ├── manifest.json
│   ├── background.js          # Cookie sync, ATC, checkout
│   ├── popup.html             # Extension popup UI
│   └── popup.js               # Popup logic
├── .stockpulse-creds.json     # Saved credentials (gitignored)
└── .stockpulse-products.json  # Saved product states (gitignored)
```

## Security Notes

- **Credentials stored locally** — CVV, Target password, Discord token stored in `.stockpulse-creds.json` on your machine only
- **Never transmitted** — credentials only sent to Target's own login/checkout endpoints
- **Add to .gitignore** — make sure `.stockpulse-creds.json` and `.stockpulse-products.json` are gitignored

## .gitignore

```
node_modules/
.stockpulse-creds.json
.stockpulse-products.json
```

## Limitations

- **Chrome must stay open** — the extension needs a running browser
- **One order per SKU per day** — configurable but defaults to 1
- **ecom.med expires** — Target requires re-authentication every few hours; the keepalive handles this automatically if your password is saved
- **PX cookies expire** — refreshed automatically by the keepalive, but if Chrome is closed overnight they'll need to regenerate
- **Rate limiting during drops** — Target returns 429 on high-demand items; the bot retries but may not get through if stock sells out

## Troubleshooting

| Issue | Fix |
|---|---|
| ATC returns 401 | Browse target.com in Chrome to refresh PX cookies |
| "No payment method" | Go to target.com/checkout → enter password (ecom.med re-auth) |
| "MISSING_ADDRESS" | Ensure you have a default shipping address at target.com/account |
| Extension shows ✗ | StockPulse server not running — start with `node stockpulse.js` |
| Discord token expired | Get a new token from Discord Network tab |
| Products show $999 | Click "Scan MSRPs" or delete `.stockpulse-products.json` and restart |

## Disclaimer

This tool is for educational purposes only. Use at your own risk. Automated purchasing may violate Target's Terms of Service. The authors are not responsible for any account suspensions, order cancellations, or other consequences.

## License

MIT
