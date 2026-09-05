(function () {
  "use strict";

  var VERSION = "1.6.0";

  if (window.__quick720PluginVersion === VERSION) return;
  window.__quick720PluginVersion = VERSION;
  window.__quick720PluginLoaded = true;

  var PLUGIN_ID = "quick720";
  var STORAGE_PRIORITY = "quick720_priority";
  var STORAGE_PLAYER = "quick720_player";
  // Меньше = выше качество: 4K → 1080 → 720 → 480
  var TIER_4K = 0;
  var TIER_1080 = 1;
  var TIER_720 = 2;
  var TIER_480 = 3;
  var VIDEO_EXT = [
    "mkv", "mp4", "avi", "m4v", "mov", "m2ts", "ts", "wmv", "flv", "webm", "mpg", "mpeg"
  ];
  var FILE_POLL_MS = 2000;
  var FILE_POLL_MAX = 45;
  var SEEK_TRIES = 20;

  var state = {
    movie: null,
    candidates: [],
    all: [],
    tried: {},
    external: false,
    index: -1,
    hash: "",
    seekTo: 0,
    busy: false,
    session: false,
    switching: false
  };

  var manifest = {
    type: "video",
    version: VERSION,
    name: "Смотреть сразу",
    description: "Только фильмы. Приоритет качества (включая 4K). При зависании кнопка роняет качество.",
    component: PLUGIN_ID
  };

  function noty(text) {
    if (window.Lampa && Lampa.Noty) Lampa.Noty.show(text);
    else console.log("[Quick720]", text);
  }

  function isSeries(movie) {
    if (!movie) return false;
    if (movie.number_of_seasons || movie.number_of_episodes) return true;
    if (movie.first_air_date) return true;
    if (movie.media_type === "tv" || movie.type === "tv") return true;
    // У сериалов в TMDB обычно name/original_name, у фильмов title/original_title
    if ((movie.name || movie.original_name) && !(movie.title || movie.original_title || movie.release_date)) {
      return true;
    }
    return false;
  }

  function isMovie(movie) {
    return !!(movie && !isSeries(movie));
  }

  function ensureStyle() {
    if (document.getElementById("quick720-style")) return;

    var style = document.createElement("style");
    style.id = "quick720-style";
    style.textContent = [
      ".full-start__button.view--quick720,",
      ".full-start-new__buttons .view--quick720{",
      "  background: linear-gradient(135deg,#1f8f4d 0%,#146c38 100%) !important;",
      "  color:#fff !important;",
      "  font-weight:700;",
      "  font-size:1.45em;",
      "  min-height:3.2em;",
      "  padding:0.45em 1.35em;",
      "  border:0;",
      "  box-shadow:0 0.35em 1.1em rgba(20,108,56,0.35);",
      "}",
      ".full-start__button.view--quick720.focus,",
      ".full-start-new__buttons .view--quick720.focus{",
      "  background:#fff !important;",
      "  color:#146c38 !important;",
      "}",
      ".full-start__button.view--quick720 span{",
      "  display:inline !important;",
      "  margin-left:0.55em;",
      "  white-space:nowrap;",
      "}",
      ".player-panel__right .button.quick720-switch,",
      ".button.quick720-switch{",
      "  width:auto !important;",
      "  min-width:2.4em;",
      "  height:2.4em;",
      "  border-radius:1.2em !important;",
      "  padding:0 0.9em !important;",
      "  background:rgba(220,70,50,0.92) !important;",
      "  color:#fff !important;",
      "  font-size:0.85em;",
      "  font-weight:700;",
      "  white-space:nowrap;",
      "}",
      ".button.quick720-switch.focus{",
      "  background:#fff !important;",
      "  color:#b33 !important;",
      "}",
      ".quick720-float{",
      "  position:fixed;",
      "  right:1.2em;",
      "  top:1.2em;",
      "  z-index:60;",
      "  display:none;",
      "  align-items:center;",
      "  justify-content:center;",
      "  min-height:2.6em;",
      "  padding:0.55em 1em;",
      "  border-radius:1.3em;",
      "  background:rgba(220,70,50,0.94);",
      "  color:#fff;",
      "  font-weight:700;",
      "  font-size:1.05em;",
      "  box-shadow:0 0.4em 1.2em rgba(0,0,0,0.35);",
      "  cursor:pointer;",
      "}",
      ".player.player--opened .quick720-float.quick720-float--on{",
      "  display:flex;",
      "}",
      ".quick720-float.focus{",
      "  outline:0.15em solid #fff;",
      "}"
    ].join("\n");

    (document.head || document.documentElement).appendChild(style);
  }

  function movieTitle(movie) {
    return (movie && (movie.title || movie.name || movie.original_title || movie.original_name)) || "";
  }

  function yearOf(movie) {
    var raw = (movie && (movie.release_date || movie.first_air_date)) || "0000";
    return String(raw).slice(0, 4);
  }

  function posterOf(movie) {
    if (!movie) return "";
    if (movie.poster) return movie.poster;
    if (movie.img) return movie.img;
    if (movie.poster_path && Lampa.Api && Lampa.Api.img) return Lampa.Api.img(movie.poster_path);
    if (movie.poster_path && Lampa.TMDB && Lampa.TMDB.image) {
      return Lampa.TMDB.image("t/p/w300" + movie.poster_path);
    }
    return "";
  }

  var BAD_SOURCE_RE = /(^|[^a-zа-я])(cam|hdcam|camrip|ts|telesync|tc|telecine|wp|workprint)([^a-zа-я]|$)/i;

  function qualityTier(title) {
    var t = String(title || "");

    if (/2160[pр]|4\s*k|\buhd\b/i.test(t)) return TIER_4K;

    if (/1080[pр]|full\s*hd|\bfhd\b|1920\s*[x×]\s*1080/i.test(t)) return TIER_1080;

    if (/720[pр]|1280\s*[x×]\s*720/i.test(t)) return TIER_720;

    if (/480[pр]|576[pр]|dvdrip|dvdscr|(^|[^a-z0-9])sd([^a-z0-9]|$)/i.test(t)) return TIER_480;

    return -1;
  }

  function qualityLabel(title) {
    var tier = qualityTier(title);
    if (tier === TIER_4K) return "4K";
    if (tier === TIER_1080) return "1080p";
    if (tier === TIER_720) return "720p";
    if (tier === TIER_480) return "480p";
    return "?";
  }

  function tierLabel(tier) {
    if (tier === TIER_4K) return "4K";
    if (tier === TIER_1080) return "1080";
    if (tier === TIER_720) return "720";
    if (tier === TIER_480) return "480";
    return "?";
  }

  function torrentKey(item) {
    return item.MagnetUri || item.Link || item.downloadUrl || item.hash || item.Title || "";
  }

  function scoreTorrent(item) {
    var title = item.Title || item.title || "";
    var seeders = parseInt(item.Seeders, 10) || 0;
    var peers = parseInt(item.Peers, 10) || 0;
    var size = parseInt(item.Size, 10) || 0;
    var score = seeders * 100 + peers;

    if (BAD_SOURCE_RE.test(title)) score -= 100000;
    if (/web-?dl|bluray|bdrip|remux|hdtv/i.test(title)) score += 50;
    if (size > 0 && size < 200 * 1024 * 1024) score -= 500;

    return score;
  }

  function sortBest(list) {
    return list.slice().sort(function (a, b) {
      var diff = scoreTorrent(b) - scoreTorrent(a);
      if (diff) return diff;
      return (parseInt(b.Size, 10) || 0) - (parseInt(a.Size, 10) || 0);
    });
  }

  function preferredKey() {
    var val = "4k";
    try {
      if (Lampa.Storage && Lampa.Storage.field) val = Lampa.Storage.field(STORAGE_PRIORITY) || "4k";
      else if (Lampa.Storage && Lampa.Storage.get) val = Lampa.Storage.get(STORAGE_PRIORITY, "4k");
    } catch (e) {}
    val = String(val || "4k").toLowerCase();
    if (val !== "4k" && val !== "1080" && val !== "720" && val !== "480") return "4k";
    return val;
  }

  function preferredOrder() {
    var pref = preferredKey();
    if (pref === "1080") return [TIER_1080, TIER_720, TIER_480, TIER_4K];
    if (pref === "720") return [TIER_720, TIER_480, TIER_1080, TIER_4K];
    if (pref === "480") return [TIER_480, TIER_720, TIER_1080, TIER_4K];
    // 4k по умолчанию: сначала 4K, при отсутствии ниже
    return [TIER_4K, TIER_1080, TIER_720, TIER_480];
  }

  function preferredOrderLabel() {
    return preferredOrder().map(tierLabel).join(" → ");
  }

  function torrentItemKey(item) {
    return torrentKey(item);
  }

  function itemTier(item) {
    return qualityTier(item && (item.Title || item.title) || "");
  }

  function itemSize(item) {
    return parseInt(item && item.Size, 10) || 0;
  }

  function alreadyTried(item) {
    var key = torrentItemKey(item);
    return !key || !!state.tried[key];
  }

  function markTried(item) {
    var key = torrentItemKey(item);
    if (key) state.tried[key] = 1;
  }

  function isPlayableTorrent(item) {
    if (!item) return false;
    if ((parseInt(item.Seeders, 10) || 0) < 1) return false;
    if (!(item.MagnetUri || item.Link || item.downloadUrl)) return false;
    return true;
  }

  function collectAll(results) {
    var list = (results && results.Results) || results || [];
    if (!Array.isArray(list)) list = [];
    return list.filter(isPlayableTorrent);
  }

  function isLowerQuality(item, thanItem) {
    if (!item || !thanItem) return false;

    var a = itemTier(item);
    var b = itemTier(thanItem);
    var sa = itemSize(item);
    var sb = itemSize(thanItem);

    if (b >= 0 && a >= 0) return a > b;
    if (sa > 0 && sb > 0 && sa < sb * 0.72) return true;
    if (b >= 0 && a < 0 && sa > 0 && sb > 0 && sa < sb) return true;
    return false;
  }

  function appendCandidate(item) {
    if (!item || alreadyTried(item)) return -1;
    var key = torrentItemKey(item);
    for (var i = 0; i < state.candidates.length; i++) {
      if (torrentItemKey(state.candidates[i]) === key) return i;
    }
    state.candidates.push(item);
    return state.candidates.length - 1;
  }

  function filterCandidates(results) {
    var list = collectAll(results);
    var buckets = [[], [], [], []];

    list.forEach(function (item) {
      var tier = itemTier(item);
      if (tier < 0 || tier > 3) return;
      buckets[tier].push(item);
    });

    var out = [];
    preferredOrder().forEach(function (tier) {
      out = out.concat(sortBest(buckets[tier]));
    });
    return out;
  }

  // «Ниже»: сначала тир хуже, если его нет — соседние раздачи (в т.ч. без 720/480 в названии), что меньше текущей.
  function findDowngradeIndex(fromIndex) {
    if (!state.candidates.length && !(state.all && state.all.length)) return -1;

    var cur = state.candidates[fromIndex] || null;
    var curTier = cur ? itemTier(cur) : -1;
    var curKey = cur ? torrentItemKey(cur) : "";

    if (curTier >= 0) {
      for (var i = fromIndex + 1; i < state.candidates.length; i++) {
        if (alreadyTried(state.candidates[i])) continue;
        if (itemTier(state.candidates[i]) > curTier) return i;
      }
    }

    var pool = state.all && state.all.length ? state.all : state.candidates;
    if (!cur || !pool.length) return -1;

    var pos = -1;
    for (var k = 0; k < pool.length; k++) {
      if (torrentItemKey(pool[k]) === curKey) {
        pos = k;
        break;
      }
    }
    if (pos < 0) pos = Math.max(0, fromIndex);

    var max = pool.length;
    for (var dist = 1; dist < max; dist++) {
      var around = [pos + dist, pos - dist];
      for (var n = 0; n < around.length; n++) {
        var idx = around[n];
        if (idx < 0 || idx >= max) continue;
        var neigh = pool[idx];
        if (!neigh || torrentItemKey(neigh) === curKey || alreadyTried(neigh)) continue;
        if (isLowerQuality(neigh, cur)) return appendCandidate(neigh);
      }
    }

    for (var p = 0; p < pool.length; p++) {
      var it = pool[p];
      if (!it || torrentItemKey(it) === curKey || alreadyTried(it)) continue;
      if (isLowerQuality(it, cur)) return appendCandidate(it);
    }

    return -1;
  }

  function searchQuery(movie) {
    var year = yearOf(movie);
    var title = movie.title || movie.name || "";
    var original = movie.original_title || movie.original_name || title;
    var combinations = {
      df: original,
      df_year: original + " " + year,
      df_lg: original + " " + title,
      df_lg_year: original + " " + title + " " + year,
      lg: title,
      lg_year: title + " " + year,
      lg_df: title + " " + original,
      lg_df_year: title + " " + original + " " + year
    };
    var lang = (Lampa.Storage && Lampa.Storage.field("parse_lang")) || "df_year";
    return combinations[lang] || combinations.df_year || title || original;
  }

  function extOf(path) {
    var name = String(path || "").split("/").pop().split("\\").pop();
    var parts = name.split(".");
    if (parts.length < 2) return "";
    return parts.pop().toLowerCase();
  }

  function pickVideoFile(files) {
    var videos = (files || []).filter(function (f) {
      return VIDEO_EXT.indexOf(extOf(f.path)) >= 0;
    });

    if (!videos.length) return null;

    videos.sort(function (a, b) {
      return (b.length || 0) - (a.length || 0);
    });

    return videos[0];
  }

  function stopLoading() {
    if (Lampa.Loading && Lampa.Loading.stop) Lampa.Loading.stop();
  }

  function startLoading(onCancel) {
    if (Lampa.Loading && Lampa.Loading.start) {
      Lampa.Loading.start(function () {
        state.busy = false;
        if (typeof onCancel === "function") onCancel();
        stopLoading();
      });
    }
  }

  function setLoadingText(text) {
    if (Lampa.Loading && Lampa.Loading.setText) Lampa.Loading.setText(text);
  }

  function dropHash(hash) {
    if (!hash || !Lampa.Torserver) return;
    try {
      Lampa.Torserver.drop(hash);
    } catch (e) {}
  }

  function currentTime() {
    try {
      var video = Lampa.PlayerVideo && Lampa.PlayerVideo.video && Lampa.PlayerVideo.video();
      if (video && isFinite(video.currentTime)) return Math.max(0, video.currentTime);
    } catch (e) {}

    try {
      var data = Lampa.Player && Lampa.Player.playdata && Lampa.Player.playdata();
      if (data && data.timeline && data.timeline.time) return data.timeline.time;
    } catch (e2) {}

    return state.seekTo || 0;
  }

  function seekWhenReady(seconds) {
    if (!seconds || seconds < 5) return;

    var left = SEEK_TRIES;

    function trySeek() {
      left -= 1;
      try {
        var video = Lampa.PlayerVideo.video();
        if (video && video.duration && video.duration > seconds + 1) {
          Lampa.PlayerVideo.to(seconds);
          return;
        }
      } catch (e) {}

      if (left > 0) setTimeout(trySeek, 700);
    }

    setTimeout(trySeek, 1200);
  }

  function isAndroidHost() {
    try {
      if (typeof AndroidJS !== "undefined") return true;
      if (Lampa.Platform && Lampa.Platform.is && Lampa.Platform.is("android")) return true;
    } catch (e) {}
    return false;
  }

  function playerMode() {
    var val = "android";
    try {
      if (Lampa.Storage && Lampa.Storage.field) val = Lampa.Storage.field(STORAGE_PLAYER) || "android";
      else if (Lampa.Storage && Lampa.Storage.get) val = Lampa.Storage.get(STORAGE_PLAYER, "android");
    } catch (e) {}
    val = String(val || "android").toLowerCase();
    if (val === "inner" || val === "lampa") return "inner";
    if (isAndroidHost()) return "android";
    return "inner";
  }

  function playFile(file, element, movie, hash, seekTo) {
    var url = Lampa.Torserver.stream(file.path, hash, file.id);
    var title = movieTitle(movie) || element.Title || file.path;
    var timeline = null;
    var mode = playerMode();

    try {
      if (Lampa.Timeline && Lampa.Utils) {
        timeline = Lampa.Timeline.view(Lampa.Utils.hash(title + (file.path || "")));
      }
    } catch (e) {}

    if (seekTo > 5 && timeline) {
      timeline.time = seekTo;
      timeline.duration = timeline.duration || seekTo + 1;
      timeline.percent = timeline.duration ? Math.min(99, Math.round((seekTo / timeline.duration) * 100)) : 0;
    }

    try {
      if (Lampa.Torserver && Lampa.Torserver.toPlayUrl) url = Lampa.Torserver.toPlayUrl(url) || url;
    } catch (e2) {}

    if (Lampa.Player && Lampa.Player.runas) Lampa.Player.runas(mode === "android" ? "android" : "lampa");

    var play = {
      title: title,
      url: url,
      timeline: timeline,
      movie: movie,
      torrent_hash: hash
    };

    state.hash = hash;
    state.session = true;
    state.external = mode === "android";
    state.switching = false;
    state.seekTo = seekTo || 0;
    showSwitchUi(true);

    stopLoading();

    Lampa.Player.play(play);
    Lampa.Player.playlist([play]);

    if (Lampa.Player && Lampa.Player.runas) Lampa.Player.runas("");

    if (mode === "inner" && seekTo > 5) seekWhenReady(seekTo);

    noty(
      (mode === "android" ? "Внешний плеер · " : "") +
        qualityLabel(element.Title) +
        " · сиды " +
        (element.Seeders || 0) +
        " · " +
        String(element.Title || "").slice(0, 60)
    );
  }

  function waitFiles(hash, element, movie, seekTo) {
    var repeat = 0;
    var timer = setInterval(function () {
      repeat += 1;
      setLoadingText("Файлы раздачи " + Math.min(99, Math.round((repeat / FILE_POLL_MAX) * 100)) + "%");

      Lampa.Torserver.files(hash, function (json) {
        if (!(json && json.file_stats)) return;

        clearInterval(timer);

        var file = pickVideoFile(json.file_stats);
        if (!file) {
          state.busy = false;
          stopLoading();
          dropHash(hash);
          noty("В раздаче нет видеофайла, пробую другую");
          playNext(seekTo, true);
          return;
        }

        state.busy = false;
        playFile(file, element, movie, hash, seekTo);
      }, function () {
        // keep polling
      });

      if (repeat >= FILE_POLL_MAX) {
        clearInterval(timer);
        state.busy = false;
        stopLoading();
        dropHash(hash);
        noty("Таймаут раздачи, пробую другую");
        playNext(seekTo, true);
      }
    }, FILE_POLL_MS);
  }

  function startCandidate(element, movie, seekTo) {
    if (!element) {
      state.busy = false;
      stopLoading();
      noty("Больше подходящих раздач нет");
      return;
    }

    markTried(element);

    var link = element.MagnetUri || element.Link || element.downloadUrl;
    if (!link) {
      noty("У раздачи нет magnet/ссылки");
      playNext(seekTo, true);
      return;
    }

    if (!Lampa.Torserver || !Lampa.Torserver.url || !Lampa.Torserver.url()) {
      state.busy = false;
      stopLoading();
      noty("TorrServer не настроен");
      return;
    }

    setLoadingText("Подключение к TorrServer");

    Lampa.Torserver.connected(function () {
      setLoadingText("Добавляю раздачу");

      Lampa.Torserver.hash({
        title: element.Title,
        link: link,
        poster: posterOf(movie),
        data: {
          lampa: true,
          movie: movie,
          quick720: true
        }
      }, function (json) {
        if (!json || !json.hash) {
          state.busy = false;
          stopLoading();
          noty("Не удалось получить hash");
          playNext(seekTo, true);
          return;
        }

        if (state.hash && state.hash !== json.hash) dropHash(state.hash);
        state.hash = json.hash;
        waitFiles(json.hash, element, movie, seekTo || 0);
      }, function (echo) {
        state.busy = false;
        stopLoading();
        noty("Ошибка hash: " + (echo || "unknown"));
        playNext(seekTo, true);
      });
    }, function (echo) {
      state.busy = false;
      stopLoading();
      noty("TorrServer недоступен: " + (echo || ""));
    });
  }

  function playNext(seekTo, skipCurrent) {
    if (!state.candidates.length) {
      state.busy = false;
      stopLoading();
      noty("Раздачи не найдены");
      return;
    }

    var nextIndex;
    if (skipCurrent) nextIndex = findDowngradeIndex(state.index);
    else if (state.index < 0) nextIndex = 0;
    else nextIndex = state.index;

    if (nextIndex < 0 || nextIndex >= state.candidates.length) {
      state.busy = false;
      stopLoading();
      noty("Запасные раздачи закончились");
      return;
    }

    state.index = nextIndex;
    state.busy = true;
    startLoading(function () {
      state.busy = false;
    });

    startCandidate(state.candidates[state.index], state.movie, seekTo || 0);
  }

  function searchAndPlay(movie, seekTo, keepList) {
    if (!isMovie(movie)) {
      noty("Плагин только для фильмов");
      return;
    }

    if (!window.Lampa || !Lampa.Parser || !Lampa.Parser.get) {
      noty("Parser недоступен");
      return;
    }

    if (state.busy) {
      noty("Уже идёт запуск");
      return;
    }

    state.busy = true;
    state.movie = movie;
    state.seekTo = seekTo || 0;

    if (!keepList) {
      state.candidates = [];
      state.all = [];
      state.tried = {};
      state.index = -1;
    }

    startLoading(function () {
      state.busy = false;
      if (Lampa.Parser.clear) Lampa.Parser.clear();
    });

    setLoadingText("Ищу раздачи (" + preferredOrderLabel() + ")");

    var search = searchQuery(movie);
    var params = {
      movie: movie,
      search: search,
      search_one: movie.title || movie.name,
      search_two: movie.original_title || movie.original_name,
      clarification: false,
      page: 1
    };

    Lampa.Parser.get(params, function (json) {
      state.all = collectAll(json);
      var list = filterCandidates(json);

      if (!list.length) {
        state.busy = false;
        stopLoading();
        noty("Нет раздач 4K/1080/720/480 для «" + search + "»");
        return;
      }

      var firstQ = qualityLabel(list[0].Title);
      state.candidates = list;
      state.index = 0;
      setLoadingText("Найдено " + list.length + " · беру " + firstQ);
      startCandidate(list[0], movie, seekTo || 0);
    }, function (err) {
      state.busy = false;
      stopLoading();
      noty("Парсер: " + (err || "нет ответа"));
    });
  }

  function switchSource() {
    if (!state.session && !state.candidates.length) {
      noty("Сначала запусти фильм кнопкой «Смотреть сразу»");
      return;
    }

    if (state.busy) {
      noty("Смена уже выполняется");
      return;
    }

    var next = findDowngradeIndex(state.index);
    if (next < 0) {
      noty("Других раздач ниже по качеству нет");
      return;
    }

    var t = currentTime();
    var nextItem = state.candidates[next];
    var nextQ = qualityLabel(nextItem && nextItem.Title);
    var sameTier = nextItem && itemTier(nextItem) === itemTier(state.candidates[state.index]);
    noty(
      (sameTier ? "Соседняя раздача " : "Роняю качество → ") +
        nextQ +
        " · с " +
        Math.floor(t) +
        " сек"
    );

    state.switching = true;
    state.busy = true;

    try {
      if (Lampa.Player && Lampa.Player.close) Lampa.Player.close();
    } catch (e) {}

    var old = state.hash;
    state.hash = "";
    dropHash(old);

    startLoading(function () {
      state.busy = false;
      state.switching = false;
    });

    state.index = next;
    startCandidate(state.candidates[state.index], state.movie, t);
  }

  function ensureFloatButton() {
    var btn = document.querySelector(".quick720-float");
    if (btn) return btn;

    btn = document.createElement("div");
    btn.className = "quick720-float selector";
    btn.textContent = "Ниже качество";
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      switchSource();
    });

    if (window.$) {
      $(btn).on("hover:enter", function () {
        switchSource();
      });
    }

    document.body.appendChild(btn);
    return btn;
  }

  function ensurePanelButton() {
    if (!(Lampa.PlayerPanel && Lampa.PlayerPanel.render)) return null;

    var panel = Lampa.PlayerPanel.render();
    if (!panel || !panel.length) return null;

    var existing = panel.find(".quick720-switch");
    if (existing.length) return existing;

    var btn = $('<div class="button selector quick720-switch" title="Ниже качество">Ниже</div>');
    btn.on("hover:enter", function () {
      switchSource();
    });

    var right = panel.find(".player-panel__right");
    if (right.length) right.prepend(btn);
    else panel.append(btn);

    return btn;
  }

  function showSwitchUi(on) {
    var floatBtn = ensureFloatButton();
    floatBtn.classList.toggle("quick720-float--on", !!on);

    var panelBtn = ensurePanelButton();
    if (panelBtn && panelBtn.toggleClass) panelBtn.toggleClass("hide", !on);
  }

  function buttonHtml() {
    return [
      '<div class="full-start__button selector view--quick720">',
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
      '<path d="M8 5v14l11-7L8 5z" fill="currentColor"/>',
      "</svg>",
      "<span>Смотреть сразу</span>",
      "</div>"
    ].join("");
  }

  function addCardButton(e) {
    if (!e || !e.object || !e.object.activity) return;

    var render = e.object.activity.render();
    if (!render || !render.length) return;

    if (render.find(".view--quick720").length) return;

    var movie = (e.data && e.data.movie) || e.object.card || e.object.movie;
    if (!isMovie(movie)) return;

    var btn = $(buttonHtml());
    btn.on("hover:enter", function () {
      searchAndPlay(movie, 0, false);
    });

    var torrent = render.find(".view--torrent").first();
    if (torrent.length) torrent.before(btn);
    else {
      var buttons = render.find(".full-start__buttons, .full-start-new__buttons").first();
      if (buttons.length) buttons.prepend(btn);
      else render.find(".full-start__left, .full-start-new__body").first().prepend(btn);
    }
  }

  function bindPlayer() {
    if (!(Lampa.Player && Lampa.Player.listener)) return;

    Lampa.Player.listener.follow("ready", function () {
      if (!state.session) return;
      ensurePanelButton();
      showSwitchUi(true);
      if (state.seekTo > 5) seekWhenReady(state.seekTo);
    });

    Lampa.Player.listener.follow("external", function () {
      if (!state.session) return;
      state.busy = false;
      showSwitchUi(true);
    });

    Lampa.Player.listener.follow("destroy", function () {
      if (state.switching) return;

      if (state.external) {
        state.busy = false;
        showSwitchUi(true);
        return;
      }

      showSwitchUi(false);
      state.session = false;
      state.busy = false;
    });

    if (Lampa.PlayerVideo && Lampa.PlayerVideo.listener) {
      Lampa.PlayerVideo.listener.follow("canplay", function () {
        if (!state.session) return;
        ensurePanelButton();
        showSwitchUi(true);
        state.switching = false;
      });
    }
  }

  function bindFull() {
    Lampa.Listener.follow("full", function (e) {
      if (e.type == "complite") addCardButton(e);
    });

    try {
      var active = Lampa.Activity.active();
      if (active && active.component == "full" && active.activity) {
        addCardButton({
          object: active,
          data: { movie: active.card || active.movie }
        });
      }
    } catch (err) {}
  }

  function registerSettings() {
    if (!(Lampa.SettingsApi && Lampa.SettingsApi.addComponent && Lampa.SettingsApi.addParam)) return;

    try {
      Lampa.SettingsApi.addComponent({
        component: PLUGIN_ID,
        name: "Смотреть сразу",
        icon:
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
          '<path d="M8 5v14l11-7L8 5z" fill="currentColor"/>' +
          "</svg>"
      });

      Lampa.SettingsApi.addParam({
        component: PLUGIN_ID,
        param: {
          name: STORAGE_PRIORITY,
          type: "select",
          values: {
            "4k": "4K",
            "1080": "1080p",
            "720": "720p",
            "480": "480p"
          },
          default: "4k"
        },
        field: {
          name: "Приоритет качества",
          description: "Какое качество брать первым. «Ниже» сначала ищет тир хуже (4K→1080→720→480). Если его нет — соседние раздачи меньшего размера."
        }
      });

      Lampa.SettingsApi.addParam({
        component: PLUGIN_ID,
        param: {
          name: STORAGE_PLAYER,
          type: "select",
          values: {
            android: "Внешний (Just Player / VLC) — есть звук",
            inner: "Встроенный Lampa — часто без звука (AC3/DTS)"
          },
          default: "android"
        },
        field: {
          name: "Плеер",
          description: "Встроенный плеер Lampa на Android не декодирует AC3/DTS. Внешний открывает поток TorrServer в Just Player (уже стоит) или VLC."
        }
      });
    } catch (e) {
      console.log("[Quick720] settings failed", e);
    }
  }

  function startPlugin() {
    if (!window.Lampa) return;

    ensureStyle();
    ensureFloatButton();
    registerSettings();

    try {
      Lampa.Manifest.plugins = Lampa.Manifest.plugins || [];
    } catch (e) {}

    bindFull();
    bindPlayer();

    console.log("[Quick720] plugin", VERSION, "ready");
  }

  if (window.Lampa && Lampa.Listener) {
    if (window.appready) startPlugin();
    else {
      Lampa.Listener.follow("app", function (e) {
        if (e.type == "ready") startPlugin();
      });
    }
  } else {
    var waits = 0;
    var timer = setInterval(function () {
      waits += 1;
      if (window.Lampa && Lampa.Listener) {
        clearInterval(timer);
        if (window.appready) startPlugin();
        else {
          Lampa.Listener.follow("app", function (e) {
            if (e.type == "ready") startPlugin();
          });
        }
      } else if (waits > 80) clearInterval(timer);
    }, 250);
  }
})();
