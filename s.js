(function () {
  "use strict";

  var VERSION     = "2.0.0";
  var PLUGIN_NAME = "Смайлики рейтинга";
  var PLUGIN_ID   = "smile-reactions";

  // Prevent double-loading the same version.
  if (window.__smileReactionsPluginVersion === VERSION) return;
  window.__smileReactionsPluginVersion = VERSION;

  // URLs this plugin is served from (used to identify our entry in the
  // plugins list when document.currentScript is unavailable — async scripts).
  var PLUGIN_URLS = [
    "https://mrkvka.github.io/s.js",
    "http://mrkvka.github.io/s.js"
  ];

  var manifest = {
    type:        "other",
    version:     VERSION,
    name:        PLUGIN_NAME,
    description: "Добавляет смайлики с реакциями на постеры в лентах, категориях и поиске.",
    component:   "smile_reactions"
  };

  var LAYOUT = {
    leftRatio:      0.03,
    gapToVoteRatio: 0.022,
    gapRatio:       0.014,
    heightRatio:    1.25,
    fontRatio:      0.9,
    fontFitDivisor: 9.0,
    minFont:        12,
    compactWidth:   100,
    tightWidth:     76,
    iconsWidth:     56
  };

  var REACTION_ITEMS = [
    { type: "fire", icon: "\uD83D\uDD25", label: "Огонь",    min: 180, max: 560 },
    { type: "nice", icon: "\uD83D\uDC4D", label: "Нравится", min: 55,  max: 190 },
    { type: "shit", icon: "\uD83D\uDCA9", label: "Так себе", min: 12,  max: 88  }
  ];

  var observerStarted = false;
  var manifestReady   = false;
  var resizeBound     = false;

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function hash(value) {
    var result = 2166136261;
    for (var i = 0; i < value.length; i++) {
      result ^= value.charCodeAt(i);
      result += (result << 1) + (result << 4) + (result << 7) + (result << 8) + (result << 24);
    }
    return result >>> 0;
  }

  function numberShort(value) {
    if (window.Lampa && Lampa.Utils && Lampa.Utils.bigNumberToShort) {
      return Lampa.Utils.bigNumberToShort(value);
    }
    return value > 999 ? Math.round(value / 100) / 10 + "K" : String(value);
  }

  function protocol() {
    if (window.Lampa && Lampa.Utils && Lampa.Utils.protocol) {
      return Lampa.Utils.protocol();
    }
    return location.protocol === "https:" ? "https://" : "http://";
  }

  function cubDomain() {
    var saved = "";
    try { saved = localStorage.getItem("cub_domain") || ""; } catch (e) {}
    if (saved) return saved;
    if (window.Lampa && Lampa.Manifest && Lampa.Manifest.cub_domain) return Lampa.Manifest.cub_domain;
    if (window.lampa_settings && window.lampa_settings.cub_domain) return window.lampa_settings.cub_domain;
    return "cub.watch";
  }

  // ---------------------------------------------------------------------------
  // Reaction icons
  // ---------------------------------------------------------------------------

  function existingReactionIcon(type) {
    var icon = document.querySelector(".reaction--" + type + " .reaction__icon");
    return icon && icon.getAttribute("src");
  }

  function reactionIconUrl(type) {
    return existingReactionIcon(type) || protocol() + cubDomain() + "/img/reactions/" + type + ".svg";
  }

  function loadReactionIcon(img, item) {
    var failed = false;
    var show = function () { img.style.opacity = "1"; };
    var fallback = function () {
      if (failed) return;
      failed = true;
      if (img.parentNode) img.parentNode.replaceChild(document.createTextNode(item.icon), img);
    };

    img.alt = item.label;
    img.src = reactionIconUrl(item.type);
    img.style.opacity = "0";

    if (window.Lampa && Lampa.Utils && Lampa.Utils.imgLoad) {
      Lampa.Utils.imgLoad(img, img.src, show, fallback);
      return;
    }

    img.onload  = show;
    img.onerror = fallback;
  }

  // ---------------------------------------------------------------------------
  // Reaction counts — real CUB data with hash fallback
  // ---------------------------------------------------------------------------

  // In-session cache: cubId → {fire, nice, shit}
  var _cache = {};
  // In-flight guard: cubId → true
  var _fetching = {};

  // Build the CUB card identifier used by the reactions API.
  // Mirrors what Lampa does in cub.js: reactionsGet uses method + '_' + id.
  // TV shows have data.name in the original object; movies have data.title.
  function cubCardId(data) {
    if (!data || !data.id) return null;
    var method = (data.name !== undefined) ? "tv" : "movie";
    return method + "_" + data.id;
  }

  // Pseudo-random fallback (used while fetching or when API is unavailable).
  function hashCount(key, item) {
    return item.min + hash(key + ":" + item.type) % (item.max - item.min + 1);
  }

  function hashCounts(key) {
    return REACTION_ITEMS.map(function (item) {
      return { item: item, count: hashCount(key, item) };
    }).sort(function (a, b) { return b.count - a.count; });
  }

  // Fetch real CUB reaction counts and cache them.
  // On success, updates all rendered holders with this cubId in the DOM.
  function fetchCubReactions(cubId) {
    if (_cache[cubId] || _fetching[cubId]) return;
    _fetching[cubId] = true;

    var url = protocol() + cubDomain() + "/api/reactions/get/" + cubId;

    // Use Lampa.Reguest if available (handles mirrors + timeout), else XHR.
    function onSuccess(data) {
      delete _fetching[cubId];
      if (!data || !data.secuses || !Array.isArray(data.result)) return;

      var counts = {};
      data.result.forEach(function (r) { counts[r.type] = r.counter || 0; });
      _cache[cubId] = counts;

      applyRealCounts(cubId, counts);
    }

    function onError() { delete _fetching[cubId]; }

    if (window.Lampa && Lampa.Reguest) {
      var net = new Lampa.Reguest();
      net.timeout(5000);
      net.silent(url, onSuccess, onError);
    } else {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.timeout = 5000;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status === 200) {
          try { onSuccess(JSON.parse(xhr.responseText)); } catch (e) { onError(); }
        } else {
          onError();
        }
      };
      xhr.send();
    }
  }

  // Update count text in all reaction holders tagged with this cubId.
  function applyRealCounts(cubId, counts) {
    var sel = ".card__smile-reactions[data-cub-id='" + cubId + "']";
    var holders = document.querySelectorAll(sel);
    for (var i = 0; i < holders.length; i++) {
      var chips = holders[i].querySelectorAll(".card__smile-reaction");
      for (var j = 0; j < chips.length; j++) {
        var m = chips[j].className.match(/card__smile-reaction--(\w+)/);
        if (!m) continue;
        var t = m[1];
        var val = counts[t];
        if (val === undefined) continue;
        var countEl = chips[j].querySelector(".card__smile-reaction-count");
        if (countEl) countEl.textContent = numberShort(val);
      }
    }
  }

  // Resolve top-3 reactions to display.
  // Uses real CUB counts if cached; falls back to hash-based placeholder.
  function resolvedItems(cubId, fallbackKey) {
    var cached = cubId ? _cache[cubId] : null;

    if (cached) {
      // Pick top-3 from our known reaction types by real count.
      return REACTION_ITEMS.map(function (item) {
        return { item: item, count: cached[item.type] || 0 };
      }).sort(function (a, b) { return b.count - a.count; });
    }

    return hashCounts(fallbackKey);
  }

  // ---------------------------------------------------------------------------
  // Card rendering
  // ---------------------------------------------------------------------------

  // Fallback hash key when card_data is unavailable.
  function gridCardFallbackKey(card) {
    var title = card.querySelector(".card__title");
    return title ? title.textContent.trim() : "";
  }

  function injectStyles() {
    var style = document.getElementById(PLUGIN_ID + "-style");

    if (!style) {
      style = document.createElement("style");
      style.id = PLUGIN_ID + "-style";
      document.head.appendChild(style);
    } else if (style.dataset.version === VERSION) {
      return;
    }

    style.dataset.version = VERSION;
    style.textContent = [
      ".card__smile-reactions{box-sizing:border-box;position:absolute;left:var(--sr-left,.4em);bottom:var(--sr-bottom,.4em);height:var(--sr-height,2.2em);z-index:2;display:flex;align-items:center;justify-content:space-evenly;gap:var(--sr-gap,.18em);padding:0 var(--sr-pad,.38em);border-radius:999px;background:rgba(0,0,0,.68);box-shadow:0 .12em .6em rgba(0,0,0,.38);overflow:hidden;pointer-events:none;color:#fff;font-size:var(--sr-font,1.2em);font-weight:700;line-height:normal;}",
      ".card__smile-reaction{box-sizing:border-box;min-width:0;flex:0 1 auto;padding:0;display:flex;align-items:center;justify-content:center;gap:var(--sr-inner-gap,.1em);white-space:nowrap;line-height:normal;}",
      ".card__smile-reaction-emoji{width:1.05em;height:1.05em;line-height:normal;display:block;flex:0 0 auto;object-fit:contain;transition:opacity .15s;}",
      ".card__smile-reaction-count{font-size:.82em;line-height:normal;display:block;min-width:0;overflow:hidden;text-overflow:clip;}",
      ".card__smile-reactions.is--compact .card__smile-reaction:nth-child(3) .card__smile-reaction-count{display:none;}",
      ".card__smile-reactions.is--tight .card__smile-reaction:nth-child(n+2) .card__smile-reaction-count{display:none;}",
      ".card__smile-reactions.is--icons .card__smile-reaction-count{display:none;}"
    ].join("");
  }

  function syncGridLayout(view, vote, holder) {
    var viewRect = view.getBoundingClientRect();
    var voteRect = vote.getBoundingClientRect();

    if (!viewRect.width || !voteRect.width) return;

    var left      = Math.max(4,  Math.round(viewRect.width * LAYOUT.leftRatio));
    var gapToVote = Math.max(4,  Math.round(viewRect.width * LAYOUT.gapToVoteRatio));
    var gap       = Math.max(2,  Math.round(viewRect.width * LAYOUT.gapRatio));
    var right     = Math.max(0,  Math.round(viewRect.right - voteRect.left + gapToVote));
    var available = Math.max(0,  Math.round(viewRect.width - left - right));
    var voteH     = Math.max(1,  voteRect.height);
    var height    = Math.max(14, Math.round(voteH * LAYOUT.heightRatio));
    var bottom    = Math.max(0,  Math.round(viewRect.bottom - (voteRect.top + voteH / 2) - height / 2));
    var voteFont  = parseFloat(getComputedStyle(vote).fontSize) || 20;
    var font      = Math.max(LAYOUT.minFont, Math.min(voteFont * LAYOUT.fontRatio, available / LAYOUT.fontFitDivisor));
    var pad       = Math.max(4, Math.min(12, available / 26));

    holder.classList.toggle("is--compact", available < LAYOUT.compactWidth);
    holder.classList.toggle("is--tight",   available < LAYOUT.tightWidth);
    holder.classList.toggle("is--icons",   available < LAYOUT.iconsWidth);

    holder.style.setProperty("--sr-left",      left   + "px");
    holder.style.setProperty("--sr-bottom",    bottom + "px");
    holder.style.setProperty("--sr-height",    height + "px");
    holder.style.setProperty("--sr-gap",       gap    + "px");
    holder.style.setProperty("--sr-pad",       pad    + "px");
    holder.style.setProperty("--sr-inner-gap", Math.max(1, Math.round(gap * 0.7)) + "px");
    holder.style.setProperty("--sr-font",      font   + "px");
    holder.style.right = right + "px";
  }

  function renderGridCard(card) {
    var view  = card.querySelector(".card__view");
    var vote  = card.querySelector(".card__vote");
    var title = card.querySelector(".card__title");

    // Wide-style cards (detail view header) have .card__title removed by Lampa.
    // Skip them — plugin only targets feed/list cards.
    if (!view || !vote || !title) return;

    var data    = card.card_data || null;
    var cubId   = cubCardId(data);
    var fbKey   = cubId || gridCardFallbackKey(card);
    var items   = resolvedItems(cubId, fbKey);

    var holder = view.querySelector(".card__smile-reactions");
    var alreadyRendered = holder &&
      holder.dataset.smileReactionsVersion === VERSION &&
      holder.dataset.smileCubId            === (cubId || "") &&
      holder.dataset.smileKey              === fbKey &&
      holder.querySelectorAll(".card__smile-reaction").length === items.length;

    if (!holder) {
      holder = document.createElement("div");
      holder.className = "card__smile-reactions";
      view.appendChild(holder);
    }

    syncGridLayout(view, vote, holder);

    if (alreadyRendered) return;

    holder.dataset.smileReactionsVersion = VERSION;
    holder.dataset.smileCubId            = cubId || "";
    holder.dataset.smileKey              = fbKey;
    if (cubId) holder.setAttribute("data-cub-id", cubId);

    holder.innerHTML = "";

    items.forEach(function (record) {
      var item  = record.item;
      var chip  = document.createElement("div");
      var icon  = document.createElement("img");
      var count = document.createElement("span");

      chip.className = "card__smile-reaction card__smile-reaction--" + item.type;
      chip.setAttribute("title", item.label + ": " + record.count);

      icon.className = "card__smile-reaction-emoji";
      loadReactionIcon(icon, item);

      count.className   = "card__smile-reaction-count";
      count.textContent = numberShort(record.count);

      chip.appendChild(icon);
      chip.appendChild(count);
      holder.appendChild(chip);
    });

    // Kick off real CUB fetch if not already cached.
    // When it completes, applyRealCounts() updates the DOM in-place.
    if (cubId && !_cache[cubId]) fetchCubReactions(cubId);
  }

  // ---------------------------------------------------------------------------
  // Plugin card name patch (Extensions screen)
  // ---------------------------------------------------------------------------

  // Lampa shows the plugin card name from the stored plugins array entry.
  // We patch both:
  //   1. Lampa.Plugins._loaded (in-memory) via .get() references
  //   2. localStorage directly as a persistent fallback
  // This runs once on boot.
  function updatePluginEntry() {
    if (!window.Lampa) return;

    try {
      var patched = false;

      if (Lampa.Plugins && typeof Lampa.Plugins.get === "function") {
        Lampa.Plugins.get().forEach(function (plug) {
          if (typeof plug !== "object") return;
          var base = (plug.url || "").split("?")[0];
          if (PLUGIN_URLS.indexOf(base) === -1) return;
          plug.name   = PLUGIN_NAME;
          plug.author = "@mrkvka";
          plug.descr  = "Реакции \uD83D\uDD25\uD83D\uDC4D\uD83D\uDCA9 на постерах. v" + VERSION;
          patched = true;
        });
        if (patched && typeof Lampa.Plugins.save === "function") Lampa.Plugins.save();
      }

      // Also write to localStorage so the name persists across restarts
      // and covers Lampa builds that don't expose Lampa.Plugins.
      var stored;
      try { stored = JSON.parse(localStorage.getItem("plugins") || "[]"); } catch (e) { stored = []; }

      if (Array.isArray(stored)) {
        var lsPatched = false;
        stored.forEach(function (plug) {
          if (typeof plug !== "object") return;
          var base = (plug.url || "").split("?")[0];
          if (PLUGIN_URLS.indexOf(base) === -1) return;
          plug.name   = PLUGIN_NAME;
          plug.author = "@mrkvka";
          plug.descr  = "Реакции \uD83D\uDD25\uD83D\uDC4D\uD83D\uDCA9 на постерах. v" + VERSION;
          lsPatched = true;
        });
        if (lsPatched) {
          try { localStorage.setItem("plugins", JSON.stringify(stored)); } catch (e) {}
        }
      }
    } catch (e) {}
  }

  // Direct DOM patch for the Extensions screen — fires via MutationObserver
  // whenever .extensions__item cards appear in the DOM.
  // Identifies our card by matching the URL shown in the descr element.
  function patchExtensionsDom() {
    var items = document.querySelectorAll(".extensions__item:not([data-smile-patched])");
    if (!items.length) return;

    for (var i = 0; i < items.length; i++) {
      var item     = items[i];
      var descrEl  = item.querySelector(".extensions__item-descr");
      var nameEl   = item.querySelector(".extensions__item-name");
      var authorEl = item.querySelector(".extensions__item-author");

      item.dataset.smilePatched = "1";

      if (!descrEl || !nameEl) continue;

      var descr = descrEl.textContent || "";
      var isOurs = false;
      for (var j = 0; j < PLUGIN_URLS.length; j++) {
        if (descr.indexOf(PLUGIN_URLS[j].replace(/^https?:\/\//, "")) !== -1) {
          isOurs = true;
          break;
        }
      }

      if (isOurs) {
        nameEl.textContent = PLUGIN_NAME;
        if (authorEl) authorEl.textContent = "@mrkvka";
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Main render loop
  // ---------------------------------------------------------------------------

  function render() {
    injectStyles();
    patchExtensionsDom();
    Array.prototype.forEach.call(document.querySelectorAll(".card"), renderGridCard);
  }

  function scheduleRender() {
    clearTimeout(scheduleRender._t);
    scheduleRender._t = setTimeout(render, 80);
  }

  // ---------------------------------------------------------------------------
  // Manifest registration
  // ---------------------------------------------------------------------------

  function setManifest() {
    if (!(window.Lampa && Lampa.Manifest)) return false;
    Lampa.Manifest.plugins = manifest;
    manifestReady = true;
    updatePluginEntry();
    return true;
  }

  function waitManifest() {
    if (setManifest()) return;
    var attempts = 0;
    var timer = setInterval(function () {
      if (setManifest() || ++attempts > 80) clearInterval(timer);
    }, 250);
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  function start() {
    if (!manifestReady) waitManifest();

    if (observerStarted) { render(); return; }
    observerStarted = true;

    new MutationObserver(scheduleRender).observe(document.body, {
      childList: true,
      subtree:   true
    });

    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener("resize",            scheduleRender);
      window.addEventListener("orientationchange", scheduleRender);
    }

    render();
  }

  function boot() {
    if (window.Lampa && Lampa.Listener) {
      Lampa.Listener.follow("app", function (e) { if (e.type === "ready") start(); });
    }
    start();
  }

  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
