// StockPulse Cookie Sync + Browser ATC/Checkout
var STOCKPULSE_URL = "http://localhost:3069/api/harvester/cookies";
var BASE = "http://localhost:3069";
var lastHash = "";
var debounceTimer = null;
var K_ATC = "9f36aeafbe60771e321a7cc95a78140772ab3e96";
var CHECKOUT_KEY = "e59ce3b531b2c39afb2e2b8a71ff10113aac2a14";

function spLog(msg, type) {
  console.log("[SP] " + msg);
  fetch(BASE + "/api/browser-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msg: msg, type: type || "system" })
  }).catch(function() {});
}

// ── COOKIE SYNC ────────────────────────────────────────────────
async function syncCookies() {
  try {
    var allCookies = [];
    try { var c1 = await chrome.cookies.getAll({ url: "https://www.target.com" }); allCookies = allCookies.concat(c1); } catch(e) {}
    try { var c2 = await chrome.cookies.getAll({ url: "https://carts.target.com" }); allCookies = allCookies.concat(c2); } catch(e) {}
    var rescueNames = [
      "accessToken", "refreshToken", "idToken", "_px3", "_pxvid", "pxcts",
      "3YCzT93n", "TealeafAkaSid", "visitorId", "sapphire", "fiatsCookie",
      "sddStore", "GuestLocation", "UserLocation", "mid", "loyaltyid",
      "BVBRANDID", "BVBRANDSID", "sapphire_audiences", "mystate",
      "AMCV_99DD1CFE5329660B0A490D45%40AdobeOrg", "AMCVS_99DD1CFE5329660B0A490D45%40AdobeOrg",
      "kampyleUserSession", "kampyleSessionPageCounter", "ffsession",
      "LAST_INVITATION_VIEW", "DECLINED_DATE", "profileCreatedDate",
      "ci_ref", "ci_cpng", "ci_pixmgr", "ci_lnm", "ci_clkid",
      "usprivacy", "stateprivacycontrols", "adScriptData", "bv_metrics",
      "lux_uid", "egsSessionId", "login-session"
    ];
    for (var ri = 0; ri < rescueNames.length; ri++) {
      try { var rc = await chrome.cookies.get({ url: "https://www.target.com", name: rescueNames[ri] }); if (rc) allCookies.push(rc); } catch(e) {}
    }
    var cookieMap = {};
    allCookies.forEach(function(c) { if (!cookieMap[c.name] || c.value.length > cookieMap[c.name].length) cookieMap[c.name] = c.value; });
    if (!cookieMap.accessToken) { chrome.action.setBadgeText({ text: "!" }); chrome.action.setBadgeBackgroundColor({ color: "#ff4444" }); return; }
    var cookieStr = Object.keys(cookieMap).map(function(n) { return n + "=" + cookieMap[n]; }).join("; ");
    var hash = cookieStr.length + "_" + cookieMap.accessToken.substring(0, 30);
    if (hash === lastHash) return;
    var res = await fetch(STOCKPULSE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cookies: cookieStr }) });
    var data = await res.json();
    if (data.ok && data.status === "ready") {
      lastHash = hash;
      chrome.action.setBadgeText({ text: "✓" }); chrome.action.setBadgeBackgroundColor({ color: "#00cc66" });
      try { var p = JSON.parse(atob(cookieMap.accessToken.split(".")[1])); spLog("Synced! Token:" + Math.floor((p.exp*1000-Date.now())/60000) + "m Cookies:" + Object.keys(cookieMap).length); } catch(e) {}
    }
  } catch(e) {}
}

chrome.alarms.create("sync", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(function(a) { if (a.name === "sync") syncCookies(); });
setInterval(syncCookies, 30000);
chrome.cookies.onChanged.addListener(function(i) {
  if (i.cookie.domain.indexOf("target.com") !== -1) {
    if (i.cookie.name === "accessToken" || i.cookie.name === "refreshToken") { lastHash = ""; syncCookies(); }
    else { clearTimeout(debounceTimer); debounceTimer = setTimeout(syncCookies, 1000); }
  }
});
chrome.runtime.onInstalled.addListener(syncCookies);

// Listen for alerts from Discord watcher content script
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg && msg.type === "discord-alert" && msg.payload) {
    fetch(BASE + "/api/discord-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg.payload)
    }).then(function(r) { return r.json(); }).then(function(d) {
      spLog("Discord alert forwarded: " + (msg.payload.tcins || []).join(", "), "system");
      sendResponse({ ok: true, result: d });
    }).catch(function(e) {
      spLog("Discord alert forward error: " + e.message, "error");
      sendResponse({ ok: false, error: e.message });
    });
    return true;
  }
});

// Also listen for external messages (from Discord page console)
chrome.runtime.onMessageExternal.addListener(function(msg, sender, sendResponse) {
  if (msg && msg.type === "discord-alert" && msg.payload) {
    fetch(BASE + "/api/discord-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg.payload)
    }).then(function(r) { return r.json(); }).then(function(d) {
      spLog("Discord alert (external): " + (msg.payload.tcins || []).join(", "), "system");
      sendResponse({ ok: true, result: d });
    }).catch(function(e) {
      sendResponse({ ok: false, error: e.message });
    });
    return true;
  }
});

// Keep service worker alive — Chrome kills inactive workers after 30s
// This alarm fires every 25s to keep it running
chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
chrome.runtime.onStartup.addListener(syncCookies);
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.action === "sync") { lastHash = ""; syncCookies().then(function() { sendResponse({ ok: true }); }); return true; }
  if (msg.action === "status") {
    (async function() {
      var at = await chrome.cookies.get({ url: "https://www.target.com", name: "accessToken" }).catch(function() { return null; });
      var rt = await chrome.cookies.get({ url: "https://www.target.com", name: "refreshToken" }).catch(function() { return null; });
      var ml = null;
      if (at) { try { var p = JSON.parse(atob(at.value.split(".")[1])); ml = Math.floor((p.exp*1000-Date.now())/60000); } catch(e) {} }
      sendResponse({ hasAccessToken: !!at, hasRefreshToken: !!rt, tokenMinutesLeft: ml, cookieCount: 0, lastSync: lastHash ? "synced" : "pending" });
    })();
    return true;
  }
});
syncCookies();

// ── FIND TARGET TAB ────────────────────────────────────────────
async function findTargetTab() {
  var tabs = await chrome.tabs.query({ url: "https://www.target.com/*" });
  for (var i = 0; i < tabs.length; i++) {
    var u = tabs[i].url || "";
    if (u.indexOf("/login") === -1 && u.indexOf("account") === -1) return tabs[i];
  }
  var tab = await chrome.tabs.create({ url: "https://www.target.com", active: false });
  await new Promise(function(r) { setTimeout(r, 4000); });
  return tab;
}

// ── BROWSER ATC via co-cart URL ────────────────────────────────
async function executeAtc(sku, qty) {
  try {
    var tab = await findTargetTab();
    var att = 0;
    var lastLogTime = Date.now();
    var reloaded = false;
    
    // Fire ATC immediately — no page load. Only reload on 401.
    while (true) {
      att++;
      var r = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function(sku, qty, key) {
          return fetch("https://carts.target.com/web_checkouts/v1/cart_items?field_groups=CART%2CCART_ITEMS%2CSUMMARY&key=" + key, {
            method: "POST", credentials: "include",
            headers: { "Accept": "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ cart_type: "REGULAR", channel_id: "10", shopping_context: "DIGITAL", cart_item: { tcin: String(sku), quantity: qty, item_channel_id: "10" } })
          }).then(function(r) { return r.text().then(function(t) { return { ok: r.ok, status: r.status, body: t.substring(0, 300) }; }); })
            .catch(function(e) { return { ok: false, error: e.message }; });
        },
        args: [sku, qty || 2, K_ATC]
      });
      var result = r && r[0] && r[0].result;
      
      // Success — verify cart
      if (result && (result.ok || result.status === 201)) {
        var v = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: function(key) {
            return fetch("https://carts.target.com/web_checkouts/v1/cart?field_groups=CART%2CCART_ITEMS%2CSUMMARY&key=" + key + "&cart_type=REGULAR", {
              credentials: "include", headers: {"Accept":"application/json"}
            }).then(function(r) { return r.json(); }).catch(function() { return null; });
          },
          args: [K_ATC]
        });
        var cart = v && v[0] && v[0].result;
        var items = cart && cart.summary ? cart.summary.items_quantity : 0;
        if (items > 0) {
          spLog("ATC SUCCESS attempt " + att + "! " + items + " item(s) $" + (cart.summary.grand_total || "?"), "success");
          return { success: true, tabId: tab.id };
        }
      }

      // 401 — reload page ONCE to refresh PX
      if (result && (result.status === 401 || result.status === 403) && !reloaded) {
        spLog("ATC: refreshing PX cookies...", "warn");
        await chrome.tabs.update(tab.id, { url: "https://www.target.com/p/-/A-" + sku });
        await new Promise(function(r) { setTimeout(r, 4000); });
        reloaded = true;
        continue;
      }
      // 401 after reload — give up
      if (result && (result.status === 401 || result.status === 403) && reloaded) {
        spLog("ATC: auth failed after PX refresh", "error");
        return { success: false, error: "Auth failed" };
      }

      // OOS — stop
      if (result && result.body) {
        var bl = result.body.toLowerCase();
        if (bl.indexOf("out of stock") !== -1 || bl.indexOf("not available") !== -1 || bl.indexOf("sold out") !== -1) {
          spLog("ATC: " + sku + " OOS after " + att + " attempts", "error");
          return { success: false, error: "OOS" };
        }
      }

      if (Date.now() - lastLogTime >= 5000) {
        spLog("ATC: attempt " + att + " (status:" + (result ? result.status : "?") + ")", "warn");
        lastLogTime = Date.now();
      }
      await new Promise(function(r) { setTimeout(r, 200); });
    }
  } catch(e) {
    spLog("ATC error: " + e.message, "error");
    return { success: false, error: e.message };
  }
}

// ── BROWSER CHECKOUT ───────────────────────────────────────────
async function executeCheckout(cvv, tabId) {
  try {
    var tab = tabId ? await chrome.tabs.get(tabId).catch(function() { return null; }) : null;
    if (!tab) tab = await findTargetTab();

    spLog("Checkout: setting up...", "system");

    // Navigate to checkout page to initialize payment session
    await chrome.tabs.update(tab.id, { url: "https://www.target.com/checkout" });
    await new Promise(function(r) { setTimeout(r, 2000); });

    // Get cart view with payment info
    var r1 = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function(key) {
        return fetch("https://carts.target.com/web_checkouts/v1/cart_views?cart_type=REGULAR&field_groups=ADDRESSES%2CCART%2CCART_ITEMS%2CFINANCE_PROVIDERS%2CPAYMENT_INSTRUCTIONS%2CPICKUP_INSTRUCTIONS%2CPROMOTION_CODES%2CSUMMARY&key=" + key + "&refresh=true", {
          credentials: "include", headers: {"Accept":"application/json"}
        }).then(function(r) { return r.json(); });
      },
      args: [CHECKOUT_KEY]
    });
    var cart = r1 && r1[0] && r1[0].result;
    var cartId = cart ? cart.cart_id : "";
    var cartItems = cart && cart.cart_items ? cart.cart_items : [];
    var payId = cart && cart.payment_instructions && cart.payment_instructions[0] ? cart.payment_instructions[0].payment_instruction_id : "";

    // If no payment, need to re-authenticate (ecom.med scope)
    if (!payId) {
      spLog("Checkout: no payment — need re-auth, loading checkout...", "warn");
      await chrome.tabs.update(tab.id, { url: "https://www.target.com/checkout" });
      await new Promise(function(r) { setTimeout(r, 3000); });

      // Check if login prompt appeared — click "Enter your password" and auto-fill
      try {
        var loginResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: function() {
            // Look for "Enter your password" button
            var buttons = document.querySelectorAll("button, a, div[role='button']");
            var clicked = false;
            for (var i = 0; i < buttons.length; i++) {
              var txt = buttons[i].textContent.toLowerCase();
              if (txt.indexOf("enter your password") !== -1 || txt.indexOf("password") !== -1) {
                buttons[i].click();
                clicked = true;
                break;
              }
            }
            return { clicked: clicked, url: window.location.href };
          }
        });
        var lr = loginResult && loginResult[0] && loginResult[0].result;
        if (lr && lr.clicked) {
          spLog("Checkout: password prompt detected, filling...", "system");
          await new Promise(function(r) { setTimeout(r, 2000); });

          // Get password from StockPulse server
          var savedPw = "";
          try {
            var pwRes = await fetch(BASE + "/api/target-password");
            var pwData = await pwRes.json();
            savedPw = pwData.password || "";
          } catch(e) {}

          var pwResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: function(serverPw) {
              var pw = document.querySelector("input[type='password']");
              if (!pw) return { filled: false, reason: "no password field" };
              
              // Use Chrome autofill value if available, otherwise use server password
              var password = pw.value || serverPw || "";
              if (!password) return { filled: false, reason: "no password available" };
              
              // Set the value using native setter to trigger React
              var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
              nativeSet.call(pw, password);
              pw.dispatchEvent(new Event("input", { bubbles: true }));
              pw.dispatchEvent(new Event("change", { bubbles: true }));
              
              // Find and click submit
              var btns = document.querySelectorAll("button");
              for (var i = 0; i < btns.length; i++) {
                var t = btns[i].textContent.toLowerCase();
                if (t.indexOf("sign in") !== -1 || t.indexOf("log in") !== -1 || t.indexOf("continue") !== -1) {
                  btns[i].click();
                  return { filled: true };
                }
              }
              // Try submit button
              var submit = document.querySelector("button[type='submit']");
              if (submit) { submit.click(); return { filled: true }; }
              return { filled: false, reason: "no submit button" };
            },
            args: [savedPw]
          });
          var pr = pwResult && pwResult[0] && pwResult[0].result;
          if (pr && pr.filled) {
            spLog("Checkout: password submitted, waiting for auth...", "system");
            await new Promise(function(r) { setTimeout(r, 4000); });
          } else {
            spLog("Checkout: couldn't auto-fill password — " + (pr ? pr.reason : "unknown"), "warn");
          }
        }
      } catch(e) {
        spLog("Checkout: login attempt error — " + e.message, "warn");
      }

      // Try getting payment again after re-auth
      var r1b = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function(key) {
          return fetch("https://carts.target.com/web_checkouts/v1/cart_views?cart_type=REGULAR&field_groups=ADDRESSES%2CCART%2CCART_ITEMS%2CFINANCE_PROVIDERS%2CPAYMENT_INSTRUCTIONS%2CPICKUP_INSTRUCTIONS%2CPROMOTION_CODES%2CSUMMARY&key=" + key + "&refresh=true", {
            credentials: "include", headers: {"Accept":"application/json"}
          }).then(function(r) { return r.json(); });
        },
        args: [CHECKOUT_KEY]
      });
      var cart2 = r1b && r1b[0] && r1b[0].result;
      if (cart2) {
        cartId = cart2.cart_id || cartId;
        cartItems = cart2.cart_items || cartItems;
        payId = cart2.payment_instructions && cart2.payment_instructions[0] ? cart2.payment_instructions[0].payment_instruction_id : "";
      }
      if (!payId) {
        spLog("Checkout: still no payment after re-auth — manual login needed", "error");
        return { success: false, error: "No payment method — log in manually at target.com/checkout" };
      }
    }

    spLog("Checkout: cart $" + (cart && cart.summary ? cart.summary.grand_total : "?") + " | " + cartItems.length + " items | payment: yes", "system");

    // Step 2: Set shipping fulfillment and address for each cart item
    // Get the default shipping address from the cart
    var shippingAddress = null;
    if (cart && cart.addresses) {
      // Prefer address with address_id and type BOTH or SHIPPING
      shippingAddress = cart.addresses.find(function(a) { return a.address_id && (a.address_type === "BOTH" || a.address_type === "SHIPPING"); });
      if (!shippingAddress) shippingAddress = cart.addresses.find(function(a) { return a.address_id; });
    }
    var addrId = shippingAddress ? shippingAddress.address_id : "";
    
    for (var ci = 0; ci < cartItems.length; ci++) {
      var item = cartItems[ci];
      var itemId = item.cart_item_id;
      if (itemId && addrId) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: function(itemId, addrId, key) {
            return fetch("https://carts.target.com/web_checkouts/v1/cart_item_fulfillment?key=" + key, {
              method: "PUT", credentials: "include",
              headers: {"Accept":"application/json","Content-Type":"application/json"},
              body: JSON.stringify({ cart_type: "REGULAR", cart_item_id: itemId, fulfillment_type: "SHIP", shipping_address_id: addrId })
            }).then(function(r) { return r.text().then(function(t) { return { ok: r.ok, status: r.status, body: t.substring(0, 200) }; }); });
          },
          args: [itemId, addrId, CHECKOUT_KEY]
        });
      }
    }
    if (cartItems.length > 0) spLog("Checkout: shipping set for " + cartItems.length + " item(s)" + (addrId ? " (addr: " + addrId.substring(0, 8) + ")" : " (NO ADDRESS!)"), "system");

    // Step 3: Set CVV if payment method exists
    if (payId && cvv) {
      var r3 = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function(payId, cvv, cartId, key) {
          return fetch("https://carts.target.com/checkout_payments/v1/payment_instructions/" + payId + "?key=" + key, {
            method: "PUT", credentials: "include",
            headers: {"Accept":"application/json","Content-Type":"application/json"},
            body: JSON.stringify({ card_details: { cvv: cvv }, cart_id: cartId, payment_type: "CARD", wallet_mode: "NONE" })
          }).then(function(r) { return { ok: r.ok, status: r.status }; });
        },
        args: [payId, cvv, cartId, CHECKOUT_KEY]
      });
      var cvvRes = r3 && r3[0] && r3[0].result;
      spLog("Checkout: CVV " + (cvvRes && cvvRes.ok ? "set OK" : "failed (" + (cvvRes ? cvvRes.status : "?") + ")"), cvvRes && cvvRes.ok ? "system" : "error");
    }

    spLog("Checkout: HAMMERING place order...", "system");

    // Step 4: Place order — hammer until success or terminal error
    var att = 0;
    var lastLogTime = Date.now();
    var cvvSet = !!payId;

    while (true) {
      att++;
      var r = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function(key) {
          return fetch("https://carts.target.com/web_checkouts/v1/checkout?field_groups=CART%2CCART_ITEMS%2CSUMMARY%2CPROMOTION_CODES%2CADDRESSES%2CPAYMENT_INSTRUCTIONS&key=" + key, {
            method: "POST", credentials: "include",
            headers: { "Accept": "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ cart_type: "REGULAR", channel_id: "90" })
          }).then(function(r) { return r.text().then(function(t) { return { ok: r.ok, status: r.status, body: t.substring(0, 500) }; }); });
        },
        args: [CHECKOUT_KEY]
      });
      var o = r && r[0] && r[0].result;

      // SUCCESS
      if (o && (o.ok || o.status === 200 || o.status === 201)) {
        if (o.body.indexOf("COMPLETED") !== -1 || o.body.indexOf("order_id") !== -1) {
          spLog("ORDER PLACED on attempt " + att + "!", "success");
          return { success: true, orderId: o.body.substring(0, 200), attempt: att };
        }
      }

      // Needs CVV — set it and retry
      if (o && o.body && o.body.indexOf("CVV") !== -1 && !cvvSet && cvv) {
        spLog("Checkout: setting CVV...", "system");
        // Get payment ID from cart_views
        var r2 = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: function(key) {
            return fetch("https://carts.target.com/web_checkouts/v1/cart_views?cart_type=REGULAR&field_groups=ADDRESSES%2CCART%2CCART_ITEMS%2CFINANCE_PROVIDERS%2CPAYMENT_INSTRUCTIONS%2CPICKUP_INSTRUCTIONS%2CPROMOTION_CODES%2CSUMMARY&key=" + key + "&refresh=true", {
              credentials: "include", headers: {"Accept":"application/json"}
            }).then(function(r) { return r.json(); });
          },
          args: [CHECKOUT_KEY]
        });
        var cart = r2 && r2[0] && r2[0].result;
        var cartId = cart ? cart.cart_id : "";
        var payId = cart && cart.payment_instructions && cart.payment_instructions[0] ? cart.payment_instructions[0].payment_instruction_id : "";
        
        if (payId) {
          spLog("Checkout: Payment " + payId.substring(0,8) + " Total: $" + (cart.summary ? cart.summary.grand_total : "?"), "system");
          var r3 = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: function(payId, cvv, cartId, key) {
              return fetch("https://carts.target.com/checkout_payments/v1/payment_instructions/" + payId + "?key=" + key, {
                method: "PUT", credentials: "include",
                headers: {"Accept":"application/json","Content-Type":"application/json"},
                body: JSON.stringify({ card_details: { cvv: cvv }, cart_id: cartId, payment_type: "CARD", wallet_mode: "NONE" })
              }).then(function(r) { return { ok: r.ok, status: r.status }; });
            },
            args: [payId, cvv, cartId, CHECKOUT_KEY]
          });
          var cvvRes = r3 && r3[0] && r3[0].result;
          if (cvvRes && cvvRes.ok) {
            spLog("Checkout: CVV set OK", "system");
            cvvSet = true;
          } else {
            spLog("Checkout: CVV failed (" + (cvvRes ? cvvRes.status : "?") + ")", "error");
          }
        } else {
          spLog("Checkout: No payment method found", "error");
          return { success: false, error: "No payment method" };
        }
        continue;
      }

      // Re-set CVV if it expired mid-hammering
      if (o && o.body && o.body.indexOf("CVV") !== -1 && cvvSet) {
        spLog("CVV expired, re-setting...", "warn");
        cvvSet = false;
        continue;
      }

      // Log every 5 seconds
      if (Date.now() - lastLogTime >= 5000) {
        var errSnippet = o && o.body ? o.body.substring(0, 150) : "";
        spLog("Checkout: hammering... attempt " + att + " (status: " + (o ? o.status : "?") + ") " + errSnippet, "warn");
        lastLogTime = Date.now();
      }

      // STOP conditions
      if (o && (o.status === 401 || o.status === 403)) {
        spLog("Checkout: auth failed (" + o.status + ")", "error");
        return { success: false, error: "Auth failed" };
      }
      // 400 = bad request — log the error and stop (not retryable)
      if (o && o.status === 400) {
        var errMsg = o.body ? o.body.substring(0, 200) : "unknown";
        spLog("Checkout FAILED (400): " + errMsg, "error");
        return { success: false, error: "400: " + errMsg };
      }
      if (o && o.body && (o.body.indexOf("EMPTY_CART") !== -1 || o.body.indexOf("does not have any cart items") !== -1)) {
        spLog("Checkout: cart empty — stopping", "error");
        return { success: false, error: "Cart empty" };
      }
      if (o && o.body && o.body.indexOf("out of stock") !== -1) {
        spLog("Checkout: OOS", "error");
        return { success: false, error: "Out of stock" };
      }

      // Every 100 attempts verify cart still has items
      if (att % 100 === 0) {
        try {
          var cc = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: function(key) {
              return fetch("https://carts.target.com/web_checkouts/v1/cart?field_groups=CART%2CCART_ITEMS%2CSUMMARY&key=" + key + "&cart_type=REGULAR", {
                credentials: "include", headers: {"Accept":"application/json"}
              }).then(function(r) { return r.json(); }).catch(function() { return null; });
            },
            args: [K_ATC]
          });
          var ccr = cc && cc[0] && cc[0].result;
          if (ccr && ccr.summary && ccr.summary.items_quantity === 0) {
            spLog("Checkout: cart empty after " + att + " attempts", "error");
            return { success: false, error: "Cart empty" };
          }
        } catch(e) {}
      }

      await new Promise(function(r) { setTimeout(r, 50); });
    }
  } catch(e) {
    spLog("Checkout error: " + e.message, "error");
    return { success: false, error: e.message };
  }
}

// ── SEQUENTIAL REQUEST PROCESSOR ───────────────────────────────
// Batches all pending ATCs, then checkouts once with everything in cart
var processing = false;
var lastAtcTabId = null;

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    // Phase 1: Process ALL pending ATCs
    var atcCount = 0;
    var lastTab = null;
    
    while (true) {
      var res = await fetch(BASE + "/api/browser-atc/pending");
      var p = await res.json();
      if (!p || !p.sku) break; // No more ATCs queued
      
      atcCount++;
      spLog("ATC #" + atcCount + ": " + p.sku + " x" + p.qty, "system");
      chrome.action.setBadgeText({ text: "ATC" + atcCount }); chrome.action.setBadgeBackgroundColor({ color: "#ff8800" });
      
      var result = await executeAtc(p.sku, p.qty);
      await fetch(BASE + "/api/browser-atc/result", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(result) });
      
      if (result.success && result.tabId) lastTab = result.tabId;
      
      // Brief pause to let server queue more ATCs from rapid-fire Discord alerts
      await new Promise(function(r) { setTimeout(r, 500); });
    }
    
    if (atcCount === 0) {
      // Check for standalone checkout
      var cres = await fetch(BASE + "/api/browser-checkout/pending");
      var cp = await cres.json();
      if (cp && cp.cvv) {
        spLog("Standalone checkout request", "system");
        chrome.action.setBadgeText({ text: "CO" }); chrome.action.setBadgeBackgroundColor({ color: "#ff8800" });
        var coResult = await executeCheckout(cp.cvv, lastAtcTabId);
        await fetch(BASE + "/api/browser-checkout/result", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(coResult) });
        chrome.action.setBadgeText({ text: coResult.success ? "$$" : "!" });
        chrome.action.setBadgeBackgroundColor({ color: coResult.success ? "#00cc66" : "#ff4444" });
        setTimeout(function() { chrome.action.setBadgeText({ text: "✓" }); chrome.action.setBadgeBackgroundColor({ color: "#00cc66" }); }, 5000);
      }
      processing = false;
      return;
    }

    // Phase 2: All ATCs done — wait for checkout to be queued
    spLog("All " + atcCount + " ATC(s) processed — waiting for checkout...", "system");
    await new Promise(function(r) { setTimeout(r, 1500); });
    
    var cres2 = await fetch(BASE + "/api/browser-checkout/pending");
    var cp2 = await cres2.json();
    if (cp2 && cp2.cvv) {
      spLog("Checkout: all items in cart, checking out...", "system");
      chrome.action.setBadgeText({ text: "CO" }); chrome.action.setBadgeBackgroundColor({ color: "#ff8800" });
      lastAtcTabId = lastTab;
      var coResult2 = await executeCheckout(cp2.cvv, lastTab);
      await fetch(BASE + "/api/browser-checkout/result", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(coResult2) });
      chrome.action.setBadgeText({ text: coResult2.success ? "$$" : "!" });
      chrome.action.setBadgeBackgroundColor({ color: coResult2.success ? "#00cc66" : "#ff4444" });
    }
    setTimeout(function() { chrome.action.setBadgeText({ text: "✓" }); chrome.action.setBadgeBackgroundColor({ color: "#00cc66" }); }, 5000);
  } catch(e) {
    spLog("Queue processor error: " + e.message, "error");
  }
  processing = false;
}

setInterval(processQueue, 1000);

// ── SESSION KEEPALIVE ───────────────────────────────────────────
// Every 30 min: refresh PX + re-auth to maintain ecom.med scope
// This ensures instant checkout when a drop happens
var lastAuthTime = 0;

async function keepSessionAlive() {
  if (processing) return;
  try {
    var tab = null;
    var tabs = await chrome.tabs.query({ url: "https://www.target.com/*" });
    for (var i = 0; i < tabs.length; i++) {
      var u = tabs[i].url || "";
      if (u.indexOf("/login") === -1 && u.indexOf("account") === -1) { tab = tabs[i]; break; }
    }
    if (!tab) return;

    // PX refresh — reload tab every 5 min
    chrome.tabs.reload(tab.id);

    // Auth refresh — visit checkout every 30 min to keep ecom.med
    if (Date.now() - lastAuthTime > 1800000) { // 30 min
      await new Promise(function(r) { setTimeout(r, 3000); }); // wait for reload

      // Navigate to checkout to check auth status
      await chrome.tabs.update(tab.id, { url: "https://www.target.com/checkout" });
      await new Promise(function(r) { setTimeout(r, 3000); });

      // Check if login prompt appeared
      var authCheck = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function() {
          var buttons = document.querySelectorAll("button, a, div[role='button']");
          for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.toLowerCase().indexOf("enter your password") !== -1) {
              buttons[i].click();
              return "clicked_password";
            }
          }
          // Check if we're on checkout page (no login needed)
          if (document.querySelector("[data-test='placeOrderButton']") || document.body.innerText.indexOf("Order summary") !== -1) {
            return "already_authed";
          }
          return "unknown";
        }
      });
      var status = authCheck && authCheck[0] && authCheck[0].result;

      if (status === "clicked_password") {
        await new Promise(function(r) { setTimeout(r, 2000); });
        // Get password from server
        var kaPw = "";
        try { var kpRes = await fetch(BASE + "/api/target-password"); var kpd = await kpRes.json(); kaPw = kpd.password || ""; } catch(e) {}
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: function(serverPw) {
            var pw = document.querySelector("input[type='password']");
            if (pw) {
              var password = pw.value || serverPw || "";
              if (password) {
                var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                nativeSet.call(pw, password);
                pw.dispatchEvent(new Event("input", { bubbles: true }));
                pw.dispatchEvent(new Event("change", { bubbles: true }));
                var btns = document.querySelectorAll("button");
                for (var i = 0; i < btns.length; i++) {
                  var t = btns[i].textContent.toLowerCase();
                  if (t.indexOf("sign in") !== -1 || t.indexOf("log in") !== -1 || t.indexOf("continue") !== -1) { btns[i].click(); break; }
                }
              }
            }
          },
          args: [kaPw]
        });
        await new Promise(function(r) { setTimeout(r, 3000); });
        spLog("Session keepalive: re-authenticated", "system");
      } else if (status === "already_authed") {
        spLog("Session keepalive: already at ecom.med", "system");
      }

      lastAuthTime = Date.now();

      // Navigate back to homepage
      await chrome.tabs.update(tab.id, { url: "https://www.target.com" });
    }
  } catch(e) {}
}

// PX refresh every 5 min, auth check every 30 min
setInterval(keepSessionAlive, 300000);
