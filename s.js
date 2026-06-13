(function () {
  "use strict";

  var VERSION = "1.5.1";

  if (window.__smileReactionsPluginVersion === VERSION) return;
  window.__smileReactionsPluginVersion = VERSION;
  window.__smileReactionsPluginLoaded = true;

  var PLUGIN_ID = "smile-reactions";
  var observerStarted = false;
  var manifestReady = false;
  var resizeBound = false;

  var LAYOUT = {
    leftRatio: 0.025,
    gapToVoteRatio: 0.018,
    gapRatio: 0.009,
    heightRatio: 0.78,
    fontRatio: 0.68,
    fontFitDivisor: 11.6,
    minFont: 10,
    compactWidth: 120,
    tightWidth: 96,
    iconsWidth: 74
  };

  var manifest = {
    type: "other",
    version: VERSION,
    name: "Смайлики рейтинга",
    description: "Добавляет смайлики с реакциями только на постеры в лентах, категориях и поиске.",
    component: "smile_reactions"
  };

  var POPULAR_ITEMS = [
    { type: "fire", icon: "\uD83D\uDD25", label: "Огонь", min: 180, max: 560 },
    { type: "nice", icon: "\uD83D\uDC4D", label: "Нравится", min: 55, max: 190 },
    { type: "shit", icon: "\uD83D\uDCA9", label: "Так себе", min: 12, max: 88 }
  ];

  var FALLBACK_ITEMS = [
    { type: "think", icon: "\uD83E\uDD14", label: "Задумался", min: 18, max: 120 },
    { type: "bore", icon: "\uD83D\uDE34", label: "Скучно", min: 6, max: 74 }
  ];

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

    try {
      saved = localStorage.getItem("cub_domain") || "";
    } catch (e) {}

    if (saved) return saved;
    if (window.Lampa && Lampa.Manifest && Lampa.Manifest.cub_domain) return Lampa.Manifest.cub_domain;
    if (window.lampa_settings && window.lampa_settings.cub_domain) return window.lampa_settings.cub_domain;

    return "cub.watch";
  }

  function existingReactionIcon(type) {
    var icon = document.querySelector(".reaction--" + type + " .reaction__icon");

    return icon && icon.getAttribute("src");
  }

  function reactionIconUrl(type) {
    return existingReactionIcon(type) || protocol() + cubDomain() + "/img/reactions/" + type + ".svg";
  }

  function loadReactionIcon(img, item) {
    var failed = false;
    var show = function () {
      img.style.opacity = "1";
    };
    var fallback = function () {
      if (failed) return;

      failed = true;
      if (img.parentNode) {
        img.parentNode.replaceChild(document.createTextNode(item.icon), img);
      }
    };

    img.alt = item.label;
    img.src = reactionIconUrl(item.type);
    img.style.opacity = "0";

    if (window.Lampa && Lampa.Utils && Lampa.Utils.imgLoad) {
      Lampa.Utils.imgLoad(img, img.src, show, fallback);
      return;
    }

    img.onload = show;
    img.onerror = fallback;
  }

  function countFor(key, item) {
    var range = item.max - item.min + 1;

    return item.min + hash(key + ":" + item.type) % range;
  }

  function topItems(key) {
    var items = POPULAR_ITEMS.map(function (item) {
      return {
        item: item,
        count: countFor(key, item)
      };
    });

    if (items.length < 3) {
      items = items.concat(FALLBACK_ITEMS.map(function (item) {
        return {
          item: item,
          count: countFor(key, item)
        };
      }));
    }

    return items.sort(function (a, b) {
      return b.count - a.count;
    }).slice(0, 3);
  }

  function gridCardKey(card) {
    var title = card.querySelector(".card__title");
    var age = card.querySelector(".card__age");
    var vote = card.querySelector(".card__vote");
    var image = card.querySelector(".card__img");

    return [
      location.pathname,
      location.hash,
      title ? title.textContent.trim() : "",
      age ? age.textContent.trim() : "",
      vote ? vote.textContent.trim() : "",
      image ? image.getAttribute("src") || "" : ""
    ].join("|");
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
      ".card__smile-reactions{box-sizing:border-box;position:absolute;left:var(--sr-left,.35em);bottom:var(--sr-bottom,.3em);height:var(--sr-height,1.8em);z-index:2;display:flex;align-items:center;justify-content:space-evenly;gap:var(--sr-gap,.12em);padding:0 var(--sr-pad,.24em);border-radius:999px;background:rgba(0,0,0,.56);box-shadow:0 .1em .45em rgba(0,0,0,.22);overflow:hidden;pointer-events:none;color:#fff;font-size:var(--sr-font,1.08em);font-weight:700;line-height:normal;}",
      ".card__smile-reaction{box-sizing:border-box;min-width:0;flex:0 1 auto;padding:0;display:flex;align-items:center;justify-content:center;gap:var(--sr-inner-gap,.08em);white-space:nowrap;line-height:normal;}",
      ".card__smile-reaction-emoji{width:.92em;height:.92em;line-height:normal;display:block;flex:0 0 auto;object-fit:contain;transition:opacity .15s;}",
      ".card__smile-reaction-count{font-size:.74em;line-height:normal;display:block;min-width:0;overflow:hidden;text-overflow:clip;}",
      ".card__smile-reactions.is--compact .card__smile-reaction:nth-child(3) .card__smile-reaction-count{display:none;}",
      ".card__smile-reactions.is--tight .card__smile-reaction:nth-child(n+2) .card__smile-reaction-count{display:none;}",
      ".card__smile-reactions.is--icons .card__smile-reaction-count{display:none;}"
    ].join("");
  }

  function syncGridLayout(view, vote, holder) {
    var viewRect = view.getBoundingClientRect();
    var voteRect = vote.getBoundingClientRect();

    if (!viewRect.width || !voteRect.width) return;

    var left = Math.max(4, Math.round(viewRect.width * LAYOUT.leftRatio));
    var gapToVote = Math.max(4, Math.round(viewRect.width * LAYOUT.gapToVoteRatio));
    var gap = Math.max(2, Math.round(viewRect.width * LAYOUT.gapRatio));
    var right = Math.max(0, Math.round(viewRect.right - voteRect.left + gapToVote));
    var available = Math.max(0, Math.round(viewRect.width - left - right));
    var voteHeight = Math.max(1, voteRect.height);
    var height = Math.max(14, Math.round(voteHeight * LAYOUT.heightRatio));
    var center = voteRect.top + voteHeight / 2;
    var bottom = Math.max(0, Math.round(viewRect.bottom - center - height / 2));
    var voteFont = parseFloat(getComputedStyle(vote).fontSize) || 20;
    var font = Math.max(LAYOUT.minFont, Math.min(voteFont * LAYOUT.fontRatio, available / LAYOUT.fontFitDivisor));
    var pad = Math.max(2, Math.min(7, available / 38));

    holder.classList.toggle("is--compact", available < LAYOUT.compactWidth);
    holder.classList.toggle("is--tight", available < LAYOUT.tightWidth);
    holder.classList.toggle("is--icons", available < LAYOUT.iconsWidth);

    holder.style.setProperty("--sr-left", left + "px");
    holder.style.setProperty("--sr-bottom", bottom + "px");
    holder.style.setProperty("--sr-height", height + "px");
    holder.style.setProperty("--sr-gap", gap + "px");
    holder.style.setProperty("--sr-pad", pad + "px");
    holder.style.setProperty("--sr-inner-gap", Math.max(1, Math.round(gap * 0.7)) + "px");
    holder.style.setProperty("--sr-font", font + "px");
    holder.style.right = right + "px";
  }

  function renderGridCard(card) {
    var view = card.querySelector(".card__view");
    var vote = card.querySelector(".card__vote");

    if (!view || !vote) return;

    var key = gridCardKey(card);
    var items = topItems(key);
    var holder = view.querySelector(".card__smile-reactions");
    var alreadyRendered = holder &&
      holder.dataset.smileReactionsVersion === VERSION &&
      holder.dataset.smileReactionsKey === key &&
      holder.querySelectorAll(".card__smile-reaction").length === items.length;

    if (!holder) {
      holder = document.createElement("div");
      holder.className = "card__smile-reactions";
      view.appendChild(holder);
    }

    syncGridLayout(view, vote, holder);

    if (alreadyRendered) return;

    holder.dataset.smileReactionsKey = key;
    holder.dataset.smileReactionsVersion = VERSION;
    holder.innerHTML = "";

    items.forEach(function (record) {
      var item = record.item;
      var chip = document.createElement("div");
      var icon = document.createElement("img");
      var count = document.createElement("span");

      chip.className = "card__smile-reaction card__smile-reaction--" + item.type;
      chip.setAttribute("title", item.label + ": " + record.count);

      icon.className = "card__smile-reaction-emoji";
      loadReactionIcon(icon, item);

      count.className = "card__smile-reaction-count";
      count.textContent = numberShort(record.count);

      chip.appendChild(icon);
      chip.appendChild(count);
      holder.appendChild(chip);
    });
  }

  function render() {
    injectStyles();
    Array.prototype.forEach.call(document.querySelectorAll(".card"), renderGridCard);
  }

  function scheduleRender() {
    clearTimeout(scheduleRender.timer);
    scheduleRender.timer = setTimeout(render, 80);
  }

  function setManifest() {
    if (window.Lampa && Lampa.Manifest) {
      Lampa.Manifest.plugins = manifest;
      manifestReady = true;
      return true;
    }

    return false;
  }

  function waitManifest() {
    var attempts = 0;

    if (setManifest()) return;

    var timer = setInterval(function () {
      attempts++;

      if (setManifest() || attempts > 80) {
        clearInterval(timer);
      }
    }, 250);
  }

  function start() {
    if (!manifestReady) waitManifest();
    if (observerStarted) {
      render();
      return;
    }

    observerStarted = true;

    var observer = new MutationObserver(function () {
      scheduleRender();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true
    });

    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener("resize", scheduleRender);
      window.addEventListener("orientationchange", scheduleRender);
    }

    render();
  }

  function boot() {
    if (window.appready) {
      start();
    } else if (window.Lampa && Lampa.Listener) {
      Lampa.Listener.follow("app", function (event) {
        if (event.type === "ready") start();
      });
      start();
    } else {
      start();
    }
  }

  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
