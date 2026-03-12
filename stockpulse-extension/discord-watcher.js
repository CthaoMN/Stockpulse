// StockPulse Discord Watcher
// Runs on discord.com — watches for new stock alert messages
// No API calls, no user token — just reads what's on screen

(function() {
  var WATCH_CHANNEL_ID = "1387155900535541770";
  var seenMessages = new Set();
  var initialized = false;

  function log(msg) {
    console.log("[StockPulse Discord] " + msg);
  }

  function isTargetChannel() {
    return window.location.href.indexOf(WATCH_CHANNEL_ID) !== -1;
  }

  function extractTcins(text) {
    var tcins = [];
    var tcinMatch = text.match(/[Tt]cin[:\s]*(\d{7,10})/g);
    if (tcinMatch) {
      tcinMatch.forEach(function(m) {
        var num = m.match(/(\d{7,10})/);
        if (num) tcins.push(num[1]);
      });
    }
    var aMatch = text.match(/A-(\d{7,10})/g);
    if (aMatch) {
      aMatch.forEach(function(m) {
        var num = m.match(/(\d{7,10})/);
        if (num && tcins.indexOf(num[1]) === -1) tcins.push(num[1]);
      });
    }
    return tcins;
  }

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
    chrome.runtime.sendMessage({ type: "discord-alert", payload: payload }, function(response) {
      if (response && response.ok) {
        log("Alert sent: " + (tcins.length ? tcins.join(", ") : "name: " + productName));
      } else {
        log("Alert failed: " + JSON.stringify(response));
      }
    });
  }

  function hashCode(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  function scanMessages() {
    if (!isTargetChannel()) return;

    var messageEls = document.querySelectorAll('[class*="messageListItem"], [id^="chat-messages-"]');
    if (!messageEls.length) {
      messageEls = document.querySelectorAll('[class*="message_"][class*="cozy_"]');
    }

    messageEls.forEach(function(el) {
      var msgId = el.id || el.getAttribute("data-list-item-id") || "";
      if (!msgId) {
        msgId = "hash_" + hashCode((el.textContent || "").substring(0, 100));
      }

      if (seenMessages.has(msgId)) return;
      seenMessages.add(msgId);
      if (!initialized) return;

      var text = el.textContent || "";
      if (!text.trim()) return;

      if (!/restock|in.?stock|target 10\+|target restocks|pokémon|pokemon/i.test(text)) return;

      // Extract TCINs from text
      var tcins = extractTcins(text);

      // Scan embed field values (class: embedFieldValue__XXXXX)
      var embedValues = el.querySelectorAll('[class*="embedFieldValue"]');
      embedValues.forEach(function(fv) {
        var nums = (fv.textContent || "").match(/\b(\d{7,10})\b/g);
        if (nums) {
          nums.forEach(function(n) {
            if (tcins.indexOf(n) === -1) tcins.push(n);
          });
        }
      });

      // Check links for target.com URLs
      var links = el.querySelectorAll('a[href]');
      links.forEach(function(a) {
        var m = (a.href || "").match(/A-(\d{7,10})/);
        if (m && tcins.indexOf(m[1]) === -1) tcins.push(m[1]);
      });

      // Extract product name
      var productName = "";
      var nameMatch = text.match(/(?:Pokémon|Pokemon)[\s\S]*?(?:Collection|Box|Bundle|Blister|Tin|Pack|Display|Binder)/i);
      if (nameMatch) {
        productName = nameMatch[0].replace(/^.*?(Pokémon|Pokemon)/i, "$1").replace(/\s+/g, " ").trim();
      }

      // Only keep 8+ digit TCINs
      tcins = tcins.filter(function(t) { return t.length >= 8; });

      if (tcins.length > 0 || productName) {
        log("New alert! TCINs: [" + tcins.join(", ") + "] Name: " + (productName || "none"));
        sendAlert(text, tcins, productName, msgId);
      }
    });
  }

  function observeChat(container) {
    var observer = new MutationObserver(function() {
      clearTimeout(window._spScanTimer);
      window._spScanTimer = setTimeout(scanMessages, 300);
    });
    observer.observe(container, { childList: true, subtree: true });
    log("MutationObserver attached — watching for new messages");
    setInterval(scanMessages, 5000);
  }

  function startWatching() {
    scanMessages();
    initialized = true;
    log("Watching channel " + WATCH_CHANNEL_ID);

    var chatContainer = document.querySelector('[class*="scrollerInner"], [data-list-id="chat-messages"]');
    if (chatContainer) {
      observeChat(chatContainer);
    } else {
      setTimeout(function() {
        chatContainer = document.querySelector('[class*="scrollerInner"], [data-list-id="chat-messages"]');
        if (chatContainer) {
          observeChat(chatContainer);
        } else {
          log("No chat container — polling every 2s");
          setInterval(scanMessages, 2000);
        }
      }, 3000);
    }
  }

  // Handle Discord SPA navigation
  var lastUrl = window.location.href;
  setInterval(function() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      if (isTargetChannel()) {
        log("Navigated to target channel");
        seenMessages.clear();
        initialized = false;
        setTimeout(startWatching, 2000);
      }
    }
  }, 1000);

  if (isTargetChannel()) {
    setTimeout(startWatching, 3000);
  } else {
    log("Not on target channel — waiting...");
  }
})();
