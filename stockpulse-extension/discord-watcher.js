// StockPulse Discord Watcher
// Runs on discord.com — watches for new stock alert messages
// No API calls, no user token — just reads what's on screen

(function() {
  var BASE = "http://localhost:3069";
  var WATCH_CHANNEL_ID = "1387155900535541770"; // PokeNotify Target 10+
  var seenMessages = new Set();
  var initialized = false;

  function log(msg) {
    console.log("[StockPulse Discord] " + msg);
  }

  // Check if we're on the right channel
  function isTargetChannel() {
    return window.location.href.indexOf(WATCH_CHANNEL_ID) !== -1;
  }

  // Extract TCIN from message text
  function extractTcins(text) {
    var tcins = [];
    // Match "Tcin XXXXXXXX" or "TcinXXXXXXXX"
    var tcinMatch = text.match(/[Tt]cin[:\s]*(\d{7,10})/g);
    if (tcinMatch) {
      tcinMatch.forEach(function(m) {
        var num = m.match(/(\d{7,10})/);
        if (num) tcins.push(num[1]);
      });
    }
    // Match A-XXXXXXXX
    var aMatch = text.match(/A-(\d{7,10})/g);
    if (aMatch) {
      aMatch.forEach(function(m) {
        var num = m.match(/(\d{7,10})/);
        if (num && tcins.indexOf(num[1]) === -1) tcins.push(num[1]);
      });
    }
    // Match standalone 7-10 digit numbers (potential TCINs)
    var numMatch = text.match(/\b(\d{7,10})\b/g);
    if (numMatch) {
      numMatch.forEach(function(n) {
        if (tcins.indexOf(n) === -1) tcins.push(n);
      });
    }
    return tcins;
  }

  // Send alert to StockPulse — can send product name for matching if no TCIN
  function sendAlert(messageText, tcins, productName, messageId) {
    var payload = {
      source: "discord-watcher",
      channel: WATCH_CHANNEL_ID,
      message: messageText.substring(0, 500),
      tcins: tcins,
      productName: productName || "",
      messageId: messageId,
      timestamp: new Date().toISOString()
    };

    fetch(BASE + "/api/discord-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function(r) {
      if (r.ok) log("Alert sent: " + (tcins.length ? tcins.join(", ") : "name match: " + productName));
      else log("Alert send failed: " + r.status);
    }).catch(function(e) {
      log("Alert send error: " + e.message);
    });
  }

  // Scan visible messages for new stock alerts
  function scanMessages() {
    if (!isTargetChannel()) return;

    var messageEls = document.querySelectorAll('[class*="messageListItem"], [id^="chat-messages-"]');
    if (!messageEls.length) {
      messageEls = document.querySelectorAll('[class*="message_"][class*="cozy_"]');
    }

    messageEls.forEach(function(el) {
      var msgId = el.id || el.getAttribute("data-list-item-id") || "";
      if (!msgId) {
        var txt = el.textContent || "";
        msgId = "hash_" + hashCode(txt.substring(0, 100));
      }

      if (seenMessages.has(msgId)) return;
      seenMessages.add(msgId);
      if (!initialized) return;

      var text = el.textContent || "";
      if (!text.trim()) return;

      // Check for stock-related keywords
      var isStockAlert = /restock|in.?stock|target 10\+|target restocks|pokémon|pokemon/i.test(text);
      if (!isStockAlert) return;

      // Try to extract TCINs from full text + embeds + links
      var tcins = extractTcins(text);
      
      // Scan embed field values (Discord uses embedFieldValue__XXXXX class)
      var embedValues = el.querySelectorAll('[class*="embedFieldValue"]');
      embedValues.forEach(function(fv) {
        var ft = fv.textContent.trim();
        var nums = ft.match(/\b(\d{7,10})\b/g);
        if (nums) {
          nums.forEach(function(n) {
            if (tcins.indexOf(n) === -1) tcins.push(n);
          });
        }
      });

      // Also check all links in the message for target.com URLs
      var links = el.querySelectorAll('a[href]');
      links.forEach(function(a) {
        var href = a.href || "";
        var m = href.match(/A-(\d{7,10})/);
        if (m && tcins.indexOf(m[1]) === -1) tcins.push(m[1]);
      });

      // Extract product name from message
      var productName = "";
      var nameMatch = text.match(/(?:Pokémon|Pokemon)[\s\S]*?(?:Collection|Box|Bundle|Blister|Tin|Pack|Display|Binder)/i);
      if (nameMatch) {
        productName = nameMatch[0]
          .replace(/^.*?(Pokémon|Pokemon)/i, "$1")
          .replace(/\s+/g, " ")
          .trim();
      }

      // Filter out noise — only keep 8+ digit numbers as potential TCINs
      tcins = tcins.filter(function(t) { return t.length >= 8; });

      if (tcins.length > 0 || productName) {
        log("New alert! TCINs: [" + tcins.join(", ") + "] Name: " + (productName || "none"));
        sendAlert(text, tcins, productName, msgId);
      }
    });
  }
    });
  }

  function hashCode(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      var chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  // Watch for DOM changes (new messages appearing)
  function startWatching() {
    // Initial scan to mark existing messages
    scanMessages();
    initialized = true;
    log("Watching channel " + WATCH_CHANNEL_ID + " for stock alerts...");

    // MutationObserver — fires when new messages are added to the chat
    var chatContainer = document.querySelector('[class*="scrollerInner"], [class*="scroller_"], [data-list-id="chat-messages"]');
    
    if (!chatContainer) {
      // Try finding it after a delay
      setTimeout(function() {
        chatContainer = document.querySelector('[class*="scrollerInner"], [class*="scroller_"], [data-list-id="chat-messages"]');
        if (chatContainer) {
          observeChat(chatContainer);
        } else {
          // Fallback: poll every 2 seconds
          log("No chat container found — using polling fallback");
          setInterval(scanMessages, 2000);
        }
      }, 3000);
      return;
    }

    observeChat(chatContainer);
  }

  function observeChat(container) {
    var observer = new MutationObserver(function(mutations) {
      // Debounce — Discord adds multiple nodes at once
      clearTimeout(window._spScanTimer);
      window._spScanTimer = setTimeout(scanMessages, 300);
    });

    observer.observe(container, {
      childList: true,
      subtree: true
    });

    log("MutationObserver attached — watching for new messages");
    
    // Also poll every 5s as backup (in case MutationObserver misses something)
    setInterval(scanMessages, 5000);
  }

  // Handle Discord's SPA navigation (channel switches)
  var lastUrl = window.location.href;
  setInterval(function() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      if (isTargetChannel()) {
        log("Navigated to target channel — reinitializing...");
        seenMessages.clear();
        initialized = false;
        setTimeout(startWatching, 2000);
      } else {
        log("Left target channel");
      }
    }
  }, 1000);

  // Start after page loads
  if (isTargetChannel()) {
    // Wait for Discord to finish rendering
    setTimeout(startWatching, 3000);
  } else {
    log("Not on target channel — waiting for navigation...");
  }
})();
