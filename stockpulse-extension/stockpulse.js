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
var puppeteer = null;
try { puppeteer = require("puppeteer"); } catch(e) {}
var imaps = null;
try { imaps = require("imap-simple"); } catch(e) {}
var HttpsProxyAgent = null;
try { HttpsProxyAgent = require("https-proxy-agent"); } catch(e) {}
var app = express();
var PORT = 3069;

// Browser instance (reused across checks)
var browser = null;

async function getBrowser() {
  if (!puppeteer) {
    console.log("  ERROR: puppeteer not installed. Run: npm install puppeteer");
    return null;
  }
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--window-size=1920,1080",
      ],
    });
    addLog("Browser launched", "system");
  }
  return browser;
}

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
var CONFIG = {
  DISCORD_WEBHOOK: "https://discord.com/api/webhooks/1478663854291423412/qdFm17_-Q12vuafFgrOMXUBahPVYhzNWJyxFY9kprkMLcj_SpjemYmcF6Xvr4nXy7HXk",
  DISCORD_CHECKOUT_WEBHOOK: "https://discord.com/api/webhooks/1478976770702053407/SU_ha-oA0F4JIOIQcFkqsCnn27Rsvzlw3vIWRZmDIuBcrAu8NXI4RNB0rhSsIfnZI3wG",
  ZIP_CODE: "55372",
  STORE_ID: "1368",
  POLL_INTERVAL_MS: 5000,    // 5s between cycles (aggressive but proxy-safe)
  MAX_PERCENT_ABOVE_MSRP: 20,
  ALERT_COOLDOWN_MS: 120000,
  REQUEST_DELAY_MS: 500,     // 0.5s between SKUs (fast with proxy)
  API_KEY: "9f36aeafbe60771e321a7cc95a78140772ab3e96",
  CHECKOUT_API_KEY: "e59ce3b531b2c39afb2e2b8a71ff10113aac2a14",

  // ── PROXY CONFIG ─────────────────────────────────────────
  // Set USE_PROXIES to true and add your proxy list below.
  // Supports rotating gateway (single URL) or a list of proxies.
  //
  // Format: "http://username:password@host:port"
  //
  // Examples:
  //   DataImpulse:  "http://YOUR_USER:YOUR_PASS@gw.dataimpulse.com:823"
  //   Smartproxy:   "http://USER:PASS@gate.smartproxy.com:7777"
  //   IPRoyal:      "http://USER:PASS@geo.iproyal.com:12321"
  //   Oxylabs:      "http://USER:PASS@pr.oxylabs.io:7777"
  //   Geonode:      "http://USER:PASS@proxy.geonode.io:9000"
  //
  // If your provider gives a rotating gateway, just put one URL.
  // If you have a list of IPs, put them all and they'll rotate.
  USE_PROXIES: true,  // Proxies for self-monitoring, Discord listener runs in parallel
  PROXIES: [
    "http://sphmf8d2b1:y1Ks%7EgiOcgC53U1frv@us.decodo.com:10000",
  ],
  // ── AUTO ADD-TO-CART ──────────────────────────────────────────
  // When stock is detected, instantly add to cart via API using
  // your harvested Target session cookies. Then sends Discord
  // alert with direct checkout link.
  AUTO_ATC: true,
  ATC_QTY: 2,                // Default quantity per ATC
  ATC_MAX_RETRIES: 15,       // Retry ATC aggressively
  ATC_RETRY_DELAY_MS: 150,   // 150ms — faster than human clicking
  CHECKOUT_MAX_RETRIES: 30,  // Keep hammering checkout for 30 attempts
  CHECKOUT_RETRY_DELAY_MS: 200, // 200ms — matches Enter-spam speed
  AUTO_OPEN_CHECKOUT: false,  // No manual browser — fully automated
  MAX_ORDERS_PER_SKU_PER_DAY: 1,  // Safeguard: max 1 auto-checkout per item per day  // Open checkout in your browser after ATC
  MAX_CHECKS_PER_CYCLE: 20,  // Check more SKUs per cycle for faster detection
  // ── DISCORD LISTENER ─────────────────────────────────────────
  DISCORD_BOT_TOKEN: "",  // Not used — using user token instead
  DISCORD_USER_TOKEN: "Mjc3MzAwOTg2MTAyNTQ2NDM0.GsIzxt.NQa2WucKQK8w6CsinsEMeQqKIDHSEFCbgT9lBc",
  DISCORD_LISTEN_CHANNELS: {
    "target_all": { id: "1296440024086220853", name: "Target (All)" },
    "target_10plus": { id: "1387155900535541770", name: "Target (10+ Stock)" },
  },
  DISCORD_ACTIVE_CHANNELS: ["target_all", "target_10plus"],  // Which channels to listen to
  DISCORD_LISTEN_ENABLED: true,
  DISCORD_POLL_INTERVAL_MS: 2000,
  DISCORD_FORWARD_WEBHOOK: "https://discord.com/api/webhooks/1478997002543960174/6EDOB3Vk4pohHhsm3pGpa0AaaE3MfHu_Rviz82iHI1lgdbQ2DKhtWkd6CNKHJB_BNa63",
};

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

var products = SKU_LIST.map(function(p) {
  return {
    name: p.name, type: p.type, sku: p.sku, msrp: p.msrp,
    status: "IDLE", lastChecked: null, currentPrice: null,
    seller: null, isThirdParty: false, quantity: null,
    checks: 0, alerts: 0, shipAvailable: false,
    pickupAvailable: false, enabled: true, autoCheckout: false, lastAlerted: null,
  };
});

function addLog(msg, type) {
  type = type || "info";
  logs.push({ msg: msg, type: type, time: new Date().toISOString() });
  if (logs.length > 500) logs.splice(0, logs.length - 500);
  var t = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  console.log("  " + t + "  [" + type + "] " + msg);
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

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

function openInBrowser(url) {
  // Opens URL in the user's default browser (Windows/Mac/Linux)
  var cmd;
  switch (process.platform) {
    case "win32": cmd = 'start "" "' + url + '"'; break;
    case "darwin": cmd = 'open "' + url + '"'; break;
    default: cmd = 'xdg-open "' + url + '"'; break;
  }
  exec(cmd, function(err) {
    if (err) addLog("Could not open browser: " + err.message, "error");
    else addLog("Opened checkout in browser", "system");
  });
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
              .replace(/^Pok[eé]mon Trading Card Game:\s*/i, "")
              .replace(/^Pok[eé]mon TCG:\s*/i, "")
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

  // Step 3: ATC check as last resort (if cookies available)
  if (targetCookies && harvesterStatus === "ready") {
    try {
      var stockResult = await atcStockCheck(sku);
      if (stockResult === "IN_STOCK") {
        result.status = "IN_STOCK";
        result.shipAvailable = true;
      } else if (stockResult === "OUT_OF_STOCK") {
        result.status = "OUT_OF_STOCK";
      }
    } catch(err) {}
  }

  return result;
}

// Lightweight ATC stock check — tries to add to cart, then removes it
// Returns "IN_STOCK", "OUT_OF_STOCK", or "ERROR"
async function atcStockCheck(sku) {
  try {
    var accessToken = "";
    if (targetCookieArr) {
      targetCookieArr.forEach(function(c) {
        if (c.name === "accessToken") accessToken = c.value;
      });
    }

    var K = CONFIG.API_KEY;
    var atcUrl = "https://carts.target.com/web_checkouts/v1/cart_items?field_groups=CART%2CCART_ITEMS%2CSUMMARY&key=" + K;

    var body = {
      cart_type: "REGULAR",
      channel_id: "10",
      shopping_context: "DIGITAL",
      cart_item: {
        tcin: String(sku),
        quantity: 1,
        item_channel_id: "10",
      }
    };

    var headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Referer": "https://www.target.com/p/-/A-" + sku,
      "Origin": "https://www.target.com",
      "Cookie": targetCookies,
    };
    if (accessToken) headers["Authorization"] = "Bearer " + accessToken;

    var agent = getProxyAgent();
    var fetchOpts = { method: "POST", headers: headers, body: JSON.stringify(body) };
    if (agent) fetchOpts.agent = agent;

    var res = await fetch(atcUrl, fetchOpts);
    var resText = await res.text();

    if (res.ok || res.status === 201) {
      // Successfully added — item is IN STOCK
      // Now remove it from cart so we don't clutter the cart
      try {
        var cartData = JSON.parse(resText);
        var cartItemId = cartData && cartData.cart_items && cartData.cart_items[0] && cartData.cart_items[0].cart_item_id;
        if (cartItemId) {
          var removeUrl = "https://carts.target.com/web_checkouts/v1/cart_items/" + cartItemId + "?field_groups=CART%2CCART_ITEMS%2CSUMMARY&key=" + K;
          await fetch(removeUrl, {
            method: "DELETE",
            headers: headers,
            agent: agent || undefined,
          }).catch(function() {});
        }
      } catch(e) {}
      return "IN_STOCK";
    } else if (res.status === 403 || res.status === 401) {
      // Cookies expired
      if (harvesterStatus === "ready") {
        harvesterStatus = "harvesting";
        addLog("ATC cookies expired — refresh needed", "warn");
      }
      return "ERROR";
    } else {
      // Parse error — check if it's an OOS error
      try {
        var errData = JSON.parse(resText);
        var errMsg = "";
        if (errData.errors) errMsg = JSON.stringify(errData.errors).toLowerCase();
        else if (errData.message) errMsg = errData.message.toLowerCase();
        else errMsg = resText.toLowerCase();

        if (errMsg.indexOf("out of stock") !== -1 || 
            errMsg.indexOf("not available") !== -1 ||
            errMsg.indexOf("insufficient") !== -1 ||
            errMsg.indexOf("no longer") !== -1) {
          return "OUT_OF_STOCK";
        }
      } catch(e) {}
      return "OUT_OF_STOCK"; // Assume OOS for other errors
    }
  } catch(err) {
    return "ERROR";
  }
}

async function checkWithBrowser(sku) {
  var b = await getBrowser();
  if (!b) return { status: "ERROR", error: "No browser" };

  var page = await b.newPage();
  try {
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Block images/fonts/css to speed up loading
    await page.setRequestInterception(true);
    page.on("request", function(req) {
      var rt = req.resourceType();
      if (rt === "image" || rt === "font" || rt === "stylesheet" || rt === "media") {
        req.abort();
      } else {
        req.continue();
      }
    });

    var url = "https://www.target.com/p/-/A-" + sku;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    
    // Wait for fulfillment data to load (the delivery/pickup section)
    await page.waitForSelector('[data-test="fulfillment-cell"], [data-test="shippingBlock"], [data-test="storeBlock"], h1', { timeout: 10000 }).catch(function() {});

    // Give a moment for dynamic content
    await sleep(2000);

    // Extract data from the rendered page
    var result = await page.evaluate(function() {
      var out = {
        status: "OUT_OF_STOCK", price: null, priceFormatted: null,
        seller: "Target", isThirdParty: false, quantity: null,
        shipAvailable: false, pickupAvailable: false, title: null
      };

      // Title
      var h1 = document.querySelector('h1[data-test="product-title"], h1');
      if (h1) out.title = h1.textContent.trim();

      // Price - look for the price display
      var priceEl = document.querySelector('[data-test="product-price"], [data-test="product-price-sale"], span[class*="CurrentPrice"]');
      if (priceEl) {
        var priceText = priceEl.textContent.trim();
        out.priceFormatted = priceText;
        var match = priceText.match(/\$([0-9]+\.?[0-9]*)/);
        if (match) out.price = parseFloat(match[1]);
      }

      // Shipping availability
      var shipEl = document.querySelector('[data-test="shippingBlock"], [data-test="fulfillment-cell-shipping"]');
      if (shipEl) {
        var shipText = shipEl.textContent.toLowerCase();
        if (shipText.indexOf("get it") !== -1 || shipText.indexOf("arrives") !== -1 || shipText.indexOf("ships") !== -1 || shipText.indexOf("delivered") !== -1 || shipText.indexOf("free shipping") !== -1) {
          out.shipAvailable = true;
        }
      }

      // Pickup availability
      var pickupEl = document.querySelector('[data-test="storeBlock"], [data-test="fulfillment-cell-pickup"]');
      if (pickupEl) {
        var pickupText = pickupEl.textContent.toLowerCase();
        if (pickupText.indexOf("ready") !== -1 || pickupText.indexOf("pick up") !== -1 || pickupText.indexOf("in stock") !== -1 || pickupText.indexOf("available") !== -1) {
          out.pickupAvailable = true;
        }
        if (pickupText.indexOf("unavailable") !== -1 || pickupText.indexOf("not available") !== -1 || pickupText.indexOf("out of stock") !== -1) {
          out.pickupAvailable = false;
        }
      }

      // Delivery availability
      var deliveryEl = document.querySelector('[data-test="fulfillment-cell-delivery"]');
      if (deliveryEl) {
        var delText = deliveryEl.textContent.toLowerCase();
        if (delText.indexOf("delivered") !== -1 || delText.indexOf("same day") !== -1 || delText.indexOf("available") !== -1) {
          out.shipAvailable = true;
        }
      }

      // Check add to cart button exists and is enabled
      var addToCart = document.querySelector('[data-test="addToCartButton"], [data-test="shipItButton"], button[aria-label*="Add to cart"]');
      if (addToCart && !addToCart.disabled) {
        // If there's an active add-to-cart button, product is in stock
        if (!out.shipAvailable && !out.pickupAvailable) {
          out.shipAvailable = true; // at least something is available
        }
      }

      // Check for out-of-stock messaging
      var oosEl = document.querySelector('[data-test="oosMessage"], [data-test="soldOutBlock"]');
      if (oosEl) {
        out.shipAvailable = false;
        out.pickupAvailable = false;
      }

      // Sold by
      var sellerEl = document.querySelector('[data-test="soldBy"] a, [data-test="soldAndShippedBy"]');
      if (sellerEl) {
        out.seller = sellerEl.textContent.trim();
      }

      // Purchase limit — Target shows "limit X per guest" or similar
      var limitEl = document.querySelector('[data-test="quantityLimit"]');
      if (limitEl) {
        var limitMatch = limitEl.textContent.match(/(\d+)/);
        if (limitMatch) out.quantity = parseInt(limitMatch[1]);
      }
      // Also check all fulfillment text for limit mentions
      if (!out.quantity) {
        var allFul = document.querySelectorAll('[data-test*="fulfillment"], [data-test*="shipping"], [data-test*="store"], [data-test*="delivery"]');
        allFul.forEach(function(el) {
          var txt = el.textContent.toLowerCase();
          var lm = txt.match(/limit\s+(\d+)\s+per/i);
          if (lm) out.quantity = parseInt(lm[1]);
        });
      }
      // Check the whole page body as last resort
      if (!out.quantity) {
        var bodyText = document.body ? document.body.textContent : "";
        var lm2 = bodyText.match(/limit\s+(\d+)\s+per/i);
        if (lm2) out.quantity = parseInt(lm2[1]);
        // Also check for "purchase_limit" in any inline JSON
        var scripts = document.querySelectorAll("script");
        scripts.forEach(function(s) {
          var t = s.textContent;
          var pm = t.match(/"purchase_limit":(\d+)/);
          if (pm && parseInt(pm[1]) > 0) out.quantity = parseInt(pm[1]);
        });
      }

      out.isThirdParty = out.seller.toLowerCase() !== "target" && out.seller.toLowerCase() !== "target corporation";
      out.status = (out.shipAvailable || out.pickupAvailable) ? "IN_STOCK" : "OUT_OF_STOCK";
      return out;
    });

    return result;
  } catch (err) {
    return { status: "ERROR", error: err.message };
  } finally {
    await page.close().catch(function() {});
  }
}

// ── DISCORD ────────────────────────────────────────────────────
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
var harvesterBrowser = null;
var harvesterPage = null;
var targetCookies = null;
var targetCookieArr = null;
var cookieRefreshInterval = null;
var harvesterStatus = "disconnected";

// Credentials (saved to local file, loaded on startup)
var CREDS_FILE = path.join(__dirname, ".stockpulse-creds.json");
var credentials = {
  targetEmail: "",
  targetPassword: "",
  imapHost: "imap.gmail.com",
  imapPort: 993,
  imapEmail: "",
  imapPassword: "",
  cvv: "",
  savedCookies: "",
};

function loadCredentials() {
  try {
    if (fs.existsSync(CREDS_FILE)) {
      var data = JSON.parse(fs.readFileSync(CREDS_FILE, "utf8"));
      if (data.targetEmail) credentials.targetEmail = data.targetEmail;
      if (data.targetPassword) credentials.targetPassword = data.targetPassword;
      if (data.imapHost) credentials.imapHost = data.imapHost;
      if (data.imapPort) credentials.imapPort = data.imapPort;
      if (data.imapEmail) credentials.imapEmail = data.imapEmail;
      if (data.imapPassword) credentials.imapPassword = data.imapPassword;
      console.log("  Credentials loaded from " + CREDS_FILE);
    }
  } catch(e) { console.log("  No saved credentials found"); }
}

function saveCredentials() {
  try {
    fs.writeFileSync(CREDS_FILE, JSON.stringify(credentials, null, 2), "utf8");
  } catch(e) { console.log("  Error saving credentials:", e.message); }
}

loadCredentials();

// Restore saved cookies if available
if (credentials.savedCookies) {
  targetCookies = credentials.savedCookies;
  targetCookieArr = targetCookies.split("; ").map(function(c) {
    var eq = c.indexOf("=");
    return { name: c.substring(0, eq), value: c.substring(eq + 1) };
  });
  var hasLogin = targetCookieArr.some(function(c) { return (c.name === "accessToken" || c.name === "idToken") && c.value.length > 50; });
  if (hasLogin) {
    harvesterStatus = "ready";
    console.log("  Saved cookies loaded — session ready");
    startTokenRefreshTimer();
  }
}

// ── IMAP 2FA CODE READER ───────────────────────────────────────
async function fetchVerificationCode() {
  if (!imaps || !credentials.imapEmail || !credentials.imapPassword) {
    addLog("IMAP not configured — enter 2FA code manually", "warn");
    return null;
  }

  try {
    var config = {
      imap: {
        user: credentials.imapEmail,
        password: credentials.imapPassword,
        host: credentials.imapHost,
        port: credentials.imapPort,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000,
      }
    };

    addLog("Checking email for 2FA code...", "system");
    var connection = await imaps.connect(config);
    await connection.openBox("INBOX");

    // Search for recent Target emails (last 2 minutes)
    var delay = 2 * 60 * 1000;
    var since = new Date(Date.now() - delay);
    var searchCriteria = [
      ["SINCE", since],
      ["FROM", "Target"],
    ];
    var fetchOptions = { bodies: ["TEXT", "HEADER"], markSeen: false };
    var messages = await connection.search(searchCriteria, fetchOptions);

    // Sort by date, newest first
    messages.sort(function(a, b) {
      var dateA = new Date(a.attributes.date);
      var dateB = new Date(b.attributes.date);
      return dateB - dateA;
    });

    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      var body = "";
      msg.parts.forEach(function(part) {
        if (part.which === "TEXT") body = part.body;
      });

      // Look for verification code patterns
      var codeMatch = body.match(/\b(\d{6})\b/);
      if (!codeMatch) codeMatch = body.match(/verification\s*(?:code)?[:\s]*(\d{4,8})/i);
      if (!codeMatch) codeMatch = body.match(/code[:\s]+(\d{4,8})/i);
      if (!codeMatch) codeMatch = body.match(/(\d{6})/);

      if (codeMatch) {
        addLog("Found 2FA code: " + codeMatch[1], "success");
        connection.end();
        return codeMatch[1];
      }
    }

    connection.end();
    addLog("No 2FA code found in recent emails", "warn");
    return null;
  } catch(err) {
    addLog("IMAP error: " + err.message, "error");
    return null;
  }
}

// ── AUTO LOGIN ─────────────────────────────────────────────────
async function startHarvester(autoLogin) {
  if (!puppeteer) {
    addLog("Cannot start — puppeteer not installed", "error");
    return;
  }
  if (harvesterStatus === "ready") {
    addLog("Already logged in and ready", "warn");
    return;
  }

  try {
    harvesterStatus = "harvesting";

    // Close existing if any
    if (harvesterBrowser) {
      await harvesterBrowser.close().catch(function() {});
    }

    addLog("Launching browser...", "system");
    harvesterBrowser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--start-maximized",
      ],
    });

    harvesterPage = await harvesterBrowser.newPage();
    await harvesterPage.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
    await harvesterPage.setViewport({ width: 1920, height: 1080 });

    addLog("Navigating to Target...", "system");
    await harvesterPage.goto("https://www.target.com", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    await sleep(2000);

    if (autoLogin && credentials.targetEmail && credentials.targetPassword) {
      addLog("Opening login page...", "system");

      // Click "Sign in or create account" button — this navigates to /login
      var signInBtn = null;
      var allButtons = await harvesterPage.$$("button");
      for (var bi = 0; bi < allButtons.length; bi++) {
        var btnText = await harvesterPage.evaluate(function(el) { return el.textContent.trim(); }, allButtons[bi]);
        if (btnText.toLowerCase().indexOf("sign in") !== -1) {
          signInBtn = allButtons[bi];
          break;
        }
      }

      if (signInBtn) {
        await Promise.all([
          harvesterPage.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(function() {}),
          signInBtn.click()
        ]);
        addLog("Login page loaded: " + harvesterPage.url(), "system");
      }

      await sleep(2000);

      // Step 1: Enter email — field is #username on the login page
      var emailInput = await harvesterPage.$("#username");
      if (!emailInput) emailInput = await harvesterPage.$('input[name="username"]');
      if (!emailInput) emailInput = await harvesterPage.$('input[type="text"]');

      if (emailInput) {
        await emailInput.click({ clickCount: 3 });
        await emailInput.type(credentials.targetEmail, { delay: 30 });
        addLog("Email entered", "system");
      } else {
        addLog("Could not find email field", "error");
        startCookiePoller();
        return;
      }

      // Step 2: Click Continue (AJAX, not navigation)
      addLog("Clicking Continue...", "system");
      var continueBtn = await harvesterPage.$("#login");
      if (continueBtn) {
        await continueBtn.click();
      } else {
        await harvesterPage.keyboard.press("Enter");
      }

      // Wait for auth method selection screen
      await sleep(4000);

      // Step 3: Target shows auth choices — click "Enter your password"
      addLog("Looking for 'Enter your password' option...", "system");
      var clickedPassword = false;

      // Search all clickable elements for "Enter your password" text
      var clickables = await harvesterPage.$$("button, a, div[role='button'], li, div[class*='Row'], div[class*='option'], div[class*='Option']");
      for (var ei = 0; ei < clickables.length; ei++) {
        var elText = await harvesterPage.evaluate(function(el) { return el.textContent.trim(); }, clickables[ei]);
        if (elText.indexOf("Enter your password") !== -1 && elText.length < 100) {
          await clickables[ei].click();
          clickedPassword = true;
          addLog("Clicked 'Enter your password'", "system");
          break;
        }
      }

      if (!clickedPassword) {
        // Fallback: click via JS on any element containing the text
        clickedPassword = await harvesterPage.evaluate(function() {
          var all = document.querySelectorAll("*");
          for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (el.children.length < 3 && el.textContent.trim().indexOf("Enter your password") !== -1) {
              el.click();
              return true;
            }
          }
          return false;
        });
        if (clickedPassword) addLog("Clicked password option via JS fallback", "system");
      }

      if (!clickedPassword) {
        addLog("Could not find 'Enter your password' option", "error");
        startCookiePoller();
        return;
      }

      // Wait for password input to appear
      await sleep(3000);

      // Step 4: Find and fill password field
      var passInput = await harvesterPage.$('#password, input[name="password"], input[type="password"]');
      if (!passInput) {
        await sleep(3000);
        passInput = await harvesterPage.$('#password, input[name="password"], input[type="password"]');
      }
      if (!passInput) {
        var passInputs = await harvesterPage.$$('input[type="password"]');
        if (passInputs.length > 0) passInput = passInputs[0];
      }

      if (passInput) {
        await passInput.click();
        await harvesterPage.keyboard.down("Control");
        await harvesterPage.keyboard.press("a");
        await harvesterPage.keyboard.up("Control");
        await harvesterPage.keyboard.press("Backspace");
        await harvesterPage.keyboard.type(credentials.targetPassword, { delay: 30 });
        addLog("Password entered", "system");
      } else {
        addLog("Password field not found after clicking password option", "warn");
        startCookiePoller();
        return;
      }

      await sleep(500);

      // Click login/submit button
      var loginBtn = await harvesterPage.$('#login, button[type="submit"], button[data-test="login-button"]');
      if (!loginBtn) loginBtn = await harvesterPage.$('button[id*="login"], button[class*="login"], button[id*="sign"]');
      if (loginBtn) {
        await loginBtn.click();
        addLog("Login submitted, waiting for response...", "system");
      } else {
        await harvesterPage.keyboard.press("Enter");
        addLog("Pressed Enter to submit login", "system");
      }

      await sleep(5000);

      // Check if 2FA is needed
      var pageText = await harvesterPage.evaluate(function() { return document.body.textContent; });
      var needs2FA = pageText.toLowerCase().indexOf("verification") !== -1 ||
                     pageText.toLowerCase().indexOf("verify") !== -1 ||
                     (pageText.toLowerCase().indexOf("code") !== -1 && pageText.toLowerCase().indexOf("sent") !== -1);

      if (needs2FA) {
        addLog("2FA required — checking email...", "system");

        await sleep(5000);
        var code = await fetchVerificationCode();

        if (!code) {
          for (var attempt = 0; attempt < 5 && !code; attempt++) {
            addLog("Waiting for 2FA email... (attempt " + (attempt + 2) + ")", "system");
            await sleep(5000);
            code = await fetchVerificationCode();
          }
        }

        if (code) {
          var codeInput = await harvesterPage.$('input[name="code"], input[type="tel"], input[data-test*="code"], input[id*="code"], input[aria-label*="code"]');
          if (!codeInput) codeInput = await harvesterPage.$('input[inputmode="numeric"]');
          if (!codeInput) codeInput = await harvesterPage.$('input[type="text"]:not([name="username"]):not([id="username"])');
          if (!codeInput) {
            // Try any visible input that isn't the search box
            var allInputs = await harvesterPage.$$("input");
            for (var ii = 0; ii < allInputs.length; ii++) {
              var iMeta = await harvesterPage.evaluate(function(el) {
                return { id: el.id, type: el.type, visible: el.offsetParent !== null, name: el.name };
              }, allInputs[ii]);
              if (iMeta.visible && iMeta.id !== "search" && iMeta.id !== "searchMobile" && iMeta.name !== "searchTerm" && iMeta.type !== "hidden" && iMeta.type !== "checkbox") {
                codeInput = allInputs[ii];
                break;
              }
            }
          }

          if (codeInput) {
            await codeInput.click({ clickCount: 3 });
            await codeInput.type(code, { delay: 50 });
            await sleep(500);
            var verifyBtn = await harvesterPage.$('button[type="submit"], button[data-test*="verify"]');
            if (verifyBtn) await verifyBtn.click();
            else await harvesterPage.keyboard.press("Enter");
            addLog("2FA code entered: " + code, "success");
            await sleep(5000);
            await dismissInterstitials();
          } else {
            addLog("Could not find 2FA input field", "error");
          }
        } else {
          addLog("Could not get 2FA code — enter it manually in the dashboard", "warn");
          harvesterStatus = "needs_2fa";
          startCookiePoller();
          return;
        }
      }
    } else {
      addLog("No credentials saved — log in manually in the browser window", "system");
    }

    // Handle post-login interstitial screens (phone number, surveys, etc.)
    await dismissInterstitials();

    // Start polling for cookies
    startCookiePoller();

    // Detect browser close
    harvesterBrowser.on("disconnected", function() {
      harvesterStatus = "disconnected";
      targetCookies = null;
      targetCookieArr = null;
      if (cookieRefreshInterval) clearInterval(cookieRefreshInterval);
      addLog("Harvester browser closed", "warn");
    });

  } catch(err) {
    harvesterStatus = "disconnected";
    addLog("Harvester error: " + err.message, "error");
  }
}

async function dismissInterstitials() {
  if (!harvesterPage) return;
  
  // Try up to 3 rounds of dismissing optional screens
  for (var round = 0; round < 3; round++) {
    await sleep(2000);
    
    try {
      var pageText = await harvesterPage.evaluate(function() { 
        return document.body ? document.body.textContent.toLowerCase() : ""; 
      });
      
      // "Add mobile phone" screen — click Skip
      // "Add phone number" screen — click Skip
      // Any "optional" or "skip" screen
      var needsSkip = pageText.indexOf("add mobile phone") !== -1 ||
                      pageText.indexOf("add phone number") !== -1 ||
                      pageText.indexOf("mobile phone number (optional)") !== -1 ||
                      pageText.indexOf("add your phone") !== -1;
      
      if (needsSkip) {
        addLog("Skipping optional screen (round " + (round + 1) + ")...", "system");
        
        // Look for Skip button/link
        var skipped = false;
        var allEls = await harvesterPage.$$("button, a, span[role='button']");
        for (var si = 0; si < allEls.length; si++) {
          var elText = await harvesterPage.evaluate(function(el) { return el.textContent.trim().toLowerCase(); }, allEls[si]);
          if (elText === "skip" || elText === "not now" || elText === "no thanks" || elText === "maybe later") {
            await allEls[si].click();
            skipped = true;
            addLog("Clicked '" + elText + "'", "system");
            break;
          }
        }
        
        if (!skipped) {
          // Try JS click on any element with "skip" text
          skipped = await harvesterPage.evaluate(function() {
            var all = document.querySelectorAll("*");
            for (var i = 0; i < all.length; i++) {
              var t = all[i].textContent.trim().toLowerCase();
              if ((t === "skip" || t === "not now") && all[i].children.length === 0) {
                all[i].click();
                return true;
              }
            }
            return false;
          });
          if (skipped) addLog("Skipped via JS fallback", "system");
        }
        
        if (skipped) {
          await sleep(2000);
          continue; // Check for more interstitials
        }
      }
      
      // If we're on the homepage or account page, we're done
      var url = harvesterPage.url();
      if (url.indexOf("/login") === -1 && url.indexOf("/account") !== -1 || url === "https://www.target.com/") {
        addLog("Login complete!", "success");
        break;
      }
      
      // No interstitial detected, move on
      if (!needsSkip) break;
      
    } catch(e) {
      // Page might be navigating
      break;
    }
  }
}

// ── TOKEN AUTO-REFRESH ─────────────────────────────────────────
// Checks token expiry and refreshes before it expires
var tokenRefreshInterval = null;

function getTokenExpiry() {
  if (!targetCookieArr) return null;
  var accessToken = targetCookieArr.find(function(c) { return c.name === "accessToken"; });
  if (!accessToken || !accessToken.value) return null;
  try {
    var parts = accessToken.value.split(".");
    if (parts[1]) {
      var payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
      return payload.exp ? payload.exp * 1000 : null; // milliseconds
    }
  } catch(e) {}
  return null;
}

async function refreshAccessToken() {
  if (!targetCookies) return false;

  // Find refreshToken in cookies
  var refreshToken = "";
  if (targetCookieArr) {
    targetCookieArr.forEach(function(c) {
      if (c.name === "refreshToken") refreshToken = c.value;
    });
  }

  if (!refreshToken) {
    addLog("No refreshToken — cannot auto-refresh. Paste new cookies.", "warn");
    return false;
  }

  try {
    addLog("Refreshing access token...", "system");
    var refreshUrl = "https://gsp.target.com/gsp/authentications/v1/auth_codes?client_id=ecom-web-1.0.0&grant_type=refresh_token&refresh_token=" + refreshToken;

    var res = await fetch(refreshUrl, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Cookie": targetCookies,
      }
    });

    if (res.ok) {
      // The response sets new cookies via Set-Cookie headers
      var newCookies = res.headers.raw()["set-cookie"];
      if (newCookies && newCookies.length > 0) {
        newCookies.forEach(function(cookieStr) {
          var name = cookieStr.split("=")[0];
          var value = cookieStr.split(";")[0].substring(name.length + 1);
          // Update in our cookie array
          var existing = targetCookieArr.find(function(c) { return c.name === name; });
          if (existing) {
            existing.value = value;
          } else {
            targetCookieArr.push({ name: name, value: value });
          }
        });

        // Rebuild cookie string
        targetCookies = targetCookieArr.map(function(c) {
          return c.name + "=" + c.value;
        }).join("; ");

        // Save to disk
        credentials.savedCookies = targetCookies;
        saveCredentials();

        addLog("Token refreshed successfully!", "success");
        return true;
      }
    }

    // Try alternate refresh endpoint
    var altUrl = "https://gsp.target.com/gsp/authentications/v1/token?client_id=ecom-web-1.0.0&grant_type=refresh_token&refresh_token=" + refreshToken;
    var res2 = await fetch(altUrl, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Cookie": targetCookies,
      }
    });

    if (res2.ok) {
      var data = await res2.json();
      if (data.access_token) {
        // Update accessToken in cookie array
        var atCookie = targetCookieArr.find(function(c) { return c.name === "accessToken"; });
        if (atCookie) atCookie.value = data.access_token;
        else targetCookieArr.push({ name: "accessToken", value: data.access_token });

        targetCookies = targetCookieArr.map(function(c) {
          return c.name + "=" + c.value;
        }).join("; ");

        credentials.savedCookies = targetCookies;
        saveCredentials();

        addLog("Token refreshed via alt endpoint!", "success");
        return true;
      }
    }

    addLog("Alt endpoint failed, trying session refresh...", "system");

    // Try third method — hit Target's token refresh via the login endpoint
    try {
      var refreshUrl3 = "https://gsp.target.com/gsp/authentications/v1/credential_access_tokens?client_id=ecom-web-1.0.0";
      var res3 = await fetch(refreshUrl3, {
        method: "POST",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Cookie": targetCookies,
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: "ecom-web-1.0.0"
        })
      });

      if (res3.ok) {
        var data3 = await res3.json();
        if (data3.access_token) {
          var atCookie3 = targetCookieArr.find(function(c) { return c.name === "accessToken"; });
          if (atCookie3) atCookie3.value = data3.access_token;
          else targetCookieArr.push({ name: "accessToken", value: data3.access_token });

          if (data3.refresh_token) {
            var rtCookie = targetCookieArr.find(function(c) { return c.name === "refreshToken"; });
            if (rtCookie) rtCookie.value = data3.refresh_token;
            else targetCookieArr.push({ name: "refreshToken", value: data3.refresh_token });
          }

          targetCookies = targetCookieArr.map(function(c) {
            return c.name + "=" + c.value;
          }).join("; ");

          credentials.savedCookies = targetCookies;
          saveCredentials();

          addLog("Token refreshed via credential endpoint!", "success");
          return true;
        }
      }
    } catch(e) {}

    // Fourth method — hit Target homepage to get fresh cookies via Set-Cookie
    try {
      addLog("Trying homepage cookie refresh...", "system");
      var res4 = await fetch("https://www.target.com", {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept": "text/html",
          "Cookie": targetCookies,
        },
        redirect: "follow"
      });

      if (res4.ok) {
        var newCookies4 = res4.headers.raw()["set-cookie"];
        if (newCookies4 && newCookies4.length > 0) {
          var gotNewToken = false;
          newCookies4.forEach(function(cookieStr) {
            var parts = cookieStr.split(";")[0].split("=");
            var name = parts[0];
            var value = parts.slice(1).join("=");
            if (name === "accessToken" && value.length > 50) {
              gotNewToken = true;
              var existing = targetCookieArr.find(function(c) { return c.name === name; });
              if (existing) existing.value = value;
              else targetCookieArr.push({ name: name, value: value });
            }
            if (name === "refreshToken" || name === "idToken") {
              var existing2 = targetCookieArr.find(function(c) { return c.name === name; });
              if (existing2) existing2.value = value;
              else targetCookieArr.push({ name: name, value: value });
            }
          });

          if (gotNewToken) {
            targetCookies = targetCookieArr.map(function(c) {
              return c.name + "=" + c.value;
            }).join("; ");
            credentials.savedCookies = targetCookies;
            saveCredentials();
            addLog("Token refreshed via homepage cookies!", "success");
            return true;
          }
        }
      }
    } catch(e) {}

    addLog("All token refresh methods failed — paste new cookies", "error");
    harvesterStatus = "harvesting";

    // Notify Discord that cookies need refresh
    if (CONFIG.DISCORD_CHECKOUT_WEBHOOK) {
      await fetch(CONFIG.DISCORD_CHECKOUT_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "StockPulse",
          content: "@everyone TARGET COOKIES EXPIRED — paste new cookies in dashboard!",
          embeds: [{
            title: "Session Expired",
            color: 16711680,
            description: "Auto-checkout is disabled until cookies are refreshed.\n\n1. Open target.com → log in\n2. F12 → Console → `copy(document.cookie)`\n3. F12 → Application → Cookies → copy accessToken\n4. Paste both in StockPulse Settings → Connect",
            timestamp: new Date().toISOString(),
            footer: { text: "StockPulse" },
          }],
        }),
      }).catch(function() {});
    }

    return false;
  } catch(err) {
    addLog("Token refresh error: " + err.message, "error");
    return false;
  }
}

function startTokenRefreshTimer() {
  if (tokenRefreshInterval) clearInterval(tokenRefreshInterval);

  // Check every 5 minutes if token needs refresh
  tokenRefreshInterval = setInterval(async function() {
    var expiry = getTokenExpiry();
    if (!expiry) return;

    var now = Date.now();
    var timeLeft = expiry - now;
    var minutesLeft = Math.floor(timeLeft / 60000);

    if (minutesLeft <= 60 && minutesLeft > 0) {
      addLog("Token expires in " + minutesLeft + " min — refreshing...", "warn");
      await refreshAccessToken();
    } else if (minutesLeft <= 0) {
      addLog("Token EXPIRED — attempting refresh...", "error");
      var ok = await refreshAccessToken();
      if (!ok) {
        harvesterStatus = "harvesting";
        addLog("Token expired and refresh failed — paste new cookies!", "error");
      }
    }
  }, 120000); // Check every 2 minutes
}

function startCookiePoller() {
  if (cookieRefreshInterval) clearInterval(cookieRefreshInterval);

  cookieRefreshInterval = setInterval(async function() {
    try {
      if (!harvesterPage || harvesterPage.isClosed()) {
        clearInterval(cookieRefreshInterval);
        harvesterStatus = "disconnected";
        targetCookies = null;
        return;
      }

      var cookies = await harvesterPage.cookies("https://www.target.com");
      var accessToken = cookies.find(function(c) { return c.name === "accessToken"; });
      var idToken = cookies.find(function(c) { return c.name === "idToken"; });

      if (accessToken && accessToken.value.length > 50) {
        targetCookieArr = cookies;
        targetCookies = cookies.map(function(c) {
          return c.name + "=" + c.value;
        }).join("; ");

        if (harvesterStatus !== "ready") {
          var isLoggedIn = false;
          if (idToken) {
            try {
              var parts = idToken.value.split(".");
              if (parts[1]) {
                var payload = Buffer.from(parts[1], "base64").toString();
                isLoggedIn = payload.indexOf('"sut":"R"') !== -1 || payload.indexOf('"sut":"S"') !== -1;
              }
            } catch(e) {}
          }
          if (isLoggedIn) {
            harvesterStatus = "ready";
            addLog("LOGGED IN — cookies harvested, instant ATC ready!", "success");
          }
        }
      }
    } catch(e) {}
  }, 5000);
}

async function stopHarvester() {
  if (cookieRefreshInterval) clearInterval(cookieRefreshInterval);
  if (harvesterBrowser) {
    await harvesterBrowser.close().catch(function() {});
  }
  harvesterBrowser = null;
  harvesterPage = null;
  targetCookies = null;
  targetCookieArr = null;
  harvesterStatus = "disconnected";
  addLog("Harvester stopped", "system");
}

// ── INSTANT ADD-TO-CART VIA API ────────────────────────────────
async function instantATC(sku, qty) {
  if (!targetCookies || harvesterStatus !== "ready") {
    addLog("Cannot ATC — no harvested cookies. Open the harvester first.", "error");
    return { ok: false, error: "No cookies" };
  }

  try {
    // Extract tokens from cookies
    var accessToken = "";
    var visitorId = "";
    if (targetCookieArr) {
      targetCookieArr.forEach(function(c) {
        if (c.name === "accessToken") accessToken = c.value;
        if (c.name === "visitorId") visitorId = c.value;
      });
    }

    // Target ATC API endpoint
    var atcUrl = "https://carts.target.com/web_checkouts/v1/cart_items?field_groups=CART%2CCART_ITEMS%2CSUMMARY&key=" + CONFIG.API_KEY;

    var body = {
      cart_type: "REGULAR",
      channel_id: "10",
      shopping_context: "DIGITAL",
      cart_item: {
        tcin: String(sku),
        quantity: qty || CONFIG.ATC_QTY || 1,
        item_channel_id: "10",
      }
    };

    var headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Referer": "https://www.target.com/p/-/A-" + sku,
      "Origin": "https://www.target.com",
      "Cookie": targetCookies,
    };

    if (accessToken) {
      headers["Authorization"] = "Bearer " + accessToken;
    }

    var agent = getProxyAgent();
    var opts = {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
    };
    if (agent) opts.agent = agent;

    var ATC_MAX_RETRIES = CONFIG.ATC_MAX_RETRIES || 10;
    var ATC_RETRY_DELAY = CONFIG.ATC_RETRY_DELAY_MS || 300;

    for (var atcAttempt = 1; atcAttempt <= ATC_MAX_RETRIES; atcAttempt++) {
      try {
        addLog("Firing ATC for " + sku + " x" + (qty || 1) + " (attempt " + atcAttempt + ")...", "system");
        var res = await fetch(atcUrl, opts);
        var resBody = await res.text();

        if (res.ok || res.status === 201) {
          addLog("ADDED TO CART: " + sku + " x" + (qty || 1) + " (attempt " + atcAttempt + ")", "success");
          try {
            var cartData = JSON.parse(resBody);
            var cartItem = cartData && cartData.cart_items && cartData.cart_items[0];
            if (cartItem && cartItem.quantity) {
              addLog("Cart confirmed qty: " + cartItem.quantity, "info");
            }
          } catch(e) {}
          return { ok: true };
        } else if (res.status === 403) {
          addLog("ATC blocked (403) — cookies may be expired", "error");
          harvesterStatus = "harvesting";
          return { ok: false, error: "Blocked - reharvest cookies" };
        } else if (res.status === 401) {
          addLog("ATC unauthorized (401) — re-login needed", "error");
          harvesterStatus = "harvesting";
          return { ok: false, error: "Unauthorized - relogin" };
        }

        // Check if retryable
        var resLower = resBody.toLowerCase();
        var atcRetryable = res.status === 429 || res.status === 503 || res.status === 502 || res.status === 500 ||
                           resLower.indexOf("busy") !== -1 || resLower.indexOf("try again") !== -1 ||
                           resLower.indexOf("rate limit") !== -1 || resLower.indexOf("temporarily") !== -1;

        if (atcRetryable && atcAttempt < ATC_MAX_RETRIES) {
          addLog("ATC busy (" + res.status + ") — retry " + atcAttempt, "warn");
          await sleep(ATC_RETRY_DELAY);
          continue;
        }

        // Non-retryable error
        var errMsg = "";
        try {
          var errData = JSON.parse(resBody);
          errMsg = (errData.errors && errData.errors[0] && errData.errors[0].message) || resBody.substring(0, 200);
        } catch(e) { errMsg = resBody.substring(0, 200); }
        addLog("ATC failed (" + res.status + "): " + errMsg, "error");
        return { ok: false, error: errMsg };

      } catch(fetchErr) {
        if (atcAttempt < ATC_MAX_RETRIES) {
          addLog("ATC network error — retry " + atcAttempt + " (" + fetchErr.message.substring(0, 40) + ")", "warn");
          await sleep(ATC_RETRY_DELAY);
          continue;
        }
        addLog("ATC failed after " + ATC_MAX_RETRIES + " attempts", "error");
        return { ok: false, error: fetchErr.message };
      }
    }
    return { ok: false, error: "ATC max retries exhausted" };
  } catch(err) {
    addLog("ATC error: " + err.message, "error");
    return { ok: false, error: err.message };
  }
}

// ── AUTO PLACE ORDER ───────────────────────────────────────────
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
          title: "ORDER PLACED: " + (product ? product.name : "Unknown"),
          url: product ? "https://www.target.com/p/-/A-" + product.sku : "https://www.target.com",
          color: 65280, // bright green
          fields: [
            { name: "SKU", value: product ? product.sku : "N/A", inline: true },
            { name: "Type", value: product ? product.type : "N/A", inline: true },
            { name: "Price", value: product && product.currentPrice ? "$" + product.currentPrice : "N/A", inline: true },
            { name: "Qty", value: String(CONFIG.ATC_QTY), inline: true },
            { name: "Total Est.", value: product && product.currentPrice ? "$" + (product.currentPrice * CONFIG.ATC_QTY).toFixed(2) : "N/A", inline: true },
            { name: "Order Info", value: orderInfo || "Check target.com/orders", inline: false },
          ],
          thumbnail: product ? { url: "https://target.scene7.com/is/image/Target/" + product.sku } : undefined,
          timestamp: new Date().toISOString(),
          footer: { text: "StockPulse Auto-Checkout" },
        }],
      }),
    });
    addLog("Checkout notification sent to Discord", "discord");
  } catch(e) {
    addLog("Checkout Discord error: " + e.message, "error");
  }
}

async function placeOrder(productForSafetyCheck) {
  if (!targetCookies || harvesterStatus !== "ready") {
    addLog("Cannot place order — no cookies", "error");
    return { ok: false, error: "No cookies" };
  }
  if (!credentials.cvv) {
    addLog("Cannot place order — no CVV saved. Add it in Settings.", "error");
    return { ok: false, error: "No CVV" };
  }
  // FINAL SAFETY: Block third-party sellers
  if (productForSafetyCheck && productForSafetyCheck.isThirdParty) {
    addLog("BLOCKED by placeOrder safety: third-party seller " + productForSafetyCheck.seller, "error");
    return { ok: false, error: "Third-party seller blocked" };
  }

  // Checkout uses a DIFFERENT API key than product pages
  var CHECKOUT_KEY = CONFIG.CHECKOUT_API_KEY;

  // No Authorization header — checkout uses cookies only (accessToken is in the cookie string)
  // IMPORTANT: Checkout calls go DIRECT (no proxy) — they need your real session
  var http = require("http");
  var https = require("https");
  var directAgent = new https.Agent({ keepAlive: true });

  var headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Referer": "https://www.target.com/checkout",
    "Origin": "https://www.target.com",
    "Cookie": targetCookies,
  };

  // Force direct connection (no proxy) for checkout
  var directOpts = { headers: headers, agent: directAgent };

  try {
    // Step 1: Get cart view to find payment_instruction_id
    addLog("Getting checkout cart...", "system");
    var cartUrl = "https://carts.target.com/web_checkouts/v1/cart_views?cart_type=REGULAR&field_groups=ADDRESSES%2CCART%2CCART_ITEMS%2CFINANCE_PROVIDERS%2CPAYMENT_INSTRUCTIONS%2CPICKUP_INSTRUCTIONS%2CPROMOTION_CODES%2CSUMMARY&key=" + CHECKOUT_KEY + "&refresh=true";

    var r0 = await fetch(cartUrl, directOpts);
    if (!r0.ok) {
      addLog("Cart view failed: " + r0.status, "error");
      return { ok: false, error: "Cart view failed" };
    }
    var cartData = await r0.json();
    var cartId = cartData.cart_id || "";
    var paymentId = "";
    if (cartData.payment_instructions && cartData.payment_instructions[0]) {
      paymentId = cartData.payment_instructions[0].payment_instruction_id;
    }

    if (!paymentId) {
      addLog("No payment method on account", "error");
      return { ok: false, error: "No payment method" };
    }

    var summary = cartData.summary;
    if (summary) {
      addLog("Cart: $" + summary.grand_total + " (" + summary.items_quantity + " items)", "system");
    }

    // Step 2: Set CVV via checkout_payments endpoint (NOT web_checkouts!)
    addLog("Setting CVV...", "system");
    var cvvUrl = "https://carts.target.com/checkout_payments/v1/payment_instructions/" + paymentId + "?key=" + CHECKOUT_KEY;
    var cvvBody = {
      card_details: { cvv: credentials.cvv },
      cart_id: cartId,
      payment_type: "CARD",
      wallet_mode: "NONE"
    };

    var r1 = await fetch(cvvUrl, {
      method: "PUT",
      headers: headers,
      body: JSON.stringify(cvvBody),
      agent: directAgent
    });

    if (!r1.ok) {
      var r1Text = await r1.text();
      addLog("CVV failed (" + r1.status + "): " + r1Text.substring(0, 200), "error");
      return { ok: false, error: "CVV failed: " + r1.status };
    }
    addLog("CVV set successfully", "system");

    // Step 3: Set all items to SHIPPING fulfillment
    addLog("Setting shipping fulfillment...", "system");
    try {
      // Update each cart item to use shipping
      if (cartData.cart_items && cartData.cart_items.length > 0) {
        for (var ci = 0; ci < cartData.cart_items.length; ci++) {
          var cartItem = cartData.cart_items[ci];
          var itemId = cartItem.cart_item_id;
          if (!itemId) continue;

          var fulfillUrl = "https://carts.target.com/web_checkouts/v1/cart_item_fulfillment?key=" + CHECKOUT_KEY;
          var fulfillBody = {
            cart_type: "REGULAR",
            cart_item_id: itemId,
            fulfillment_type: "SHIP"
          };

          var rf = await fetch(fulfillUrl, {
            method: "PUT",
            headers: headers,
            body: JSON.stringify(fulfillBody),
            agent: directAgent
          });

          if (rf.ok) {
            addLog("Set shipping for item " + (cartItem.tcin || itemId.substring(0, 8)), "system");
          } else {
            // Try alternate endpoint/format
            var fulfillUrl2 = "https://carts.target.com/web_checkouts/v1/cart_items/" + itemId + "?key=" + CHECKOUT_KEY;
            var fulfillBody2 = {
              cart_type: "REGULAR",
              fulfillment: { type: "SHIP", shipping_method: "STANDARD" }
            };
            var rf2 = await fetch(fulfillUrl2, {
              method: "PUT",
              headers: headers,
              body: JSON.stringify(fulfillBody2),
              agent: directAgent
            });
            if (rf2.ok) {
              addLog("Set shipping (alt) for item " + (cartItem.tcin || itemId.substring(0,8)), "system");
            }
          }
        }
      }
    } catch(e) {
      addLog("Fulfillment set warning: " + e.message, "warn");
    }

    // Step 4: Place order — POST checkout with aggressive retry
    var checkoutUrl = "https://carts.target.com/web_checkouts/v1/checkout?field_groups=CART%2CCART_ITEMS%2CSUMMARY%2CPROMOTION_CODES%2CADDRESSES%2CPAYMENT_INSTRUCTIONS&key=" + CHECKOUT_KEY;
    var checkoutBody = JSON.stringify({ cart_type: "REGULAR", channel_id: "90" });

    var MAX_RETRIES = CONFIG.CHECKOUT_MAX_RETRIES || 15;
    var RETRY_DELAY = CONFIG.CHECKOUT_RETRY_DELAY_MS || 500;

    for (var attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        addLog("Placing order (attempt " + attempt + "/" + MAX_RETRIES + ")...", "system");

        var r2 = await fetch(checkoutUrl, {
          method: "POST",
          headers: headers,
          body: checkoutBody,
          agent: directAgent
        });
        var r2Body = await r2.text();

        if (r2.ok || r2.status === 201) {
          addLog("ORDER PLACED SUCCESSFULLY on attempt " + attempt + "!", "success");
          try {
            var orderData = JSON.parse(r2Body);
            var orderId = orderData.order_id || orderData.cart_id || "unknown";
            addLog("Order ID: " + orderId, "success");
          } catch(e) {}
          return { ok: true, response: r2Body.substring(0, 500) };
        }

        // Check if retryable error
        var r2Lower = r2Body.toLowerCase();
        var isRetryable = r2.status === 429 || // rate limited
                          r2.status === 503 || // service unavailable
                          r2.status === 502 || // bad gateway
                          r2.status === 500 || // server error
                          r2Lower.indexOf("busy") !== -1 ||
                          r2Lower.indexOf("high traffic") !== -1 ||
                          r2Lower.indexOf("try again") !== -1 ||
                          r2Lower.indexOf("temporarily") !== -1 ||
                          r2Lower.indexOf("rate limit") !== -1 ||
                          r2Lower.indexOf("too many") !== -1 ||
                          r2Lower.indexOf("experiencing") !== -1;

        if (isRetryable && attempt < MAX_RETRIES) {
          addLog("Checkout busy (" + r2.status + ") — retry " + attempt + "...", "warn");
          await sleep(RETRY_DELAY);
          continue;
        }

        // Check if CVV expired (need to re-set)
        if (r2Body.indexOf("MISSING_CREDIT_CARD_CVV") !== -1) {
          addLog("CVV expired mid-checkout — re-setting...", "warn");
          // Re-set CVV
          var cvvRetry = await fetch(cvvUrl, {
            method: "PUT",
            headers: headers,
            body: JSON.stringify(cvvBody),
            agent: directAgent
          });
          if (cvvRetry.ok) {
            addLog("CVV re-set, retrying checkout...", "system");
            continue;
          }
        }

        // Non-retryable error
        addLog("Order failed (" + r2.status + "): " + r2Body.substring(0, 300), "error");
        return { ok: false, error: r2Body.substring(0, 300) };

      } catch(fetchErr) {
        // Network error — always retry
        if (attempt < MAX_RETRIES) {
          addLog("Network error — retrying in " + RETRY_DELAY + "ms... (" + fetchErr.message.substring(0, 50) + ")", "warn");
          await sleep(RETRY_DELAY);
          continue;
        }
        addLog("Order failed after " + MAX_RETRIES + " attempts: " + fetchErr.message, "error");
        return { ok: false, error: fetchErr.message };
      }
    }

    addLog("Order failed — max retries (" + MAX_RETRIES + ") exhausted", "error");
    return { ok: false, error: "Max retries exhausted" };
  } catch(err) {
    addLog("Place order error: " + err.message, "error");
    return { ok: false, error: err.message };
  }
}

function shouldAlert(product, result) {
  if (result.status !== "IN_STOCK") return false;
  if (result.isThirdParty) return false;
  var maxPrice = product.msrp * (1 + CONFIG.MAX_PERCENT_ABOVE_MSRP / 100);
  if (result.price && result.price > maxPrice) return false;
  return true;
}

// ── MSRP AUTO-DETECT ───────────────────────────────────────────
async function detectMsrp(product) {
  try {
    var result = await checkSingleSku(product.sku);
    if (result.status === "ERROR") return null;
    return { price: result.price, title: result.title };
  } catch (err) {
    return null;
  }
}

async function autoDetectAllMsrps() {
  addLog("Auto-detecting MSRPs from Target...", "system");
  var updated = 0;
  var titled = 0;
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    var result = await detectMsrp(p);
    if (result) {
      if (result.price && result.price > 0) {
        var oldMsrp = p.msrp;
        p.msrp = result.price;
        if (oldMsrp !== result.price) {
          updated++;
          addLog("MSRP " + p.sku + ": $" + oldMsrp + " -> $" + result.price + " (" + p.name + ")", "info");
        }
      }
      if (result.title) {
        // Strip common prefixes
        var cleanTitle = result.title
          .replace(/^Pok[eé]mon Trading Card Game:\s*/i, "")
          .replace(/^Pok[eé]mon TCG:\s*/i, "")
          .replace(/^Pokemon\s+/i, "")
          .replace(/&#\d+;/g, "")
          .trim();
        if (cleanTitle) p.name = cleanTitle;
        titled++;
      }
    }
    await sleep(CONFIG.REQUEST_DELAY_MS);
  }
  addLog("MSRP scan done: " + updated + " prices updated, " + titled + " titles refreshed", "system");
}

// ── MONITOR LOOP ───────────────────────────────────────────────
var cycleOffset = 0; // tracks rotation position across cycles

async function runCycle() {
  var enabled = products.filter(function(p) { return p.enabled; });
  if (enabled.length === 0) return;
  cycleCount++;

  // Batch rotation — only check MAX_CHECKS_PER_CYCLE SKUs per cycle
  var batchSize = CONFIG.MAX_CHECKS_PER_CYCLE || enabled.length;
  var startIdx = cycleOffset % enabled.length;
  var batch = [];
  for (var b = 0; b < Math.min(batchSize, enabled.length); b++) {
    batch.push(enabled[(startIdx + b) % enabled.length]);
  }
  cycleOffset += batchSize;

  addLog("Cycle #" + cycleCount + " - checking " + batch.length + "/" + enabled.length + " SKUs", "system");

  for (var i = 0; i < batch.length; i++) {
    if (!monitorRunning) break;
    var product = batch[i];
    var result = await checkSingleSku(product.sku);
    totalChecks++;
    product.checks++;
    product.lastChecked = new Date().toISOString();

    if (result.status === "ERROR") {
      product.status = "ERROR";
    } else {
      product.status = result.status;
      if (result.price != null) product.currentPrice = result.price;
      if (result.seller) product.seller = result.seller;
      product.isThirdParty = !!result.isThirdParty;
      if (result.title && product.name.indexOf("Unknown") === 0) {
        product.name = result.title
          .replace(/^Pok[eé]mon Trading Card Game:\s*/i, "")
          .replace(/^Pok[eé]mon TCG:\s*/i, "")
          .replace(/^Pokemon\s+/i, "")
          .replace(/&#\d+;/g, "")
          .trim();
      }
      if (result.quantity != null) product.quantity = result.quantity;
      product.shipAvailable = !!result.shipAvailable;
      product.pickupAvailable = !!result.pickupAvailable;

      if (shouldAlert(product, result)) {
        product.alerts++;
        totalAlerts++;
        addLog("ALERT: " + product.name + " | " + (result.priceFormatted || "?") + " | Qty:" + (result.quantity || "?"), "success");
        // Instant ATC — fire before Discord alert for speed
        if (CONFIG.AUTO_ATC && harvesterStatus === "ready") {
          var atcResult = await instantATC(product.sku, CONFIG.ATC_QTY);
          if (atcResult.ok) {
            addLog("IN CART — " + product.name + " x" + CONFIG.ATC_QTY, "success");
            // Auto place order only if this product has autoCheckout enabled
            if (product.autoCheckout && credentials.cvv) {
              // SAFETY: Double-check this is NOT a third-party seller
              if (product.isThirdParty || (result.seller && result.seller.toLowerCase() !== "target" && result.seller.toLowerCase() !== "target corporation")) {
                addLog("BLOCKED: Will not auto-checkout third-party seller: " + (result.seller || product.seller), "error");
              } else if (canOrderToday(product.sku)) {
                addLog("Auto-checkout enabled — placing order...", "system");
                var orderResult = await placeOrder(product);
                if (orderResult.ok) {
                  recordOrder(product.sku);
                  addLog("ORDER PLACED for " + product.name + " x" + CONFIG.ATC_QTY + "!", "success");
                  // Send to checkout Discord channel
                  var orderInfo = orderResult.response ? orderResult.response.substring(0, 200) : "Success";
                  await sendCheckoutSuccess(product, orderInfo);
                }
              } else {
                addLog("Daily order limit reached for " + product.sku + " — skipping auto-checkout", "warn");
                if (CONFIG.AUTO_OPEN_CHECKOUT) openInBrowser("https://www.target.com/checkout");
              }
            } else if (CONFIG.AUTO_OPEN_CHECKOUT) {
              // No auto-checkout — open browser instead
              openInBrowser("https://www.target.com/checkout");
            }
          }
        }
        await sendDiscordAlert(product, result);
      } else if (result.status === "IN_STOCK" && result.isThirdParty) {
        addLog("Skip 3P: " + product.name + " - " + result.seller, "warn");
      } else if (result.status === "IN_STOCK" && result.price && result.price > product.msrp * (1 + CONFIG.MAX_PERCENT_ABOVE_MSRP / 100)) {
        addLog("Skip $$: " + product.name + " $" + result.price, "warn");
      }
    }
    await sleep(CONFIG.REQUEST_DELAY_MS);
  }
  var inStock = products.filter(function(p) { return p.status === "IN_STOCK"; }).length;
  addLog("Cycle done - " + inStock + " in stock / " + totalAlerts + " alerts total", "system");
}

async function monitorLoop() {
  while (monitorRunning) {
    await runCycle();
    if (monitorRunning) await sleep(CONFIG.POLL_INTERVAL_MS);
  }
}

// ── EXPRESS ────────────────────────────────────────────────────
app.use(express.json());

app.get("/", function(req, res) {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.get("/api/state", function(req, res) {
  res.json({
    products: products,
    logs: logs.slice(-200),
    config: { msrpThreshold: CONFIG.MAX_PERCENT_ABOVE_MSRP, autoAtc: CONFIG.AUTO_ATC },
    harvester: harvesterStatus,
    tokenExpiry: getTokenExpiry ? getTokenExpiry() : null,
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

app.post("/api/start", function(req, res) {
  if (!monitorRunning) { monitorRunning = true; startTime = Date.now(); addLog("Monitor STARTED", "system"); monitorLoop(); }
  res.json({ ok: true });
});

app.post("/api/stop", function(req, res) {
  monitorRunning = false; addLog("Monitor STOPPED", "system");
  res.json({ ok: true });
});

app.post("/api/toggle/:sku", function(req, res) {
  var p = products.find(function(x) { return x.sku === req.params.sku; });
  if (p) { p.enabled = !p.enabled; res.json({ ok: true }); }
  else res.status(404).json({ error: "not found" });
});

app.post("/api/toggle-all", function(req, res) {
  products.forEach(function(p) { p.enabled = !!req.body.enabled; });
  res.json({ ok: true });
});

app.post("/api/toggle-checkout/:sku", function(req, res) {
  var p = products.find(function(x) { return x.sku === req.params.sku; });
  if (p) { p.autoCheckout = !p.autoCheckout; res.json({ ok: true }); }
  else res.status(404).json({ error: "not found" });
});

app.post("/api/scan-msrp", async function(req, res) {
  autoDetectAllMsrps();
  res.json({ ok: true, msg: "MSRP scan started" });
});

app.post("/api/harvester/start", async function(req, res) {
  // No longer uses Puppeteer for login — use paste cookies instead
  addLog("Use 'Paste Cookies' in Settings to connect your Target session", "system");
  res.json({ ok: true, msg: "Use Paste Cookies in Settings" });
});

app.post("/api/harvester/cookies", function(req, res) {
  var cookieStr = (req.body.cookies || "").trim();
  if (!cookieStr) return res.status(400).json({ error: "No cookies provided" });

  // Validate it looks like cookies
  if (cookieStr.indexOf("=") === -1) return res.status(400).json({ error: "Invalid cookie format" });

  // Strip surrounding quotes if pasted from console
  cookieStr = cookieStr.replace(/^['"]|['"]$/g, "");

  targetCookies = cookieStr;

  // Parse into array format
  targetCookieArr = cookieStr.split("; ").map(function(c) {
    var eq = c.indexOf("=");
    return { name: c.substring(0, eq), value: c.substring(eq + 1) };
  });

  // Check if logged in by looking for idToken with registered user
  var hasId = targetCookieArr.some(function(c) { return c.name === "idToken" && c.value.length > 50; });
  var hasAccess = targetCookieArr.some(function(c) { return c.name === "accessToken" && c.value.length > 50; });
  
  if (hasId || hasAccess) {
    harvesterStatus = "ready";
    addLog("COOKIES SET — logged in and ready for instant ATC!", "success");
    startTokenRefreshTimer();

    // Show token expiry
    var expiry = getTokenExpiry();
    if (expiry) {
      var minsLeft = Math.floor((expiry - Date.now()) / 60000);
      addLog("Token expires in " + minsLeft + " minutes — auto-refresh enabled", "system");
    }

    // Save cookies to creds file for persistence
    credentials.savedCookies = cookieStr;
    saveCredentials();
  } else {
    harvesterStatus = "harvesting";
    addLog("Cookies set but no login token found — make sure you're logged in on target.com", "warn");
  }

  res.json({ ok: true, status: harvesterStatus });
});

app.post("/api/harvester/stop", async function(req, res) {
  await stopHarvester();
  res.json({ ok: true });
});

app.get("/api/harvester/status", function(req, res) {
  res.json({ status: harvesterStatus });
});

app.post("/api/harvester/credentials", function(req, res) {
  var b = req.body;
  if (b.targetEmail) credentials.targetEmail = b.targetEmail;
  if (b.targetPassword) credentials.targetPassword = b.targetPassword;
  if (b.imapHost) credentials.imapHost = b.imapHost;
  if (b.imapPort) credentials.imapPort = parseInt(b.imapPort) || 993;
  if (b.imapEmail) credentials.imapEmail = b.imapEmail;
  if (b.imapPassword) credentials.imapPassword = b.imapPassword;
  if (b.cvv) credentials.cvv = b.cvv;
  saveCredentials();
  addLog("Credentials saved", "system");
  res.json({ ok: true });
});

app.get("/api/harvester/credentials", function(req, res) {
  res.json({
    targetEmail: credentials.targetEmail || "",
    targetPassword: credentials.targetPassword ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "",
    hasTargetPassword: !!credentials.targetPassword,
    imapHost: credentials.imapHost || "imap.gmail.com",
    imapPort: credentials.imapPort || 993,
    imapEmail: credentials.imapEmail || "",
    imapPassword: credentials.imapPassword ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "",
    hasImapPassword: !!credentials.imapPassword,
  });
});

app.post("/api/harvester/2fa", async function(req, res) {
  var code = req.body.code;
  if (!code || !harvesterPage) return res.status(400).json({ error: "No code or no active session" });
  
  try {
    var codeInput = await harvesterPage.$('input[name="code"], input[type="tel"], input[data-test*="code"], input[id*="code"], input[aria-label*="code"]');
    if (!codeInput) codeInput = await harvesterPage.$('input[type="text"]:not([name="username"])');
    if (codeInput) {
      await codeInput.click({ clickCount: 3 });
      await codeInput.type(String(code), { delay: 50 });
      await sleep(500);
      var verifyBtn = await harvesterPage.$('button[type="submit"], button[data-test*="verify"]');
      if (verifyBtn) await verifyBtn.click();
      else await harvesterPage.keyboard.press("Enter");
      addLog("2FA code submitted: " + code, "system");
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: "Could not find code input field" });
    }
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/atc/:sku", async function(req, res) {
  var p = products.find(function(x) { return x.sku === req.params.sku; });
  if (!p) return res.status(404).json({ error: "SKU not found" });
  var result = await instantATC(p.sku, CONFIG.ATC_QTY);
  if (result.ok && CONFIG.AUTO_OPEN_CHECKOUT) {
    openInBrowser("https://www.target.com/checkout");
  }
  res.json(result);
});

app.post("/api/place-order", async function(req, res) {
  var result = await placeOrder();
  res.json(result);
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

      // Scrape the product page to get info
      var scrapeResult = await checkSingleSku(tcin);
      
      if (scrapeResult.status !== "ERROR") {
        if (scrapeResult.price) msrp = scrapeResult.price;
        if (scrapeResult.title) {
          name = scrapeResult.title
            .replace(/^Pok[eé]mon Trading Card Game:\s*/i, "")
            .replace(/^Pok[eé]mon TCG:\s*/i, "")
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

      products.push({
        name: name, type: type, sku: tcin, msrp: msrp,
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
      addLog("Added: " + name + " (" + tcin + ") $" + msrp + " [" + type + "] " + scrapeResult.status, "success");
    } catch (err) {
      addLog("Error adding " + tcin + ": " + err.message, "error");
    }
    await sleep(CONFIG.REQUEST_DELAY_MS);
  }

  res.json({ ok: true, added: added, total: products.length });

  // Stock already checked during add — no need for separate scan
});

// ── DELETE PRODUCT ──────────────────────────────────────────────
app.post("/api/delete/:sku", function(req, res) {
  var idx = products.findIndex(function(p) { return p.sku === req.params.sku; });
  if (idx !== -1) {
    var name = products[idx].name;
    products.splice(idx, 1);
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
// ── DISCORD STOCK ALERT LISTENER ───────────────────────────────
// Polls Discord channels for stock alerts using user token (no bot needed)
var lastMessageIds = {}; // { channelId: lastMessageId }
var discordPollInterval = null;

function getActiveChannelIds() {
  if (!CONFIG.DISCORD_LISTEN_CHANNELS || !CONFIG.DISCORD_ACTIVE_CHANNELS) return [];
  return CONFIG.DISCORD_ACTIVE_CHANNELS.map(function(key) {
    var ch = CONFIG.DISCORD_LISTEN_CHANNELS[key];
    return ch ? ch.id : null;
  }).filter(function(id) { return !!id; });
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

        // Check cookies
        if (!targetCookies || harvesterStatus !== "ready") {
          addLog("SKIP: Cookies not connected (status: " + harvesterStatus + ")", "error");
          continue;
        }
        addLog("✓ Cookies: connected", "system");

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
          addLog("⚠ Stock check: OUT OF STOCK — alert may be stale, attempting ATC anyway", "warn");
        } else if (stockCheck.status === "IN_STOCK") {
          addLog("✓ Stock VERIFIED: IN_STOCK!", "success");
        } else if (stockCheck.status === "ERROR") {
          addLog("⚠ Stock check error: " + (stockCheck.error || "unknown") + " — attempting ATC anyway", "warn");
        } else {
          addLog("⚠ Stock check inconclusive — attempting ATC", "system");
        }

        // FIRE ATC with retries
        addLog("═══ FIRING ATC: " + product.name + " x" + CONFIG.ATC_QTY + " ═══", "system");
        var atcResult = await instantATC(tcin, CONFIG.ATC_QTY);

        if (atcResult.ok) {
          addLog("✓ IN CART: " + product.name + " x" + CONFIG.ATC_QTY, "success");

          // Auto checkout
          addLog("═══ STARTING AUTO-CHECKOUT ═══", "system");
          if (product.isThirdParty) {
            addLog("BLOCKED: Third-party seller safety check", "error");
          } else if (!canOrderToday(tcin)) {
            addLog("BLOCKED: Daily limit reached mid-flow", "warn");
            if (CONFIG.AUTO_OPEN_CHECKOUT) openInBrowser("https://www.target.com/checkout");
          } else {
            var orderResult = await placeOrder(product);
            if (orderResult.ok) {
              recordOrder(tcin);
              addLog("═══ ORDER PLACED: " + product.name + " x" + CONFIG.ATC_QTY + " ═══", "success");
              addLog("Order response: " + (orderResult.response || "Success").substring(0, 150), "info");
              await sendCheckoutSuccess(product, orderResult.response || "Success");
            } else {
              addLog("Checkout failed: " + (orderResult.error || "unknown"), "error");
              addLog("Opening browser as fallback...", "system");
              if (CONFIG.AUTO_OPEN_CHECKOUT) openInBrowser("https://www.target.com/checkout");
              // Notify Discord about failure
              if (CONFIG.DISCORD_CHECKOUT_WEBHOOK) {
                await fetch(CONFIG.DISCORD_CHECKOUT_WEBHOOK, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    username: "StockPulse",
                    content: "@everyone CHECKOUT FAILED — item is in cart, complete manually!",
                    embeds: [{
                      title: "CHECKOUT FAILED: " + product.name,
                      url: "https://www.target.com/checkout",
                      color: 16711680, // red
                      fields: [
                        { name: "SKU", value: tcin, inline: true },
                        { name: "Error", value: (orderResult.error || "unknown").substring(0, 200), inline: false },
                        { name: "Action", value: "[Go to Checkout](https://www.target.com/checkout)", inline: false },
                      ],
                      timestamp: new Date().toISOString(),
                      footer: { text: "StockPulse — Complete checkout manually!" },
                    }],
                  }),
                }).catch(function() {});
              }
            }
          }

          // Send to our alert channel
          await sendDiscordAlert(product, {
            status: "IN_STOCK", price: product.currentPrice,
            priceFormatted: product.currentPrice ? "$" + product.currentPrice : "N/A",
            seller: product.seller || "Target", isThirdParty: false, quantity: null,
            shipAvailable: true, pickupAvailable: false,
          });
        } else {
          addLog("✗ ATC FAILED: " + (atcResult.error || "unknown"), "error");
          addLog("Opening browser as fallback...", "system");
          if (CONFIG.AUTO_OPEN_CHECKOUT) openInBrowser("https://www.target.com/p/-/A-" + tcin);
          // Notify Discord about ATC failure
          if (CONFIG.DISCORD_CHECKOUT_WEBHOOK) {
            await fetch(CONFIG.DISCORD_CHECKOUT_WEBHOOK, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                username: "StockPulse",
                content: "@everyone ATC FAILED — try manually!",
                embeds: [{
                  title: "ATC FAILED: " + product.name,
                  url: "https://www.target.com/p/-/A-" + tcin,
                  color: 16776960, // yellow
                  fields: [
                    { name: "SKU", value: tcin, inline: true },
                    { name: "Error", value: (atcResult.error || "unknown").substring(0, 200), inline: false },
                    { name: "Product", value: "[Open on Target](https://www.target.com/p/-/A-" + tcin + ")", inline: false },
                  ],
                  timestamp: new Date().toISOString(),
                  footer: { text: "StockPulse — Try manual purchase" },
                }],
              }),
            }).catch(function() {});
          }
        }
        addLog("═══ END DISCORD ALERT FLOW ═══", "system");
      }
    } catch(err) {
      // Silently ignore poll errors for this channel
    }
    } // end channel loop
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

// Cleanup browser on shutdown
process.on("SIGINT", async function() {
  console.log("\nShutting down...");
  if (browser) await browser.close().catch(function() {});
  if (harvesterBrowser) await harvesterBrowser.close().catch(function() {});
  process.exit();
});
process.on("SIGTERM", async function() {
  if (browser) await browser.close().catch(function() {});
  if (harvesterBrowser) await harvesterBrowser.close().catch(function() {});
  process.exit();
});
