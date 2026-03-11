function update() {
  chrome.runtime.sendMessage({ action: "status" }, function(s) {
    if (!s) {
      document.getElementById("statusBox").className = "status-box status-warn";
      document.getElementById("statusBox").textContent = "Extension loading...";
      return;
    }
    var atEl = document.getElementById("atStatus");
    var rtEl = document.getElementById("rtStatus");
    var expEl = document.getElementById("expiry");
    var countEl = document.getElementById("count");
    var box = document.getElementById("statusBox");

    atEl.textContent = s.hasAccessToken ? "Found" : "Missing";
    atEl.className = "val " + (s.hasAccessToken ? "ok" : "err");

    rtEl.textContent = s.hasRefreshToken ? "Found" : "Missing";
    rtEl.className = "val " + (s.hasRefreshToken ? "ok" : "warn");

    if (s.tokenMinutesLeft !== null) {
      expEl.textContent = s.tokenMinutesLeft + " min";
      expEl.className = "val " + (s.tokenMinutesLeft > 30 ? "ok" : s.tokenMinutesLeft > 0 ? "warn" : "err");
    } else {
      expEl.textContent = "N/A";
      expEl.className = "val warn";
    }

    countEl.textContent = s.cookieCount + " cookies";
    countEl.className = "val ok";

    fetch("http://localhost:3069/api/state").then(function(r) { return r.json(); }).then(function(state) {
      var spEl = document.getElementById("spStatus");
      if (state.harvester === "ready") {
        spEl.textContent = "Connected";
        spEl.className = "val ok";
        box.className = "status-box status-ok";
        box.textContent = "Connected & Syncing";
      } else {
        spEl.textContent = state.harvester || "not ready";
        spEl.className = "val warn";
        box.className = "status-box status-warn";
        box.textContent = "StockPulse: " + (state.harvester || "?");
      }
    }).catch(function() {
      var spEl = document.getElementById("spStatus");
      spEl.textContent = "Not running";
      spEl.className = "val err";
      box.className = "status-box status-err";
      box.textContent = "StockPulse server not running";
    });
  });
}

document.getElementById("syncBtn").addEventListener("click", function() {
  document.getElementById("statusBox").textContent = "Syncing...";
  chrome.runtime.sendMessage({ action: "sync" }, function() {
    setTimeout(update, 2000);
  });
});

update();
