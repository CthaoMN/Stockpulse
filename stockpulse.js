// ═══════════════════════════════════════════════════════════════
//  StockPulse — Target Stock Monitor + Web Dashboard
//
//  Run:  npm install && node stockpulse.js
//  Then open:  http://localhost:3069
// ═══════════════════════════════════════════════════════════════

var express = require("express");
var fetch = require("node-fetch");
var path = require("path");
var fs = require("fs");
var exec = require("child_process").exec;


var imaps = null;
try { imaps = require("imap-simple"); } catch(e) {}
var HttpsProxyAgent = null;
try { HttpsProxyAgent = require("https-proxy-agent"); } catch(e) {}
var app = express();
app.use(express.json());
var PORT = 3069;

// Browser instance (reused across checks)

// Proxy rotation helper
var proxyIndex = 0;
function getProxyAgent() {
  if (!CONFIG.USE_PROXIES || CONFIG.PROXIES.length === 0) return null;
  if (!HttpsProxyAgent) {
    console.log("  WARNING: https-proxy-agent not installed. Run: npm install https-proxy-agent");
    return null;
  }
  var proxy = CONFIG.PROXIES[proxyIndex % CONFIG.PROXIES.length];
  proxyIndex++;
  return new HttpsProxyAgent(proxy);
}

// ── CONFIG ─────────────────────────────────────────────────────
var CONFIG_FILE = path.join(__dirname, ".stockpulse-config.json");

var CONFIG = {
  DISCORD_WEBHOOK: "",
  DISCORD_CHECKOUT_WEBHOOK: "https://discord.com/api/webhooks/1481023001423122473/oCWaUEn3vhlw1tAlGiN26O8ePQHe26uSL17K_m2dUXOQG-DxKnGVKIdC39HQSXpZAd8w",  // Hardcoded — all users post here
  DISCORD_CHECKOUT_FAILED_WEBHOOK: "",
  ZIP_CODE: "55372",
  STORE_ID: "1368",
  POLL_INTERVAL_MS: 30000,
  MAX_PERCENT_ABOVE_MSRP: 20,
  ALERT_COOLDOWN_MS: 120000,
  REQUEST_DELAY_MS: 2000,
  API_KEY: "9f36aeafbe60771e321a7cc95a78140772ab3e96",
  CHECKOUT_API_KEY: "e59ce3b531b2c39afb2e2b8a71ff10113aac2a14",
  USE_PROXIES: false,
  PROXIES: [],
  AUTO_ATC: true,
  ATC_QTY: 2,
  ATC_MAX_RETRIES: 15,
  ATC_RETRY_DELAY_MS: 150,
  CHECKOUT_MAX_RETRIES: 30,
  CHECKOUT_RETRY_DELAY_MS: 200,
  AUTO_OPEN_CHECKOUT: false,
  MAX_ORDERS_PER_SKU_PER_DAY: 1,
  MAX_CHECKS_PER_CYCLE: 10,
  DISCORD_BOT_TOKEN: "",
  DISCORD_BOT_CHANNEL_ID: "",
  DISCORD_USER_TOKEN: "",
  DISCORD_LISTEN_CHANNELS: {},
  DISCORD_ACTIVE_CHANNELS: [],
  DISCORD_LISTEN_ENABLED: false,
  DISCORD_POLL_INTERVAL_MS: 2000,
  DISCORD_FORWARD_WEBHOOK: "",
  DISCORD_LOG_WEBHOOK: "",
  DISCORD_COMMAND_CHANNEL_ID: "",
  DISCORD_FORWARD_CHANNELS: [],
  // Role verification — user must be in this server with this role
  DISCORD_VERIFY_SERVER_ID: "1481014372318056704",
  DISCORD_VERIFY_ROLE_NAME: "ACO OG",
};

// Load saved config
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      var saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      Object.keys(saved).forEach(function(k) { CONFIG[k] = saved[k]; });
      console.log("  Config loaded from " + CONFIG_FILE);
    }
  } catch(e) { console.log("  Config load error: " + e.message); }
}
function saveConfig() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2)); } catch(e) {}
}
loadConfig();

// ── SKU DATABASE ───────────────────────────────────────────────
var SKU_LIST = [
  { name: "151 Alakazam ex", type: "Ex Box", sku: "89444931", msrp: 21.99 },
  { name: "151 Binder Collection", type: "Binder", sku: "89444929", msrp: 29.99 },
  { name: "151 Booster Bundle", type: "Booster Bundle", sku: "88897904", msrp: 26.94 },
  { name: "151 Elite Trainer Box", type: "ETB", sku: "88897899", msrp: 49.99 },
  { name: "151 Poster Collection", type: "Poster", sku: "89444928", msrp: 14.99 },
  { name: "151 Ultra-Premium Collection", type: "UPC", sku: "88897906", msrp: 119.99 },
  { name: "151 Zapdos ex", type: "Ex Box", sku: "88897898", msrp: 21.99 },
  { name: "Ascended Heroes - Komala 2-Pack Blister", type: "Blister", sku: "95120837", msrp: 14.99 },
  { name: "Ascended Heroes - Tangela 2-Pack Blister", type: "Blister", sku: "95082122", msrp: 9.99 },
  { name: "Ascended Heroes Booster Bundle", type: "Booster Bundle", sku: "95120834", msrp: 26.94 },
  { name: "Ascended Heroes Collection Erika", type: "Tech Sticker", sku: "95173527", msrp: 9.99 },
  { name: "Ascended Heroes Collection Larry", type: "Tech Sticker", sku: "95173525", msrp: 9.99 },
  { name: "Ascended Heroes Deluxe Pin - Chikorita", type: "Pin Collection", sku: "95093980", msrp: 24.99 },
  { name: "Ascended Heroes Deluxe Pin - Tepig", type: "Pin Collection", sku: "95093984", msrp: 24.99 },
  { name: "Ascended Heroes Deluxe Pin - Totodile", type: "Pin Collection", sku: "95093987", msrp: 24.99 },
  { name: "Ascended Heroes Elite Trainer Box", type: "ETB", sku: "95082118", msrp: 59.99 },
  { name: "Ascended Heroes Ex Box", type: "Ex Box", sku: "95120830", msrp: 21.99 },
  { name: "Ascended Heroes First Partners Pin Collection", type: "Pin Collection", sku: "95093989", msrp: 24.99 },
  { name: "Ascended Heroes Knockout Collection", type: "Collection Box", sku: "95082124", msrp: 14.99 },
  { name: "Ascended Heroes Mini Tin", type: "Mini Tin", sku: "95022094", msrp: 9.99 },
  { name: "Ascended Heroes Poster Collection", type: "Poster Collection", sku: "95093988", msrp: 14.99 },
  { name: "Ascended Heroes Premium Poster - Mega Gardevoir", type: "Poster Collection", sku: "95093982", msrp: 19.99 },
  { name: "Ascended Heroes Premium Poster - Mega Lucario", type: "Poster Collection", sku: "95093981", msrp: 19.99 },
  { name: "Ascended Heroes Tech Sticker - Charmander", type: "Tech Sticker", sku: "1007935778", msrp: 9.99 },
  { name: "Ascended Heroes Tech Sticker - Gastly", type: "Tech Sticker", sku: "95120822", msrp: 9.99 },
  { name: "Black Bolt Binder Collection", type: "Binder", sku: "94636856", msrp: 29.99 },
  { name: "Black Bolt Booster Bundle", type: "Booster Bundle", sku: "94681770", msrp: 26.94 },
  { name: "Black Bolt Elite Trainer Box", type: "ETB", sku: "94636862", msrp: 49.99 },
  { name: "Black Kyurem ex & Melmetal ex (8 packs)", type: "Bundle", sku: "94827546", msrp: 39.99 },
  { name: "Brilliant Stars Elite Trainer Box", type: "ETB", sku: "84713762", msrp: 39.99 },
  { name: "Charizard ex Premium Collection", type: "Premium Collection", sku: "88897908", msrp: 39.99 },
  { name: "Charizard ex Super Premium Collection", type: "Super Premium", sku: "91670547", msrp: 79.99 },
  { name: "Charizard X Tin", type: "Mini Tin", sku: "95138464", msrp: 21.99 },
  { name: "Crown Zenith Booster Bundle", type: "Booster Bundle", sku: "94091405", msrp: 26.94 },
  { name: "Crown Zenith Elite Trainer Box", type: "ETB", sku: "87077756", msrp: 49.99 },
  { name: "Crown Zenith Premium Treasures", type: "Premium Collection", sku: "94681703", msrp: 39.99 },
  { name: "Cynthias Garchomp Ex Premium Collection", type: "Premium Collection", sku: "94411712", msrp: 44.99 },
  { name: "Destined Rivals Booster Box", type: "Booster Box", sku: "94681760", msrp: 143.64 },
  { name: "Destined Rivals Booster Bundle", type: "Booster Bundle", sku: "94300067", msrp: 26.94 },
  { name: "Destined Rivals Elite Trainer Box", type: "ETB", sku: "94300069", msrp: 49.99 },
  { name: "Fusion Strike Elite Trainer Box", type: "ETB", sku: "84600446", msrp: 39.99 },
  { name: "Lost Origin Elite Trainer Box", type: "ETB", sku: "87154260", msrp: 39.99 },
  { name: "Lugia ex & Latias ex Premium Collection", type: "Premium Collection", sku: "94681773", msrp: 39.99 },
  { name: "Mega Charizard Y Tin", type: "Mini Tin", sku: "95138474", msrp: 21.99 },
  { name: "Mega Latias ex Box", type: "Ex Box", sku: "94681763", msrp: 21.99 },
  { name: "Mega Lucario ex Figure Collection", type: "Figure Collection", sku: "95000353", msrp: 49.99 },
  { name: "Mimikyu ex & Alcremie ex Premium Collection", type: "Premium Collection", sku: "94681777", msrp: 39.99 },
  { name: "Paldean Fates Booster Bundle", type: "Booster Bundle", sku: "89432660", msrp: 26.94 },
  { name: "Paldean Fates Elite Trainer Box", type: "ETB", sku: "89432659", msrp: 49.99 },
  { name: "Paldean Fates Tech Sticker - Fidough", type: "Tech Sticker", sku: "90593734", msrp: 9.99 },
  { name: "Paldean Fates Tech Sticker - Greavard", type: "Tech Sticker", sku: "90593717", msrp: 9.99 },
  { name: "Paldean Fates Tech Sticker - Maschiff", type: "Tech Sticker", sku: "90593716", msrp: 9.99 },
  { name: "Phantasmal Flames Booster Box", type: "Booster Box", sku: "95040142", msrp: 129.99 },
  { name: "Pokemon Day 2026 Collection", type: "Special Collection", sku: "95082138", msrp: 14.99 },
  { name: "Pokemon Stellar Crown Booster Box", type: "Booster Box", sku: "92698334", msrp: 129.99 },
  { name: "Prismatic Accessory Pouch", type: "Blister", sku: "94300053", msrp: 29.99 },
  { name: "Prismatic Evolutions Binder Collection", type: "Binder", sku: "94300066", msrp: 29.99 },
  { name: "Prismatic Evolutions Booster Bundle", type: "Booster Bundle", sku: "93954446", msrp: 26.94 },
  { name: "Prismatic Evolutions Elite Trainer Box", type: "ETB", sku: "93954435", msrp: 49.99 },
  { name: "Prismatic Evolutions Poster Collection", type: "Poster", sku: "93803457", msrp: 14.99 },
  { name: "Prismatic Evolutions Premium Figure Collection", type: "Premium Collection", sku: "94864079", msrp: 49.99 },
  { name: "Prismatic Evolutions Super Premium Collection", type: "Super Premium", sku: "94300072", msrp: 79.99 },
  { name: "Prismatic Evolutions Surprise Box", type: "Surprise Box", sku: "94336414", msrp: 24.99 },
  { name: "Reshiram ex & Archaludon ex (8 packs)", type: "Bundle", sku: "94827540", msrp: 39.99 },
  { name: "SV Journey Together Booster Box", type: "ETB", sku: "93803439", msrp: 49.99 },
  { name: "SV Journey Together Booster Bundle", type: "Booster Bundle", sku: "94300074", msrp: 29.99 },
  { name: "SV Tech Sticker Glaceon", type: "Tech Sticker", sku: "94300080", msrp: 18.99 },
  { name: "SV Tech Sticker Leafeon", type: "Tech Sticker", sku: "94300075", msrp: 18.99 },
  { name: "SV Tech Sticker Sylveon", type: "Tech Sticker", sku: "94300058", msrp: 18.99 },
  { name: "Shrouded Fable Kingambit Illustration", type: "Special Collection", sku: "91619936", msrp: 21.99 },
  { name: "Silver Tempest Elite Trainer Box", type: "ETB", sku: "86933412", msrp: 39.99 },
  { name: "Surging Sparks Booster Box", type: "Booster Box", sku: "93486336", msrp: 143.64 },
  { name: "Surging Sparks Booster Bundle", type: "Booster Bundle", sku: "91619929", msrp: 27.99 },
  { name: "Surging Sparks Elite Trainer Box", type: "ETB", sku: "91619922", msrp: 49.99 },
  { name: "Twilight Masquerade Elite Trainer Box", type: "ETB", sku: "91619960", msrp: 49.99 },
  { name: "White Flare Binder Collection", type: "Binder", sku: "94636851", msrp: 29.99 },
  { name: "White Flare Booster Bundle", type: "Booster Bundle", sku: "94681785", msrp: 26.94 },
  { name: "White Flare Elite Trainer Box", type: "ETB", sku: "94636860", msrp: 49.99 },
  { name: "Perfect Order Elite Trainer Box", type: "ETB", sku: "95230445", msrp: 59.99 },
  { name: "Perfect Order Booster Bundle", type: "Booster Bundle", sku: "95230447", msrp: 26.94 },
  { name: "Perfect Order 3-Booster Blister", type: "Blister", sku: "95230446", msrp: 14.99 },
  { name: "Perfect Order Booster Display", type: "Booster Box", sku: "95252674", msrp: 143.64 },
];

// ── RUNTIME STATE ──────────────────────────────────────────────
var monitorRunning = false;
var totalChecks = 0;
var totalAlerts = 0;
var cycleCount = 0;
var dailyOrders = {}; // { sku: { count: N, date: "YYYY-MM-DD" } }
var startTime = null;
var alertCooldowns = new Map();
var logs = [];
var targetCookies = "";  // Set by Chrome extension cookie sync
var targetCookieArr = [];
var harvesterStatus = "ready";  // Always ready — extension manages session

// Credentials storage
var CREDS_FILE = path.join(__dirname, ".stockpulse-creds.json");
var credentials = { cvv: "", targetEmail: "", targetPassword: "", imapHost: "", imapPort: 993, imapEmail: "", imapPassword: "", savedCookies: "" };

function saveCredentials() {
  try { fs.writeFileSync(CREDS_FILE, JSON.stringify(credentials, null, 2)); } catch(e) {}
}
function loadCredentials() {
  try {
    if (fs.existsSync(CREDS_FILE)) {
      var data = JSON.parse(fs.readFileSync(CREDS_FILE, "utf8"));
      Object.keys(data).forEach(function(k) {
        if (k === "savedCookies") { targetCookies = data.savedCookies; }
        else { credentials[k] = data[k]; }
      });
      if (credentials.cvv) addLog("CVV loaded from disk", "system");
      if (credentials.targetPassword) addLog("Target password loaded from disk", "system");
    }
  } catch(e) {}
}
loadCredentials();

var products = SKU_LIST.map(function(p) {
  return {
    name: p.name, type: p.type, sku: p.sku, msrp: p.msrp,
    status: "IDLE", lastChecked: null, currentPrice: null,
    seller: null, isThirdParty: false, quantity: null,
    checks: 0, alerts: 0, shipAvailable: false,
    pickupAvailable: false, enabled: true, autoCheckout: false, lastAlerted: null,
  };
});

// ── PRODUCT STATE PERSISTENCE ──────────────────────────────────
var PRODUCTS_FILE = path.join(__dirname, ".stockpulse-products.json");

function saveProductState() {
  try {
    var state = products.map(function(p) {
      return {
        sku: p.sku, name: p.name, type: p.type, msrp: p.msrp,
        enabled: p.enabled, autoCheckout: p.autoCheckout,
      };
    });
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(state, null, 2));
  } catch(e) {}
}

function loadProductState() {
  try {
    if (!fs.existsSync(PRODUCTS_FILE)) return;
    var saved = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
    if (!Array.isArray(saved)) return;

    // Apply saved state to existing products
    saved.forEach(function(s) {
      var existing = products.find(function(p) { return p.sku === s.sku; });
      if (existing) {
        if (typeof s.enabled === "boolean") existing.enabled = s.enabled;
        if (typeof s.autoCheckout === "boolean") existing.autoCheckout = s.autoCheckout;
        if (s.name && s.name !== "Unknown") existing.name = s.name;
        if (s.msrp && s.msrp !== 999) existing.msrp = s.msrp;
        if (s.type) existing.type = s.type;
      } else {
        // Product was added dynamically — recreate it
        products.push({
          name: s.name || "Unknown", type: s.type || "Other", sku: s.sku, msrp: s.msrp || 0,
          status: "IDLE", lastChecked: null, currentPrice: null,
          seller: null, isThirdParty: false, quantity: null,
          checks: 0, alerts: 0, shipAvailable: false,
          pickupAvailable: false, enabled: s.enabled !== false, autoCheckout: !!s.autoCheckout, lastAlerted: null,
        });
      }
    });
    console.log("  Products:   " + products.length + " loaded (" + saved.length + " saved states applied)");
  } catch(e) {
    console.log("  Products:   load error — " + e.message);
  }
}

loadProductState();

// Clean up existing product names
products.forEach(function(p) {
  p.name = p.name
    .replace(/^Pok.*?mon Trading Card Game[:\s]*/i, "")
    .replace(/^Pok.*?mon TCG[:\s]*/i, "")
    .replace(/^Pokemon\s+/i, "")
    .replace(/&#\d+;/g, "")
    .trim();
});
saveProductState();

// Log file — rotates daily
var LOG_FILE = path.join(__dirname, "stockpulse.log");
var logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

function addLog(msg, type) {
  type = type || "info";
  logs.push({ msg: msg, type: type, time: new Date().toISOString() });
  if (logs.length > 500) logs.splice(0, logs.length - 500);
  var t = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  var d = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" });
  console.log("  " + t + "  [" + type + "] " + msg);
  logStream.write(d + " " + t + "  [" + type + "] " + msg + "\n");

  // Send important logs to Discord log channel
  if (CONFIG.DISCORD_LOG_WEBHOOK && (type === "success" || type === "error" || type === "warn")) {
    // Skip noisy extension poll errors
    if (msg.indexOf("Queue processor error: Failed to fetch") !== -1) return;
    if (msg.indexOf("Cookies received") !== -1) return;
    var emoji = type === "success" ? "✅" : type === "error" ? "❌" : "⚠️";
    fetch(CONFIG.DISCORD_LOG_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "StockPulse", content: emoji + " `" + t + "` " + msg })
    }).catch(function() {});
  }
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// Simple word overlap similarity for product name matching
function similarEnough(a, b) {
  var wordsA = a.split(/\s+/).filter(function(w) { return w.length > 2; });
  var wordsB = b.split(/\s+/).filter(function(w) { return w.length > 2; });
  var matches = 0;
  wordsA.forEach(function(w) { if (wordsB.indexOf(w) !== -1) matches++; });
  return matches >= 3 || (matches >= 2 && wordsA.length <= 4);
}

function canOrderToday(sku) {
  var today = new Date().toISOString().split("T")[0];
  var record = dailyOrders[sku];
  if (!record || record.date !== today) {
    return true; // No orders today or different day
  }
  return record.count < CONFIG.MAX_ORDERS_PER_SKU_PER_DAY;
}

function recordOrder(sku) {
  var today = new Date().toISOString().split("T")[0];
  if (!dailyOrders[sku] || dailyOrders[sku].date !== today) {
    dailyOrders[sku] = { count: 1, date: today };
  } else {
    dailyOrders[sku].count++;
  }
}


// ── TARGET API ─────────────────────────────────────────────────
var PAGE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
  "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1"
};

// Parse embedded __TGT_DATA__ from Target product page
function parseTgtData(html, sku) {
  var result = {
    status: "OUT_OF_STOCK", price: null, priceFormatted: null,
    seller: "Target", isThirdParty: false, quantity: null,
    shipAvailable: false, pickupAvailable: false, title: null
  };

  try {
    // Find the __TGT_DATA__ block — it's inside deepFreeze(JSON.parse("..."))
    var marker = "__TGT_DATA__";
    var idx = html.indexOf(marker);
    if (idx === -1) return result;

    // Find JSON.parse(" and extract the escaped JSON string
    var parseStart = html.indexOf('JSON.parse("', idx);
    if (parseStart === -1) return result;
    parseStart += 12; // skip past JSON.parse("

    // Find the closing ")) — the JSON string ends before it
    // We need to find unescaped closing quote
    var depth = 0;
    var pos = parseStart;
    var jsonStr = "";
    while (pos < html.length && pos < parseStart + 500000) {
      var ch = html[pos];
      if (ch === "\\" && pos + 1 < html.length) {
        jsonStr += ch + html[pos + 1];
        pos += 2;
        continue;
      }
      if (ch === '"') break; // unescaped quote = end of string
      jsonStr += ch;
      pos++;
    }

    // Unescape the JSON string
    jsonStr = jsonStr.replace(/\\"/g, '"').replace(/\\\\'/g, "'").replace(/\\\\/g, "\\");

    var data = JSON.parse(jsonStr);
    var queries = data && data.__PRELOADED_QUERIES__ && data.__PRELOADED_QUERIES__.queries;
    if (!queries || !queries.length) return result;

    // Search through preloaded queries for product data
    for (var i = 0; i < queries.length; i++) {
      var qData = queries[i] && queries[i][1] && queries[i][1].data;
      if (!qData) continue;

      // Look for product data with price
      var product = qData.product;
      if (product) {
        // Price info
        if (product.price) {
          var p = product.price;
          result.price = p.current_retail || p.reg_retail || p.current_retail_min || null;
          result.priceFormatted = p.formatted_current_price || (result.price ? "$" + result.price.toFixed(2) : null);
        }

        // Fulfillment
        if (product.fulfillment) {
          var ful = product.fulfillment;
          result.quantity = ful.purchase_limit || null;

          if (ful.shipping_options) {
            result.shipAvailable = ful.shipping_options.availability_status === "IN_STOCK";
          }
          if (ful.store_options && ful.store_options[0] && ful.store_options[0].order_pickup) {
            result.pickupAvailable = ful.store_options[0].order_pickup.availability_status === "IN_STOCK";
          }
          if (ful.scheduled_delivery) {
            var sd = ful.scheduled_delivery;
            if (sd.availability_status === "IN_STOCK") result.shipAvailable = true;
          }
        }

        // Seller
        if (product.item && product.item.primary_seller) {
          result.seller = product.item.primary_seller.name || "Target";
        }

        // Title
        if (product.item && product.item.product_description) {
          result.title = product.item.product_description.title;
        }
      }
    }
  } catch (err) {
    // JSON parse might fail on complex pages, try regex fallback
  }

  // Regex fallback for key fields if JSON parse didn't get them
  if (!result.price) {
    // Escaped quotes version (how data appears in HTML)
    var priceMatch = html.match(/\\"current_retail\\":([0-9.]+)/);
    if (!priceMatch) priceMatch = html.match(/"current_retail":([0-9.]+)/);
    if (!priceMatch) priceMatch = html.match(/\\"current_retail_min\\":([0-9.]+)/);
    if (!priceMatch) priceMatch = html.match(/"current_retail_min":([0-9.]+)/);
    if (!priceMatch) priceMatch = html.match(/\\"reg_retail\\":([0-9.]+)/);
    if (!priceMatch) priceMatch = html.match(/"reg_retail":([0-9.]+)/);
    if (priceMatch) result.price = parseFloat(priceMatch[1]);
  }

  if (!result.priceFormatted) {
    var fmtMatch = html.match(/\\"formatted_current_price\\":\\"([^\\]+)\\"/);
    if (!fmtMatch) fmtMatch = html.match(/"formatted_current_price":"([^"]+)"/);
    if (fmtMatch) result.priceFormatted = fmtMatch[1];
  }

  // Stock detection — check both escaped and unescaped patterns
  // Shipping
  var shipPatterns = [
    /\\"shipping_options\\"[^}]*?\\"availability_status\\":\\"([^\\]+)\\"/,
    /"shipping_options"[^}]*?"availability_status":"([^"]+)"/,
  ];
  for (var sp = 0; sp < shipPatterns.length; sp++) {
    var shipMatch = html.match(shipPatterns[sp]);
    if (shipMatch) { if (shipMatch[1] === "IN_STOCK") result.shipAvailable = true; break; }
  }

  // Pickup
  var pickupPatterns = [
    /\\"order_pickup\\"[^}]*?\\"availability_status\\":\\"([^\\]+)\\"/,
    /"order_pickup"[^}]*?"availability_status":"([^"]+)"/,
  ];
  for (var pp = 0; pp < pickupPatterns.length; pp++) {
    var pickupMatch = html.match(pickupPatterns[pp]);
    if (pickupMatch) { if (pickupMatch[1] === "IN_STOCK") result.pickupAvailable = true; break; }
  }

  // Delivery
  var delPatterns = [
    /\\"scheduled_delivery\\"[^}]*?\\"availability_status\\":\\"([^\\]+)\\"/,
    /"scheduled_delivery"[^}]*?"availability_status":"([^"]+)"/,
  ];
  for (var dp = 0; dp < delPatterns.length; dp++) {
    var delMatch = html.match(delPatterns[dp]);
    if (delMatch) { if (delMatch[1] === "IN_STOCK") result.shipAvailable = true; break; }
  }

  // Check for explicit OOS indicators — mark as definitively OOS
  var hasOosIndicator = false;
  var oosIndicators = [
    "Out of stock", "Sold out", "Item not available", 
    "not available at Target", "This item is no longer available",
    "Temporarily out of stock", "currently unavailable",
    "This item is now out of stock",
    "item isn\\'t available", "no longer carried"
  ];
  for (var oi = 0; oi < oosIndicators.length; oi++) {
    if (html.indexOf(oosIndicators[oi]) !== -1) {
      result.shipAvailable = false;
      result.pickupAvailable = false;
      hasOosIndicator = true;
      break;
    }
  }

  // If no fulfillment data was found in JSON AND no OOS indicators,
  // use secondary signals to determine stock status
  if (!result.shipAvailable && !result.pickupAvailable && !hasOosIndicator) {
    // Check for "There was a temporary issue" — Target shows this for items 
    // that have ATC button but can't actually be purchased
    if (html.indexOf("There was a temporary issue") !== -1) {
      result.status = "OUT_OF_STOCK";
      return result;
    }

    // Check for positive fulfillment signals in the HTML
    // These appear as visible text on the page (not in JSON)
    var positiveSignals = [
      "Ready within", "Pick up at", "Get it by",
      "Shipping", "Arrives by", "Delivers by",
      "Same Day Delivery", "Order Pickup",
      "Free shipping", "Ships to",
      "Add to cart", "Ship it"
    ];
    var negativeSignals = [
      "Notify me when it's back",
      "See similar items",
      "delivery not available",
      "shipping not available",
      "not sold at this store"
    ];

    var positiveCount = 0;
    var negativeCount = 0;
    for (var ps = 0; ps < positiveSignals.length; ps++) {
      if (html.indexOf(positiveSignals[ps]) !== -1) positiveCount++;
    }
    for (var ns = 0; ns < negativeSignals.length; ns++) {
      if (html.indexOf(negativeSignals[ns]) !== -1) negativeCount++;
    }

    // If we have strong positive signals and no negative, likely in stock
    // Require at least 2 positive signals to avoid false positives
    if (positiveCount >= 2 && negativeCount === 0) {
      result.shipAvailable = true;
    }
  }

  // Purchase limit
  if (!result.quantity) {
    var limitMatch = html.match(/\\"purchase_limit\\":(\d+)/);
    if (!limitMatch) limitMatch = html.match(/"purchase_limit":(\d+)/);
    if (limitMatch) result.quantity = parseInt(limitMatch[1]);
  }

  // Seller
  var sellerMatch = html.match(/\\"primary_seller\\"[^}]*?\\"name\\":\\"([^\\]+)\\"/);
  if (!sellerMatch) sellerMatch = html.match(/"primary_seller"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
  if (sellerMatch) result.seller = sellerMatch[1];

  // Title fallback
  if (!result.title) {
    var titleMatch = html.match(/\\"seo_h1\\":\\"([^\\]+)\\"/);
    if (!titleMatch) titleMatch = html.match(/"seo_h1":"([^"]+)"/);
    if (titleMatch) result.title = titleMatch[1];
  }

  result.isThirdParty = result.seller.toLowerCase() !== "target" && result.seller.toLowerCase() !== "target corporation";
  result.status = (result.shipAvailable || result.pickupAvailable) ? "IN_STOCK" : "OUT_OF_STOCK";

  return result;
}

async function checkSingleSku(sku) {
  var result = {
    status: "OUT_OF_STOCK", price: null, priceFormatted: null,
    seller: "Target", isThirdParty: false, quantity: null,
    shipAvailable: false, pickupAvailable: false, title: null
  };

  // Step 1: Call Redsky product_fulfillment API (lightweight, ~5KB response)
  try {
    var K = CONFIG.API_KEY;
    var fulfillUrl = "https://redsky.target.com/redsky_aggregations/v1/web/product_fulfillment_v1"
      + "?key=" + K
      + "&tcin=" + sku
      + "&store_id=" + CONFIG.STORE_ID
      + "&zip=" + CONFIG.ZIP_CODE
      + "&state=MN"
      + "&latitude=44.68&longitude=-93.40"
      + "&scheduled_delivery_store_id=" + CONFIG.STORE_ID
      + "&pricing_store_id=" + CONFIG.STORE_ID
      + "&has_pricing_store_id=true"
      + "&is_bot=false";

    var agent = getProxyAgent();
    var headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Referer": "https://www.target.com/p/-/A-" + sku,
      "Origin": "https://www.target.com",
    };
    // Add cookies if available (helps avoid 404s)
    if (targetCookies) headers["Cookie"] = targetCookies;

    var opts = { headers: headers };
    if (agent) opts.agent = agent;

    var res = await fetch(fulfillUrl, opts);

    if (res.ok) {
      var data = await res.json();
      var product = data && data.data && data.data.product;

      if (product) {
        // Fulfillment info
        var ful = product.fulfillment;
        if (ful) {
          // Overall OOS flag
          if (ful.is_out_of_stock_in_all_store_locations === false || ful.sold_out === false) {
            // Not definitively OOS — check shipping/pickup
          }

          // Shipping
          if (ful.shipping_options) {
            var ship = ful.shipping_options;
            if (ship.availability_status === "IN_STOCK") result.shipAvailable = true;
            if (ship.reason_code === "IN_STOCK") result.shipAvailable = true;
          }

          // Store pickup
          if (ful.store_options && ful.store_options.length > 0) {
            var store = ful.store_options[0];
            if (store.order_pickup && store.order_pickup.availability_status === "IN_STOCK") {
              result.pickupAvailable = true;
            }
            if (store.in_store_only && store.in_store_only.availability_status === "IN_STOCK") {
              result.pickupAvailable = true;
            }
          }

          // Scheduled delivery
          if (ful.scheduled_delivery && ful.scheduled_delivery.availability_status === "IN_STOCK") {
            result.shipAvailable = true;
          }

          // Purchase limit
          result.quantity = ful.purchase_limit || null;
        }

        // Price info
        if (product.price) {
          var p = product.price;
          result.price = p.current_retail || p.reg_retail || p.current_retail_min || null;
          result.priceFormatted = p.formatted_current_price || (result.price ? "$" + result.price.toFixed(2) : null);
        }

        // Product info
        if (product.item) {
          var item = product.item;
          if (item.product_description && item.product_description.title) {
            result.title = item.product_description.title
              .replace(/^Pok.*?mon Trading Card Game[:\s]*/i, "")
              .replace(/^Pok.*?mon TCG[:\s]*/i, "")
              .trim();
          }
          if (item.primary_seller && item.primary_seller.name) {
            result.seller = item.primary_seller.name;
          }
          if (item.relationship_type_code && item.relationship_type_code !== "SA") {
            result.isThirdParty = true;
          }
        }

        result.isThirdParty = result.seller.toLowerCase() !== "target" && result.seller.toLowerCase() !== "target corporation";
        result.status = (result.shipAvailable || result.pickupAvailable) ? "IN_STOCK" : "OUT_OF_STOCK";
        return result;
      }
    }
    // If 404/410, fall through to HTML method
  } catch(err) {
    // API failed, fall through
  }

  // Step 2: Fallback — fetch HTML for price/title
  try {
    var url = "https://www.target.com/p/-/A-" + sku;
    var agent2 = getProxyAgent();
    var opts2 = { headers: PAGE_HEADERS, redirect: "follow", timeout: 15000 };
    if (agent2) opts2.agent = agent2;
    var res2 = await fetch(url, opts2);
    if (res2.ok) {
      var html = await res2.text();
      var parsed = parseTgtData(html, sku);
      if (parsed.price) result.price = parsed.price;
      if (parsed.priceFormatted) result.priceFormatted = parsed.priceFormatted;
      if (parsed.title) result.title = parsed.title;
      if (parsed.seller) result.seller = parsed.seller;
      result.isThirdParty = parsed.isThirdParty;
      if (parsed.quantity) result.quantity = parsed.quantity;

      if (html.indexOf("Item not available") !== -1 || 
          html.indexOf("not available at Target") !== -1) {
        result.status = "OUT_OF_STOCK";
        return result;
      }
    }
  } catch(err) {}

  // Stock check relies on Redsky API only — ATC is reserved for actual purchases
  return result;
}
// ── DISCORD ────────────────────────────────────────────────────
async function sendCheckoutSuccess(product, orderInfo) {
  if (!CONFIG.DISCORD_CHECKOUT_WEBHOOK) return;
  try {
    await fetch(CONFIG.DISCORD_CHECKOUT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "StockPulse",
        content: "@everyone ORDER PLACED!",
        embeds: [{
          title: "ORDER: " + (product ? product.name : "Unknown"),
          color: 65280,
          fields: [
            { name: "SKU", value: product ? product.sku : "?", inline: true },
            { name: "Qty", value: String(CONFIG.ATC_QTY || 2), inline: true },
            { name: "Price", value: product && product.currentPrice ? "$" + product.currentPrice : "N/A", inline: true },
          ],
          timestamp: new Date().toISOString(),
          footer: { text: "StockPulse Auto-Checkout" },
        }],
      }),
    });
  } catch(e) {}
}

async function sendDiscordAlert(product, result) {
  if (!CONFIG.DISCORD_WEBHOOK) return;
  var last = alertCooldowns.get(product.sku);
  if (last && Date.now() - last < CONFIG.ALERT_COOLDOWN_MS) return;
  alertCooldowns.set(product.sku, Date.now());

  var atcLink = "https://www.target.com/co-cart?tcin=" + product.sku + "&quantity=" + (CONFIG.ATC_QTY || 1);
  var checkoutLink = "https://www.target.com/checkout";
  var cartedMsg = (CONFIG.AUTO_ATC && harvesterStatus === "ready") ? "ADDED TO CART — click Checkout!" : "Click ATC link below";

  try {
    var res = await fetch(CONFIG.DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "StockPulse",
        content: "@everyone " + cartedMsg,
        embeds: [{
          title: "IN STOCK: " + product.name,
          url: "https://www.target.com/p/-/A-" + product.sku,
          color: 65416,
          fields: [
            { name: "SKU", value: product.sku, inline: true },
            { name: "Type", value: product.type, inline: true },
            { name: "MSRP", value: "$" + product.msrp, inline: true },
            { name: "Price", value: result.priceFormatted || "N/A", inline: true },
            { name: "Seller", value: result.seller || "Target", inline: true },
            { name: "Qty Limit", value: result.quantity ? String(result.quantity) + " per guest" : "No limit", inline: true },
            { name: "Add to Cart", value: "[ATC Link](" + atcLink + ")", inline: true },
            { name: "Checkout", value: "[Go to Checkout](" + checkoutLink + ")", inline: true },
          ],
          thumbnail: { url: "https://target.scene7.com/is/image/Target/" + product.sku },
          timestamp: new Date().toISOString(),
          footer: { text: "StockPulse" },
        }],
      }),
    });
    if (res.ok) addLog("Discord sent: " + product.name, "discord");
    else addLog("Discord error " + res.status, "error");
  } catch (err) {
    addLog("Discord failed: " + err.message, "error");
  }
}

// ── COOKIE HARVESTER & INSTANT ATC ─────────────────────────────

// ── AUTO LOGIN ─────────────────────────────────────────────────

app.get("/", function(req, res) {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.get("/config", function(req, res) {
  res.sendFile(path.join(__dirname, "config.html"));
});

// Config API — get all config (mask sensitive values)
app.get("/api/config", function(req, res) {
  var masked = JSON.parse(JSON.stringify(CONFIG));
  // Show last 8 chars of webhooks/tokens for verification
  function mask(val) {
    if (!val || typeof val !== "string" || val.length < 12) return val ? "••••" : "";
    return "••••" + val.substring(val.length - 8);
  }
  masked._raw = JSON.parse(JSON.stringify(CONFIG)); // full values for show/hide
  res.json(masked);
});

app.get("/api/config/raw", function(req, res) {
  res.json(CONFIG);
});

app.post("/api/config", function(req, res) {
  var updates = req.body || {};
  var protected_keys = ["DISCORD_CHECKOUT_WEBHOOK", "DISCORD_VERIFY_SERVER_ID", "DISCORD_VERIFY_ROLE_NAME"];
  Object.keys(updates).forEach(function(k) {
    if (k in CONFIG && protected_keys.indexOf(k) === -1) CONFIG[k] = updates[k];
  });
  saveConfig();
  addLog("Config updated: " + Object.keys(updates).join(", "), "system");
  res.json({ ok: true });
});

app.get("/api/state", function(req, res) {
  res.json({
    products: products,
    logs: logs.slice(-200),
    config: { msrpThreshold: CONFIG.MAX_PERCENT_ABOVE_MSRP, autoAtc: CONFIG.AUTO_ATC },
    harvester: harvesterStatus,
    tokenExpiry: null,
    atcQty: CONFIG.ATC_QTY,
    hasCredentials: !!(credentials.targetEmail && credentials.targetPassword),
    hasImap: !!(credentials.imapEmail && credentials.imapPassword),
    stats: {
      running: monitorRunning, totalChecks: totalChecks,
      totalAlerts: totalAlerts, cycleCount: cycleCount,
      uptime: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0,
      inStock: products.filter(function(p) { return p.status === "IN_STOCK"; }).length,
      enabled: products.filter(function(p) { return p.enabled; }).length,
    },
  });
});

app.post("/api/start", async function(req, res) {
  if (!monitorRunning) {
    // Verify Discord role before starting (only if user token is set)
    if (CONFIG.DISCORD_USER_TOKEN && CONFIG.DISCORD_VERIFY_SERVER_ID && CONFIG.DISCORD_VERIFY_ROLE_NAME) {
      addLog("Verifying Discord membership...", "system");
      var verify = await verifyDiscordRole();
      if (!verify.ok) {
        addLog("ACCESS DENIED: " + verify.error, "error");
        return res.json({ ok: false, error: verify.error });
      }
      addLog("✓ Verified: " + verify.username + " has role '" + verify.role + "'", "success");
    }
    monitorRunning = true;
    startTime = Date.now();
    addLog("Monitor STARTED — open Discord channel in Chrome to receive alerts", "system");
  }
  res.json({ ok: true });
});

app.post("/api/stop", function(req, res) {
  monitorRunning = false;
  addLog("Monitor STOPPED", "system");
  res.json({ ok: true });
});

app.post("/api/toggle/:sku", function(req, res) {
  var p = products.find(function(x) { return x.sku === req.params.sku; });
  if (p) { p.enabled = !p.enabled; saveProductState(); res.json({ ok: true }); }
  else res.status(404).json({ error: "not found" });
});

app.post("/api/toggle-all", function(req, res) {
  products.forEach(function(p) { p.enabled = !!req.body.enabled; });
  saveProductState();
  res.json({ ok: true });
});

app.post("/api/set-qty", function(req, res) {
  var qty = parseInt(req.body.qty) || 2;
  if (qty < 1) qty = 1;
  if (qty > 10) qty = 10;
  CONFIG.ATC_QTY = qty;
  addLog("ATC quantity set to " + qty, "system");
  res.json({ ok: true, qty: qty });
});

app.post("/api/toggle-checkout/:sku", function(req, res) {
  var p = products.find(function(x) { return x.sku === req.params.sku; });
  if (p) { p.autoCheckout = !p.autoCheckout; saveProductState(); res.json({ ok: true }); }
  else res.status(404).json({ error: "not found" });
});

// ── MSRP DETECTION ─────────────────────────────────────────────
async function detectMsrp(product) {
  try {
    var result = await checkSingleSku(product.sku);
    if (result.price || result.title) {
      return { price: result.price, title: result.title };
    }
    // Fallback: PDP API
    try {
      var pdpUrl = "https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1?key=" + CONFIG.API_KEY
        + "&tcin=" + product.sku + "&pricing_store_id=" + CONFIG.STORE_ID
        + "&has_pricing_store_id=true&store_id=" + CONFIG.STORE_ID;
      var pdpRes = await fetch(pdpUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "application/json", "Referer": "https://www.target.com/p/-/A-" + product.sku, "Origin": "https://www.target.com" }
      });
      if (pdpRes.ok) {
        var pdpData = await pdpRes.json();
        var pp = pdpData && pdpData.data && pdpData.data.product;
        if (pp) {
          var price = null, title = null;
          if (pp.price) { var p = pp.price.current_retail || pp.price.reg_retail; if (typeof p === "string") p = parseFloat(p.replace(/[^0-9.]/g, "")); if (p > 0) price = p; }
          if (pp.item && pp.item.product_description) { title = (pp.item.product_description.title || "").replace(/<[^>]+>/g, "").replace(/&#\d+;/g, "").trim(); }
          if (price || title) return { price: price, title: title };
        }
      }
    } catch(e) {}
    return null;
  } catch(e) { return null; }
}

async function autoDetectAllMsrps() {
  addLog("Auto-detecting MSRPs for " + products.length + " products...", "system");
  var updated = 0, titled = 0, errors = 0;
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    if (i % 10 === 0 && i > 0) addLog("Scanning... " + i + "/" + products.length, "system");
    var result = await detectMsrp(p);
    if (result) {
      if (result.price && result.price > 0) {
        var oldMsrp = p.msrp;
        p.msrp = result.price;
        if (oldMsrp !== result.price) { updated++; addLog("MSRP " + p.sku + ": $" + oldMsrp + " -> $" + result.price + " (" + p.name + ")", "info"); }
      }
      if (result.title) {
        var cleanTitle = result.title.replace(/^Pok.*?mon Trading Card Game[:\s]*/i, "").replace(/^Pok.*?mon TCG[:\s]*/i, "").replace(/^Pokemon\s+/i, "").replace(/&#\d+;/g, "").trim();
        if (cleanTitle) p.name = cleanTitle;
        titled++;
      }
    } else { errors++; }
    await sleep(CONFIG.REQUEST_DELAY_MS);
  }
  addLog("MSRP scan done: " + updated + " prices, " + titled + " titles, " + errors + " errors", "system");
  saveProductState();
}

app.post("/api/scan-msrp", async function(req, res) {
  autoDetectAllMsrps();
  res.json({ ok: true, msg: "MSRP scan started" });
});


app.get("/api/harvester/status", function(req, res) {
  res.json({ status: harvesterStatus });
});

app.post("/api/harvester/credentials", function(req, res) {
  var b = req.body || {};
  if (b.targetEmail) credentials.targetEmail = b.targetEmail;
  if (b.targetPassword) credentials.targetPassword = b.targetPassword;
  if (b.imapHost) credentials.imapHost = b.imapHost;
  if (b.imapPort) credentials.imapPort = parseInt(b.imapPort) || 993;
  if (b.imapEmail) credentials.imapEmail = b.imapEmail;
  if (b.imapPassword) credentials.imapPassword = b.imapPassword;
  if (b.cvv) credentials.cvv = b.cvv;
  saveCredentials();
  var saved = [];
  if (b.targetPassword) saved.push("password");
  if (b.cvv) saved.push("cvv");
  if (b.targetEmail) saved.push("email");
  addLog("Credentials saved: " + (saved.length ? saved.join(", ") : "other"), "system");
  res.json({ ok: true });
});

app.get("/api/harvester/credentials", function(req, res) {
  res.json({
    hasTargetPassword: !!credentials.targetPassword,
    hasCvv: !!credentials.cvv,
  });
});



app.post("/api/test-checkout/:sku", async function(req, res) {
  var sku = req.params.sku;
  var product = products.find(function(p) { return p.sku === sku; });
  if (!product) return res.status(404).json({ ok: false, error: "SKU not found" });
  
  addLog("═══ TEST CHECKOUT: " + product.name + " (" + sku + ") ═══", "system");
  
  // Check CVV
  if (!credentials.cvv) {
    addLog("TEST: No CVV saved", "error");
    return res.json({ ok: false, error: "Save CVV in Settings first" });
  }

  // Queue browser ATC
  addLog("TEST: Queuing browser ATC x" + CONFIG.ATC_QTY, "system");
  pendingAtc = {
    sku: sku,
    qty: CONFIG.ATC_QTY || 2,
    timestamp: Date.now(),
    status: "pending"
  };

  // Wait for ATC result (up to 30s)
  for (var i = 0; i < 60; i++) {
    await sleep(500);
    if (pendingAtc && (pendingAtc.status === "success" || pendingAtc.status === "failed")) break;
  }

  if (!pendingAtc || pendingAtc.status !== "success") {
    addLog("TEST: ATC failed or timed out", "error");
    return res.json({ ok: false, error: "ATC failed" });
  }
  addLog("TEST: ATC success — item in cart", "success");

  // Check daily limit
  if (!canOrderToday(sku)) {
    addLog("TEST: Daily limit reached for " + sku + " — aborting", "warn");
    return res.json({ ok: false, error: "Daily limit reached" });
  }

  // Browser ATC result handler already queued checkout — just wait for it
  addLog("TEST: Waiting for browser checkout...", "system");

  // Wait for checkout result (up to 3 min)
  for (var j = 0; j < 360; j++) {
    await sleep(500);
    if (pendingCheckout && (pendingCheckout.status === "success" || pendingCheckout.status === "failed")) break;
  }

  if (pendingCheckout && pendingCheckout.status === "success") {
    addLog("═══ TEST ORDER PLACED! ═══", "success");
    // recordOrder and Discord notification handled by browser-checkout result handler
    return res.json({ ok: true });
  } else {
    addLog("TEST: Checkout failed or timed out", "error");
    return res.json({ ok: false, error: "Checkout failed" });
  }
});

app.get("/api/discord-channels", function(req, res) {
  var channels = [];
  if (CONFIG.DISCORD_LISTEN_CHANNELS) {
    Object.keys(CONFIG.DISCORD_LISTEN_CHANNELS).forEach(function(key) {
      var ch = CONFIG.DISCORD_LISTEN_CHANNELS[key];
      channels.push({
        key: key,
        name: ch.name,
        id: ch.id,
        active: CONFIG.DISCORD_ACTIVE_CHANNELS.indexOf(key) !== -1
      });
    });
  }
  res.json({ channels: channels });
});

app.post("/api/discord-channels/toggle/:key", function(req, res) {
  var key = req.params.key;
  var idx = CONFIG.DISCORD_ACTIVE_CHANNELS.indexOf(key);
  if (idx !== -1) {
    CONFIG.DISCORD_ACTIVE_CHANNELS.splice(idx, 1);
    addLog("Discord channel OFF: " + key, "system");
  } else {
    CONFIG.DISCORD_ACTIVE_CHANNELS.push(key);
    addLog("Discord channel ON: " + key, "system");
  }
  res.json({ ok: true, active: CONFIG.DISCORD_ACTIVE_CHANNELS });
});

// ── ADD PRODUCT (by URL or TCIN) ───────────────────────────────
app.post("/api/add-product", async function(req, res) {
  var input = (req.body.url || "").trim();
  if (!input) return res.status(400).json({ error: "No URL or TCIN provided" });

  var tcins = [];

  // Clean up URL - remove hash and query params for TCIN extraction
  var cleanInput = input.split("#")[0].split("?")[0];

  // Also check for preselect param which indicates the actual variant TCIN
  var preselect = null;
  try {
    var urlObj = new URL(input);
    preselect = urlObj.searchParams.get("preselect");
  } catch(e) {}

  // Extract TCIN from various URL formats
  // Single product: /A-95230445 or just 95230445
  var singleMatch = cleanInput.match(/A-(\d+)/);
  if (singleMatch) {
    tcins.push(singleMatch[1]);
    // Also add preselect variant if different
    if (preselect && preselect !== singleMatch[1]) {
      tcins.push(preselect);
    }
  } else if (/^\d{5,12}$/.test(input.trim())) {
    tcins.push(input.trim());
  }

  // Product list page: /pl/522435401 — scrape the HTML page for TCINs
  var plMatch = input.match(/\/pl\/(\d+)/);
  if (plMatch) {
    try {
      addLog("Fetching product list " + plMatch[1] + "...", "system");
      var agent = getProxyAgent();
      var opts = { headers: PAGE_HEADERS, redirect: "follow" };
      if (agent) opts.agent = agent;
      var listRes = await fetch("https://www.target.com/pl/" + plMatch[1], opts);
      if (listRes.ok) {
        var listHtml = await listRes.text();
        // Extract TCINs from the page — they appear as /A-XXXXXXXX in links
        var tcinMatches = listHtml.match(/\/A-(\d{7,12})/g);
        if (tcinMatches) {
          var seen = {};
          tcinMatches.forEach(function(m) {
            var t = m.replace("/A-", "");
            if (!seen[t]) { tcins.push(t); seen[t] = true; }
          });
          addLog("Found " + tcins.length + " products in list page", "system");
        }
      } else {
        addLog("List page returned " + listRes.status, "error");
      }
    } catch (err) {
      addLog("Error fetching product list: " + err.message, "error");
    }
  }

  // Category page: /N-XXXXX pattern
  var categoryMatch = input.match(/\/N-([a-zA-Z0-9]+)/);
  if (categoryMatch && tcins.length === 0) {
    try {
      var agent2 = getProxyAgent();
      var opts2 = { headers: PAGE_HEADERS, redirect: "follow" };
      if (agent2) opts2.agent = agent2;
      var catRes = await fetch(input, opts2);
      if (catRes.ok) {
        var catHtml = await catRes.text();
        var catMatches = catHtml.match(/\/A-(\d{7,12})/g);
        if (catMatches) {
          var seen2 = {};
          catMatches.forEach(function(m) {
            var t = m.replace("/A-", "");
            if (!seen2[t]) { tcins.push(t); seen2[t] = true; }
          });
        }
      }
    } catch (err) {
      addLog("Category fetch error: " + err.message, "error");
    }
  }

  if (tcins.length === 0) {
    return res.status(400).json({ error: "Could not extract any product IDs from that URL" });
  }

  // Dedupe and skip existing
  var existingSkus = {};
  products.forEach(function(p) { existingSkus[p.sku] = true; });
  tcins = tcins.filter(function(t) { return !existingSkus[t]; });

  if (tcins.length === 0) {
    return res.json({ ok: true, added: 0, msg: "All products already in database" });
  }

  // Fetch product info for each new TCIN
  var added = 0;
  for (var i = 0; i < tcins.length; i++) {
    var tcin = tcins[i];
    try {
      var name = "Unknown Product " + tcin;
      var msrp = 0;
      var type = "Unknown";

      // Try Redsky fulfillment API first
      var scrapeResult = await checkSingleSku(tcin);
      
      if (scrapeResult.status !== "ERROR") {
        if (scrapeResult.price) msrp = scrapeResult.price;
        if (scrapeResult.title) {
          name = scrapeResult.title
            .replace(/^Pok.*?mon Trading Card Game[:\s]*/i, "")
            .replace(/^Pok.*?mon TCG[:\s]*/i, "")
            .replace(/^Pokemon\s+/i, "")
            .replace(/&#\d+;/g, "")
            .trim();
        }
        
        // Try to auto-detect type from name
        var nameLower = name.toLowerCase();
        if (nameLower.indexOf("elite trainer box") !== -1 || nameLower.indexOf("etb") !== -1) type = "ETB";
        else if (nameLower.indexOf("booster bundle") !== -1) type = "Booster Bundle";
        else if (nameLower.indexOf("booster box") !== -1 || nameLower.indexOf("booster display") !== -1) type = "Booster Box";
        else if (nameLower.indexOf("blister") !== -1) type = "Blister";
        else if (nameLower.indexOf("ultra-premium") !== -1 || nameLower.indexOf("ultra premium") !== -1) type = "UPC";
        else if (nameLower.indexOf("super premium") !== -1) type = "Super Premium";
        else if (nameLower.indexOf("premium") !== -1 && nameLower.indexOf("figure") !== -1) type = "Figure Collection";
        else if (nameLower.indexOf("premium") !== -1) type = "Premium Collection";
        else if (nameLower.indexOf("binder") !== -1) type = "Binder";
        else if (nameLower.indexOf("tech sticker") !== -1) type = "Tech Sticker";
        else if (nameLower.indexOf("pin collection") !== -1 || nameLower.indexOf("pin box") !== -1) type = "Pin Collection";
        else if (nameLower.indexOf("mini tin") !== -1) type = "Mini Tin";
        else if (nameLower.indexOf("poster") !== -1) type = "Poster Collection";
        else if (nameLower.indexOf("surprise box") !== -1) type = "Surprise Box";
        else if (nameLower.indexOf("ex box") !== -1 || nameLower.indexOf("collection box") !== -1) type = "Ex Box";
        else if (nameLower.indexOf("tin") !== -1) type = "Mini Tin";
        else if (nameLower.indexOf("bundle") !== -1) type = "Bundle";
        else if (nameLower.indexOf("collection") !== -1) type = "Collection Box";
        else if (nameLower.indexOf("booster") !== -1 || nameLower.indexOf("pack") !== -1) type = "Blister";
      }

      // Fallback: if price still 0, try Redsky product summary API directly
      if (!msrp || name.indexOf("Unknown") === 0) {
        try {
          var pdpUrl = "https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1?key=" + CONFIG.API_KEY
            + "&tcin=" + tcin
            + "&pricing_store_id=" + CONFIG.STORE_ID
            + "&has_pricing_store_id=true"
            + "&scheduled_delivery_store_id=" + CONFIG.STORE_ID
            + "&store_id=" + CONFIG.STORE_ID;
          var pdpRes = await fetch(pdpUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              "Accept": "application/json",
              "Referer": "https://www.target.com/p/-/A-" + tcin,
              "Origin": "https://www.target.com",
            }
          });
          if (pdpRes.ok) {
            var pdpData = await pdpRes.json();
            var pdpProduct = pdpData && pdpData.data && pdpData.data.product;
            if (pdpProduct) {
              // Get price
              var pdpPrice = pdpProduct.price;
              if (pdpPrice) {
                var p = pdpPrice.current_retail || pdpPrice.reg_retail || pdpPrice.formatted_current_price;
                if (typeof p === "string") p = parseFloat(p.replace(/[^0-9.]/g, ""));
                if (p && p > 0) msrp = p;
              }
              // Get title
              var pdpItem = pdpProduct.item;
              if (pdpItem && pdpItem.product_description) {
                var pdpTitle = pdpItem.product_description.title || "";
                if (pdpTitle && name.indexOf("Unknown") === 0) {
                  name = pdpTitle
                    .replace(/^Pok.*?mon Trading Card Game[:\s]*/i, "")
                    .replace(/^Pok.*?mon TCG[:\s]*/i, "")
                    .replace(/^Pokemon\s+/i, "")
                    .replace(/&#\d+;/g, "")
                    .replace(/<[^>]+>/g, "")
                    .trim();
                }
              }
            }
          }
          addLog("PDP API fallback: $" + msrp + " — " + name.substring(0, 50), "info");
        } catch(e) {
          addLog("PDP API fallback failed: " + e.message, "warn");
        }
      }

      products.push({
        name: name, type: type, sku: tcin, msrp: msrp || 0,
        status: scrapeResult.status !== "ERROR" ? scrapeResult.status : "IDLE",
        lastChecked: scrapeResult.status !== "ERROR" ? new Date().toISOString() : null,
        currentPrice: scrapeResult.price || null,
        seller: scrapeResult.seller || null,
        isThirdParty: !!scrapeResult.isThirdParty,
        quantity: scrapeResult.quantity || null,
        checks: scrapeResult.status !== "ERROR" ? 1 : 0,
        alerts: 0,
        shipAvailable: !!scrapeResult.shipAvailable,
        pickupAvailable: !!scrapeResult.pickupAvailable,
        enabled: true, autoCheckout: false, lastAlerted: null,
      });
      added++;
      if (!msrp) {
        addLog("Added: " + name + " (" + tcin + ") — PRICE UNKNOWN, run Scan MSRPs [" + type + "]", "warn");
      } else {
        addLog("Added: " + name + " (" + tcin + ") $" + msrp + " [" + type + "] " + scrapeResult.status, "success");
      }
    } catch (err) {
      addLog("Error adding " + tcin + ": " + err.message, "error");
    }
    await sleep(CONFIG.REQUEST_DELAY_MS);
  }

  saveProductState();
  res.json({ ok: true, added: added, total: products.length });

  // Stock already checked during add — no need for separate scan
});

// ── DELETE PRODUCT ──────────────────────────────────────────────
app.post("/api/delete/:sku", function(req, res) {
  var idx = products.findIndex(function(p) { return p.sku === req.params.sku; });
  if (idx !== -1) {
    var name = products[idx].name;
    products.splice(idx, 1);
    saveProductState();
    addLog("Deleted: " + name + " (" + req.params.sku + ")", "warn");
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: "SKU not found" });
  }
});

// ── DELETE ALL PRODUCTS ─────────────────────────────────────────
app.post("/api/delete-all", function(req, res) {
  var count = products.length;
  products.length = 0;
  saveProductState();
  addLog("Deleted all " + count + " products", "warn");
  res.json({ ok: true, deleted: count });
});

app.post("/api/test-discord", async function(req, res) {
  if (!CONFIG.DISCORD_WEBHOOK) return res.status(400).json({ error: "No webhook" });
  try {
    var r = await fetch(CONFIG.DISCORD_WEBHOOK, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "StockPulse", embeds: [{ title: "StockPulse Test", description: "Discord alerts are working!", color: 3447003, timestamp: new Date().toISOString(), footer: { text: "StockPulse" } }] }),
    });
    if (r.ok) { addLog("Test Discord sent!", "success"); res.json({ ok: true }); }
    else res.status(r.status).json({ error: "Discord returned " + r.status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── START ──────────────────────────────────────────────────────
// ── BROWSER ATC (via Chrome extension) ─────────────────────────
// Node.js ATC fails due to PerimeterX fingerprinting.
// Instead, StockPulse queues ATC requests and the Chrome extension
// executes them from the real browser context.
var pendingAtc = null;
var pendingAtcQueue = [];

app.post("/api/browser-atc", function(req, res) {
  pendingAtc = {
    sku: req.body.sku,
    qty: req.body.qty || CONFIG.ATC_QTY || 2,
    timestamp: Date.now(),
    status: "pending"
  };
  addLog("Browser ATC queued: " + req.body.sku + " x" + pendingAtc.qty, "system");
  res.json({ ok: true });
});

// ── DISCORD WATCHER ALERTS (from Chrome extension DOM scraper) ──
app.post("/api/discord-alert", async function(req, res) {
  var body = req.body || {};
  var tcins = body.tcins || [];
  var message = body.message || "";
  var productName = body.productName || "";
  
  // If no TCINs found, try to match by product name
  if (tcins.length === 0 && productName) {
    var cleanName = productName
      .replace(/^Pok[eéè]mon Trading Card Game[:\s]*/i, "")
      .replace(/^Pok[eéè]mon TCG[:\s]*/i, "")
      .replace(/^Pokemon\s+/i, "")
      .trim().toLowerCase();
    
    products.forEach(function(p) {
      var pName = p.name.toLowerCase();
      // Fuzzy match — check if key words overlap
      if (cleanName && pName && (
        pName.indexOf(cleanName) !== -1 || 
        cleanName.indexOf(pName) !== -1 ||
        (cleanName.length > 10 && pName.length > 10 && similarEnough(cleanName, pName))
      )) {
        if (tcins.indexOf(p.sku) === -1) {
          tcins.push(p.sku);
          addLog("Name matched: '" + cleanName.substring(0, 40) + "' → " + p.sku + " (" + p.name + ")", "info");
        }
      }
    });
  }
  
  if (tcins.length === 0) return res.json({ ok: false, error: "No TCINs or name match" });
  
  if (!monitorRunning) {
    addLog("Alert received but monitor is STOPPED — ignoring " + tcins.join(", "), "warn");
    return res.json({ ok: false, error: "Monitor not running — click Start" });
  }
  
  addLog("═══ DISCORD WATCHER: " + tcins.length + " TCIN(s) detected ═══", "success");
  addLog("Source: " + message.substring(0, 100), "info");

  // Forward to webhook if configured
  if (CONFIG.DISCORD_FORWARD_WEBHOOK) {
    fetch(CONFIG.DISCORD_FORWARD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "StockPulse Watcher",
        content: message.substring(0, 500),
      })
    }).catch(function() {});
  }

  // Forward via Discord bot to shared channel
  if (CONFIG.DISCORD_BOT_TOKEN && CONFIG.DISCORD_BOT_CHANNEL_ID) {
    fetch("https://discord.com/api/v10/channels/" + CONFIG.DISCORD_BOT_CHANNEL_ID + "/messages", {
      method: "POST",
      headers: {
        "Authorization": "Bot " + CONFIG.DISCORD_BOT_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        embeds: [{
          title: "Stock Alert",
          description: message.substring(0, 500),
          color: 65280,
          fields: tcins.map(function(t) {
            var p = products.find(function(pr) { return pr.sku === t; });
            return { name: "TCIN " + t, value: p ? p.name + " ($" + (p.msrp || "?") + ")" : "Not in dashboard", inline: true };
          }),
          timestamp: new Date().toISOString(),
          footer: { text: "StockPulse Bot" }
        }]
      })
    }).then(function(r) {
      if (r.ok) addLog("Bot forwarded to Discord", "system");
      else addLog("Bot forward failed: " + r.status, "warn");
    }).catch(function() {});
  }

  for (var i = 0; i < tcins.length; i++) {
    var tcin = tcins[i];
    
    // Find product in dashboard
    var product = products.find(function(p) { return p.sku === tcin; });
    
    if (!product) {
      addLog("TCIN " + tcin + " not in dashboard — skipping", "warn");
      continue;
    }
    if (!product.enabled) {
      addLog("SKIP: " + product.name + " — On checkbox is OFF", "warn");
      continue;
    }
    if (!product.autoCheckout) {
      addLog("SKIP: " + product.name + " — CO checkbox is OFF", "warn");
      continue;
    }
    if (!credentials.cvv) {
      addLog("SKIP: No CVV saved — set in Config page", "error");
      continue;
    }

    // Check daily limit
    if (!canOrderToday(tcin)) {
      addLog("SKIP: " + product.name + " — daily limit reached", "warn");
      continue;
    }

    addLog("✓ Found: " + product.name + " (" + product.type + ")", "system");

    // Verify stock
    addLog("Verifying stock via Redsky API...", "system");
    var stockResult = await checkSingleSku(tcin);
    if (stockResult.seller) addLog("  Seller: " + stockResult.seller, "info");
    if (stockResult.isThirdParty) {
      addLog("SKIP: Third-party seller — " + stockResult.seller, "warn");
      continue;
    }
    if (stockResult.status === "OUT_OF_STOCK") {
      addLog("⚠ Stock check: OUT OF STOCK — skipping ATC (alert was stale)", "warn");
      continue;
    }
    if (stockResult.status === "IN_STOCK") {
      addLog("✓ Stock VERIFIED: IN_STOCK!", "success");
    }

    // Queue ATC
    if (!pendingAtcQueue) pendingAtcQueue = [];
    if (!pendingAtcQueue.find(function(q) { return q.sku === tcin; })) {
      pendingAtcQueue.push({ sku: tcin, qty: CONFIG.ATC_QTY || 2, product: product });
      addLog("═══ QUEUED ATC: " + product.name + " x" + CONFIG.ATC_QTY + " ═══", "system");
    }

    // Send Discord alert
    await sendDiscordAlert(product, {
      status: "IN_STOCK", price: product.currentPrice,
      priceFormatted: product.currentPrice ? "$" + product.currentPrice : "N/A",
      seller: product.seller || "Target", isThirdParty: false, quantity: null,
      shipAvailable: true, pickupAvailable: false,
    });
  }

  // Queue checkout if any ATCs were queued
  if (pendingAtcQueue && pendingAtcQueue.length > 0) {
    // Checkout will be triggered by the extension after ATCs complete
    addLog("Waiting for extension to process " + pendingAtcQueue.length + " ATC(s)...", "system");
  }

  res.json({ ok: true, processed: tcins.length });
});

app.get("/api/browser-atc/pending", function(req, res) {
  // Serve from queue if available
  if (pendingAtcQueue && pendingAtcQueue.length > 0) {
    var next = pendingAtcQueue.shift();
    pendingAtc = { sku: next.sku, qty: next.qty, timestamp: Date.now(), status: "picked_up" };
    addLog("Extension picked up ATC: " + next.sku + " (" + pendingAtcQueue.length + " remaining in queue)", "system");
    res.json({ sku: next.sku, qty: next.qty });
  } else if (pendingAtc && pendingAtc.status === "pending" && Date.now() - pendingAtc.timestamp < 60000) {
    var atcData = { sku: pendingAtc.sku, qty: pendingAtc.qty };
    pendingAtc.status = "picked_up";
    res.json(atcData);
  } else {
    res.json(null);
  }
});

app.post("/api/browser-atc/result", function(req, res) {
  if (pendingAtc) {
    pendingAtc.status = req.body.success ? "success" : "failed";
    pendingAtc.response = req.body;
    if (req.body.success) {
      addLog("BROWSER ATC SUCCESS: " + pendingAtc.sku + " x" + pendingAtc.qty, "success");
      // Queue checkout for the extension to handle
      if (credentials.cvv) {
        var product = products.find(function(p) { return p.sku === pendingAtc.sku; });
        if (product && product.isThirdParty) {
          addLog("BLOCKED: third-party seller — no checkout", "error");
        } else if (product && product.msrp === 0) {
          addLog("BLOCKED: price not verified for " + pendingAtc.sku + " — run Scan MSRPs first", "error");
        } else if (!canOrderToday(pendingAtc.sku)) {
          addLog("BLOCKED: Daily order limit reached for " + pendingAtc.sku, "warn");
        } else {
          pendingCheckout = {
            sku: pendingAtc.sku,
            cvv: credentials.cvv,
            timestamp: Date.now(),
            status: "pending"
          };
          addLog("Browser checkout queued", "system");
        }
      }
    } else {
      addLog("BROWSER ATC FAILED: " + (req.body.error || "unknown"), "error");
    }
  }
  res.json({ ok: true });
});

var pendingCheckout = null;

app.get("/api/target-password", function(req, res) {
  res.json({ password: credentials.targetPassword || "" });
});

app.post("/api/test-discord-token", async function(req, res) {
  var token = (req.body || {}).token;
  if (!token) return res.json({ ok: false, error: "No token" });
  try {
    var r = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { "Authorization": token }
    });
    if (r.ok) {
      var user = await r.json();
      res.json({ ok: true, username: user.username + "#" + user.discriminator });
    } else {
      res.json({ ok: false, error: r.status + " " + r.statusText });
    }
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post("/api/test-discord-bot", async function(req, res) {
  var token = (req.body || {}).token;
  var channelId = (req.body || {}).channelId;
  if (!token || !channelId) return res.json({ ok: false, error: "Need token + channel ID" });
  try {
    var r = await fetch("https://discord.com/api/v10/channels/" + channelId + "/messages", {
      method: "POST",
      headers: { "Authorization": "Bot " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [{ title: "StockPulse Bot Test", description: "Bot is connected and can post to this channel!", color: 65280, timestamp: new Date().toISOString() }] })
    });
    if (r.ok) {
      res.json({ ok: true });
    } else {
      var body = await r.text();
      res.json({ ok: false, error: r.status + " " + body.substring(0, 200) });
    }
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post("/api/browser-log", function(req, res) {
  var msg = req.body.msg || "";
  var type = req.body.type || "system";
  if (msg) addLog("[BROWSER] " + msg, type);
  res.json({ ok: true });
});

app.get("/api/browser-checkout/pending", function(req, res) {
  if (pendingCheckout && pendingCheckout.status === "pending" && Date.now() - pendingCheckout.timestamp < 60000) {
    var coData = { sku: pendingCheckout.sku, cvv: pendingCheckout.cvv };
    pendingCheckout.status = "picked_up";
    res.json(coData);
  } else {
    res.json(null);
  }
});

app.post("/api/browser-checkout/result", function(req, res) {
  if (pendingCheckout) {
    pendingCheckout.status = req.body.success ? "success" : "failed";
    if (req.body.success) {
      addLog("ORDER PLACED via browser checkout!", "success");
      var product = products.find(function(p) { return p.sku === pendingCheckout.sku; });
      if (product) {
        recordOrder(product.sku);
        sendCheckoutSuccess(product, req.body.orderId || "Success");
      }
    } else {
      addLog("Browser checkout failed: " + (req.body.error || "unknown"), "error");
      // Notify if item was in cart but checkout failed
      if (CONFIG.DISCORD_CHECKOUT_FAILED_WEBHOOK && req.body.error && req.body.error.indexOf("Cart empty") === -1) {
        var failProduct = pendingCheckout ? products.find(function(p) { return p.sku === pendingCheckout.sku; }) : null;
        fetch(CONFIG.DISCORD_CHECKOUT_FAILED_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "StockPulse",
            content: "@everyone CHECKOUT FAILED — item may still be in cart!",
            embeds: [{
              title: "CHECKOUT FAILED: " + (failProduct ? failProduct.name : "Unknown"),
              url: "https://www.target.com/checkout",
              color: 16711680,
              fields: [
                { name: "SKU", value: pendingCheckout ? pendingCheckout.sku : "?", inline: true },
                { name: "Error", value: (req.body.error || "unknown").substring(0, 200), inline: false },
              ],
              timestamp: new Date().toISOString(),
              footer: { text: "StockPulse — check target.com/checkout" },
            }],
          }),
        }).catch(function() {});
      }
    }
  }
  res.json({ ok: true });
});

// ── DISCORD STOCK ALERT LISTENER ───────────────────────────────
// Polls Discord channels for stock alerts using user token (no bot needed)
var lastMessageIds = {}; // { channelId: lastMessageId }
var discordPollInterval = null;

function getActiveChannelIds() {
  if (!CONFIG.DISCORD_LISTEN_CHANNELS || !CONFIG.DISCORD_ACTIVE_CHANNELS) return [];
  var ids = CONFIG.DISCORD_ACTIVE_CHANNELS.map(function(key) {
    var ch = CONFIG.DISCORD_LISTEN_CHANNELS[key];
    return ch ? ch.id : null;
  }).filter(function(id) { return !!id; });
  // Also add command channel if configured
  if (CONFIG.DISCORD_COMMAND_CHANNEL_ID && ids.indexOf(CONFIG.DISCORD_COMMAND_CHANNEL_ID) === -1) {
    ids.push(CONFIG.DISCORD_COMMAND_CHANNEL_ID);
  }
  return ids;
}

// ── DISCORD ROLE VERIFICATION ───────────────────────────────────
async function verifyDiscordRole() {
  if (!CONFIG.DISCORD_USER_TOKEN || !CONFIG.DISCORD_VERIFY_SERVER_ID || !CONFIG.DISCORD_VERIFY_ROLE_NAME) {
    return { ok: false, error: "Missing token or server/role config" };
  }
  try {
    // Get current user
    var meRes = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { "Authorization": CONFIG.DISCORD_USER_TOKEN }
    });
    if (!meRes.ok) return { ok: false, error: "Invalid Discord token (" + meRes.status + ")" };
    var me = await meRes.json();

    // Get user's member info in the server
    var memberRes = await fetch("https://discord.com/api/v10/users/@me/guilds/" + CONFIG.DISCORD_VERIFY_SERVER_ID + "/member", {
      headers: { "Authorization": CONFIG.DISCORD_USER_TOKEN }
    });
    if (!memberRes.ok) return { ok: false, error: "Not a member of the required Discord server" };
    var member = await memberRes.json();

    // Get server roles to find role ID by name
    var rolesRes = await fetch("https://discord.com/api/v10/guilds/" + CONFIG.DISCORD_VERIFY_SERVER_ID + "/roles", {
      headers: { "Authorization": CONFIG.DISCORD_USER_TOKEN }
    });
    if (!rolesRes.ok) return { ok: false, error: "Cannot read server roles" };
    var roles = await rolesRes.json();

    var targetRole = roles.find(function(r) { return r.name === CONFIG.DISCORD_VERIFY_ROLE_NAME; });
    if (!targetRole) return { ok: false, error: "Role '" + CONFIG.DISCORD_VERIFY_ROLE_NAME + "' not found in server" };

    // Check if user has the role
    if (member.roles && member.roles.indexOf(targetRole.id) !== -1) {
      return { ok: true, username: me.username, role: targetRole.name };
    } else {
      return { ok: false, error: "User " + me.username + " does not have role '" + CONFIG.DISCORD_VERIFY_ROLE_NAME + "'" };
    }
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

function startDiscordListener() {
  if (!CONFIG.DISCORD_USER_TOKEN) {
    console.log("  Discord listener: disabled (no user token)");
    return;
  }

  var channelIds = getActiveChannelIds();
  if (channelIds.length === 0) {
    console.log("  Discord listener: disabled (no active channels)");
    return;
  }

  var channelNames = CONFIG.DISCORD_ACTIVE_CHANNELS.map(function(key) {
    var ch = CONFIG.DISCORD_LISTEN_CHANNELS[key];
    return ch ? ch.name : key;
  }).join(", ");

  addLog("Discord listener starting — watching: " + channelNames, "system");
  console.log("  Discord listener: polling " + channelIds.length + " channel(s)");

  // Poll for new messages across all active channels
  discordPollInterval = setInterval(async function() {
    if (!CONFIG.DISCORD_LISTEN_ENABLED) return;
    var activeIds = getActiveChannelIds();

    for (var ci = 0; ci < activeIds.length; ci++) {
      var channelId = activeIds[ci];
    try {
      var url = "https://discord.com/api/v10/channels/" + channelId + "/messages?limit=5";
      if (lastMessageIds[channelId]) url += "&after=" + lastMessageIds[channelId];

      var res = await fetch(url, {
        headers: {
          "Authorization": CONFIG.DISCORD_USER_TOKEN,
          "Content-Type": "application/json",
        }
      });

      if (!res.ok) {
        if (res.status === 401) {
          addLog("Discord token expired or invalid", "error");
          clearInterval(discordPollInterval);
        }
        continue;
      }

      var messages = await res.json();
      if (!messages || messages.length === 0) return;

      // Update last message ID to newest
      // Messages come newest first, so sort by ID ascending
      messages.sort(function(a, b) {
        return BigInt(a.id) > BigInt(b.id) ? 1 : -1;
      });

      // On first poll, just set the marker — don't process old messages
      if (!lastMessageIds[channelId]) {
        lastMessageIds[channelId] = messages[messages.length - 1].id;
        addLog("Discord listener ready for channel " + channelId, "system");
        return;
      }

      // Process each new message
      for (var mi = 0; mi < messages.length; mi++) {
        var msg = messages[mi];
        lastMessageIds[channelId] = msg.id;

        // Build full text from content + embeds
        var fullText = msg.content || "";

        // Remote commands from command channel
        if (msg.content && msg.content.startsWith("!")) {
          var cmdText = msg.content.trim().toLowerCase();
          if (cmdText === "!stop") {
            monitorRunning = false;
            CONFIG.DISCORD_LISTEN_ENABLED = false;
            addLog("REMOTE STOP received via Discord", "warn");
            continue;
          }
          if (cmdText === "!start") {
            CONFIG.DISCORD_LISTEN_ENABLED = true;
            addLog("REMOTE START received via Discord", "success");
            continue;
          }
          if (cmdText === "!status") {
            var statusMsg = "**StockPulse Status**\n"
              + "Monitor: " + (monitorRunning ? "running" : "stopped") + "\n"
              + "Discord listener: " + (CONFIG.DISCORD_LISTEN_ENABLED ? "active" : "disabled") + "\n"
              + "Session: " + harvesterStatus + "\n"
              + "Products: " + products.filter(function(p){return p.enabled;}).length + " enabled, "
              + products.filter(function(p){return p.autoCheckout;}).length + " CO\n"
              + "Total checks: " + totalChecks + " | Alerts: " + totalAlerts;
            if (CONFIG.DISCORD_LOG_WEBHOOK) {
              fetch(CONFIG.DISCORD_LOG_WEBHOOK, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: "StockPulse", content: statusMsg })
              }).catch(function() {});
            }
            continue;
          }
          if (cmdText === "!ping") {
            if (CONFIG.DISCORD_LOG_WEBHOOK) {
              fetch(CONFIG.DISCORD_LOG_WEBHOOK, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: "StockPulse", content: "🏓 Pong! StockPulse is running." })
              }).catch(function() {});
            }
            continue;
          }
        }
        if (msg.embeds && msg.embeds.length > 0) {
          msg.embeds.forEach(function(embed) {
            if (embed.description) fullText += " " + embed.description;
            if (embed.title) fullText += " " + embed.title;
            if (embed.fields) {
              embed.fields.forEach(function(f) {
                fullText += " " + f.name + " " + f.value;
              });
            }
          });
        }

        // Extract TCIN
        var tcin = null;

        // Pattern 1: "Tcin\n91619959" or "Tcin 91619959"
        var tcinMatch = fullText.match(/[Tt]cin[:\s\n]*(\d{7,12})/);
        if (tcinMatch) tcin = tcinMatch[1];

        // Pattern 2: Target URL /A-XXXXXXXX
        if (!tcin) {
          var urlMatch = fullText.match(/A-(\d{7,12})/);
          if (urlMatch) tcin = urlMatch[1];
        }

        // Pattern 3: Bare 8-digit number
        if (!tcin) {
          var bareMatch = fullText.match(/\b(\d{8})\b/);
          if (bareMatch) tcin = bareMatch[1];
        }

        if (!tcin) continue;

        // Check it's a stock alert not OOS
        var textLower = fullText.toLowerCase();
        var isOos = textLower.indexOf("out of stock") !== -1 ||
                    textLower.indexOf("sold out") !== -1 ||
                    textLower.indexOf("oos") !== -1;
        if (isOos) {
          addLog("Discord msg skipped — OOS alert for TCIN " + tcin, "info");
          continue;
        }

        addLog("═══ DISCORD ALERT: TCIN " + tcin + " ═══", "success");
        addLog("Source message: " + fullText.substring(0, 100).replace(/\n/g, " "), "info");

        // Forward the alert to your own Discord channel
        if (CONFIG.DISCORD_FORWARD_WEBHOOK) {
          try {
            var fwdContent = fullText.substring(0, 1500);
            // Rebuild embeds if present
            var fwdEmbeds = [];
            if (msg.embeds && msg.embeds.length > 0) {
              msg.embeds.forEach(function(embed) {
                var fwdEmbed = {};
                if (embed.title) fwdEmbed.title = embed.title;
                if (embed.description) fwdEmbed.description = embed.description;
                if (embed.color) fwdEmbed.color = embed.color;
                if (embed.url) fwdEmbed.url = embed.url;
                if (embed.thumbnail) fwdEmbed.thumbnail = embed.thumbnail;
                if (embed.image) fwdEmbed.image = embed.image;
                if (embed.fields) fwdEmbed.fields = embed.fields;
                if (embed.footer) fwdEmbed.footer = embed.footer;
                if (embed.timestamp) fwdEmbed.timestamp = embed.timestamp;
                fwdEmbeds.push(fwdEmbed);
              });
            }
            var fwdBody = {
              username: (msg.author ? msg.author.username : "StockAlert") + " (forwarded)",
              content: msg.content || "",
            };
            if (fwdEmbeds.length > 0) fwdBody.embeds = fwdEmbeds;

            await fetch(CONFIG.DISCORD_FORWARD_WEBHOOK, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(fwdBody),
            });
            addLog("Forwarded alert to your Discord", "system");
          } catch(fwdErr) {
            addLog("Forward failed: " + fwdErr.message, "warn");
          }
        }

        // Extension handles session — no server-side cookie check needed

        // Check daily limit
        if (!canOrderToday(tcin)) {
          addLog("SKIP: Daily order limit reached for " + tcin + " (max " + CONFIG.MAX_ORDERS_PER_SKU_PER_DAY + "/day)", "warn");
          continue;
        }
        addLog("✓ Daily limit: OK", "system");

        // Find product in database — MUST exist and have CO checked
        var product = products.find(function(p) { return p.sku === tcin; });
        if (!product) {
          addLog("SKIP: TCIN " + tcin + " not in dashboard — add it and enable CO first", "warn");
          continue;
        }
        addLog("✓ Found in dashboard: " + product.name + " (" + product.type + ")", "system");

        if (!product.enabled) {
          addLog("SKIP: " + product.name + " — On checkbox is OFF", "warn");
          continue;
        }
        addLog("✓ Monitoring: enabled", "system");

        if (!product.autoCheckout) {
          addLog("SKIP: " + product.name + " — CO checkbox is OFF", "warn");
          continue;
        }
        addLog("✓ Auto-checkout: enabled", "system");

        if (!credentials.cvv) {
          addLog("SKIP: No CVV saved — save it in Settings first", "error");
          continue;
        }
        addLog("✓ CVV: saved", "system");

        // VERIFY STOCK before firing ATC
        addLog("Verifying stock via Redsky API...", "system");
        var stockCheck = await checkSingleSku(tcin);

        // Update product info from stock check
        if (stockCheck.price) {
          product.currentPrice = stockCheck.price;
          addLog("  Price: $" + stockCheck.price, "info");
        }
        if (stockCheck.title && product.name.indexOf("Discord Alert") === 0) {
          product.name = stockCheck.title;
          addLog("  Title: " + stockCheck.title, "info");
        }
        if (stockCheck.seller) {
          product.seller = stockCheck.seller;
          addLog("  Seller: " + stockCheck.seller, "info");
        }
        product.isThirdParty = !!stockCheck.isThirdParty;

        // Block if third-party seller
        if (stockCheck.isThirdParty) {
          addLog("BLOCKED: Third-party seller — " + stockCheck.seller + " (not Target)", "error");
          continue;
        }
        addLog("✓ Seller: Target (not third-party)", "system");

        // Check if actually in stock
        if (stockCheck.status === "OUT_OF_STOCK") {
          addLog("⚠ Stock check: OUT OF STOCK — skipping ATC (alert was stale)", "warn");
          addLog("═══ END DISCORD ALERT FLOW ═══", "system");
          // Still send Discord alert so you know it was detected
          await sendDiscordAlert(product, {
            status: "OUT_OF_STOCK", price: product.currentPrice,
            priceFormatted: product.currentPrice ? "$" + product.currentPrice : "N/A",
            seller: "Target", isThirdParty: false, quantity: null,
            shipAvailable: false, pickupAvailable: false,
          });
          continue;
        } else if (stockCheck.status === "IN_STOCK") {
          addLog("✓ Stock VERIFIED: IN_STOCK!", "success");
        } else if (stockCheck.status === "ERROR") {
          addLog("⚠ Stock check error — attempting ATC anyway", "warn");
        } else {
          addLog("⚠ Stock check inconclusive — attempting ATC", "system");
        }

        // Queue this SKU for browser ATC — multiple SKUs can queue up
        if (!pendingAtcQueue) pendingAtcQueue = [];
        // Don't add duplicates
        if (!pendingAtcQueue.find(function(q) { return q.sku === tcin; }) && !(pendingAtc && pendingAtc.sku === tcin && pendingAtc.status === "pending")) {
          pendingAtcQueue.push({ sku: tcin, qty: CONFIG.ATC_QTY || 2, product: product });
          addLog("═══ QUEUED ATC #" + pendingAtcQueue.length + ": " + product.name + " x" + CONFIG.ATC_QTY + " ═══", "system");
        } else {
          addLog("ATC already queued for " + tcin + " — skipping duplicate", "warn");
        }
        
        // Send Discord alert immediately — don't wait for ATC/checkout
        await sendDiscordAlert(product, {
          status: "IN_STOCK", price: product.currentPrice,
          priceFormatted: product.currentPrice ? "$" + product.currentPrice : "N/A",
          seller: product.seller || "Target", isThirdParty: false, quantity: null,
          shipAvailable: true, pickupAvailable: false,
        });
        addLog("═══ END DISCORD ALERT FLOW ═══", "system");
      }
    } catch(err) {
      // Silently ignore poll errors for this channel
    }
    } // end channel loop

    // Forward-only channels — just copy messages, no ATC processing
    if (CONFIG.DISCORD_FORWARD_CHANNELS) {
      for (var fi = 0; fi < CONFIG.DISCORD_FORWARD_CHANNELS.length; fi++) {
        var fwd = CONFIG.DISCORD_FORWARD_CHANNELS[fi];
        try {
          var fUrl = "https://discord.com/api/v10/channels/" + fwd.sourceId + "/messages?limit=5";
          if (lastMessageIds[fwd.sourceId]) fUrl += "&after=" + lastMessageIds[fwd.sourceId];

          var fRes = await fetch(fUrl, {
            headers: { "Authorization": CONFIG.DISCORD_USER_TOKEN, "Content-Type": "application/json" }
          });
          if (!fRes.ok) continue;

          var fMsgs = await fRes.json();
          if (!fMsgs || fMsgs.length === 0) continue;

          fMsgs.sort(function(a, b) { return BigInt(a.id) > BigInt(b.id) ? 1 : -1; });

          if (!lastMessageIds[fwd.sourceId]) {
            lastMessageIds[fwd.sourceId] = fMsgs[fMsgs.length - 1].id;
            addLog("Forward channel ready: " + fwd.name, "system");
            continue;
          }

          for (var fmi = 0; fmi < fMsgs.length; fmi++) {
            var fMsg = fMsgs[fmi];
            lastMessageIds[fwd.sourceId] = fMsg.id;

            // Forward the message
            var fwdBody = {
              username: (fMsg.author ? fMsg.author.username : "Announcement") + " (fwd)",
              content: fMsg.content || "",
            };
            if (fMsg.embeds && fMsg.embeds.length > 0) {
              fwdBody.embeds = fMsg.embeds.map(function(e) {
                var fe = {};
                if (e.title) fe.title = e.title;
                if (e.description) fe.description = e.description;
                if (e.color) fe.color = e.color;
                if (e.url) fe.url = e.url;
                if (e.thumbnail) fe.thumbnail = e.thumbnail;
                if (e.image) fe.image = e.image;
                if (e.fields) fe.fields = e.fields;
                if (e.footer) fe.footer = e.footer;
                return fe;
              });
            }

            await fetch(fwd.webhook, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(fwdBody),
            }).catch(function() {});
          }
        } catch(e) {}
      }
    }

  }, CONFIG.DISCORD_POLL_INTERVAL_MS || 2000);
}

app.listen(PORT, function() {
  console.log("");
  console.log("  ◎ StockPulse — Target Stock Monitor");
  console.log("  ─────────────────────────────────────");
  console.log("  Dashboard:  http://localhost:" + PORT);
  console.log("  SKUs:       " + products.length + " loaded");
  console.log("  Zip:        " + CONFIG.ZIP_CODE);
  console.log("  Store:      " + CONFIG.STORE_ID);
  console.log("  Webhook:    " + (CONFIG.DISCORD_WEBHOOK ? "configured" : "not set"));
  console.log("  Proxies:    " + (CONFIG.USE_PROXIES ? CONFIG.PROXIES.length + " loaded" : "off (using your IP)"));
  console.log("  Delay:      " + CONFIG.REQUEST_DELAY_MS + "ms between SKUs");
  console.log("  ─────────────────────────────────────");
  console.log("  Open the dashboard and hit Start!");
  console.log("");
  
  // Auto-detect MSRPs and product titles on startup
  setTimeout(function() {
    autoDetectAllMsrps();
  }, 2000);

  // Start Discord stock alert listener
  if (CONFIG.DISCORD_LISTEN_ENABLED) {
    startDiscordListener();
  }
});

// Cleanup on shutdown
process.on("SIGINT", function() {
  console.log("\nShutting down...");
  process.exit();
});
process.on("SIGTERM", function() {
  process.exit();
});
