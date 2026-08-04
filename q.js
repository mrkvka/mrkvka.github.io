(function () {
  "use strict";

  var VERSION = "1.2.0";

  if (window.__quick720PluginVersion === VERSION) return;
  window.__quick720PluginVersion = VERSION;
  window.__quick720PluginLoaded = true;

  var PLUGIN_ID = "quick720";
  // 0 = 720p (приоритет), 1 = 1080p, 2 = 480p/SD. 4K не берём.
  var TIER_720 = 0;
  var TIER_1080 = 1;
  var TIER_480 = 2;
  var VIDEO_EXT = [
    "mkv", "mp4", "avi", "m4v", "mov", "m2ts", "ts", "wmv", "flv", "webm", "mpg", "mpeg"
  ];
  var FILE_POLL_MS = 2000;
  var FILE_POLL_MAX = 45;
  var SEEK_TRIES = 20;

  var state = {
    movie: null,
    candidates: [],
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
    name: "Быстрый запуск 720p",
    description: "Только фильмы: приоритет 720p, иначе 1080p или 480p. Сериалы игнорируются.",
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

    if (/2160[pр]|4\s*k|\buhd\b/i.test(t)) return -1;

    // Явный 720 без 1080/4K
    if (/720[pр]/i.test(t) && !/1080[pр]/i.test(t)) return TIER_720;

    if (/1080[pр]/i.test(t)) return TIER_1080;

    if (/480[pр]|576[pр]|dvdrip|dvdscr|(^|[^a-z0-9])sd([^a-z0-9]|$)/i.test(t)) return TIER_480;

    return -1;
  }

  function qualityLabel(title) {
    var tier = qualityTier(title);
    if (tier === TIER_720) return "720p";
    if (tier === TIER_1080) return "1080p";
    if (tier === TIER_480) return "480p";
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

  function filterCandidates(results) {
    var list = (results && results.Results) || results || [];
    if (!Array.isArray(list)) list = [];

    var buckets = [[], [], []];

    list.forEach(function (item) {
      if ((parseInt(item.Seeders, 10) || 0) < 1) return;
      if (!(item.MagnetUri || item.Link || item.downloadUrl)) return;

      var tier = qualityTier(item.Title || item.title || "");
      if (tier < 0 || tier > 2) return;

      buckets[tier].push(item);
    });

    // Сначала все 720p (лучшие), потом 1080p, потом 480p
    return sortBest(buckets[TIER_720])
      .concat(sortBest(buckets[TIER_1080]))
      .concat(sortBest(buckets[TIER_480]));
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

  function playFile(file, element, movie, hash, seekTo) {
    var url = Lampa.Torserver.stream(file.path, hash, file.id);
    var title = movieTitle(movie) || element.Title || file.path;
    var timeline = null;

    try {
      if (Lampa.Timeline && Lampa.Utils) {
        timeline = Lampa.Timeline.view(Lampa.Utils.hash(title + (file.path || "")));
      }
    } catch (e) {}

    if (Lampa.Player && Lampa.Player.runas) Lampa.Player.runas("lampa");

    var play = {
      title: title,
      url: url,
      timeline: timeline,
      movie: movie,
      torrent_hash: hash
    };

    state.hash = hash;
    state.session = true;
    state.switching = false;
    state.seekTo = seekTo || 0;
    showSwitchUi(true);

    stopLoading();

    Lampa.Player.play(play);
    Lampa.Player.playlist([play]);

    if (seekTo > 5) seekWhenReady(seekTo);

    noty(qualityLabel(element.Title) + " · сиды " + (element.Seeders || 0) + " · " + String(element.Title || "").slice(0, 60));
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

    if (skipCurrent) state.index += 1;
    else if (state.index < 0) state.index = 0;

    if (state.index >= state.candidates.length) {
      state.busy = false;
      stopLoading();
      noty("Запасные раздачи закончились");
      return;
    }

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
      state.index = -1;
    }

    startLoading(function () {
      state.busy = false;
      if (Lampa.Parser.clear) Lampa.Parser.clear();
    });

    setLoadingText("Ищу раздачи (720 → 1080 → 480)");

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
      var list = filterCandidates(json);

      if (!list.length) {
        state.busy = false;
        stopLoading();
        noty("Нет раздач 720/1080/480 для «" + search + "»");
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
      noty("Сначала запусти фильм кнопкой 720p");
      return;
    }

    if (state.busy) {
      noty("Смена уже выполняется");
      return;
    }

    if (state.index + 1 >= state.candidates.length) {
      noty("Других раздач нет");
      return;
    }

    var t = currentTime();
    noty("Меняю раздачу с " + Math.floor(t) + " сек");

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

    state.index += 1;
    startCandidate(state.candidates[state.index], state.movie, t);
  }

  function ensureFloatButton() {
    var btn = document.querySelector(".quick720-float");
    if (btn) return btn;

    btn = document.createElement("div");
    btn.className = "quick720-float selector";
    btn.textContent = "Сменить если зависло";
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

    var btn = $('<div class="button selector quick720-switch" title="Сменить раздачу">Сменить</div>');
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
      "<span>Смотреть 720p</span>",
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

    Lampa.Player.listener.follow("destroy", function () {
      showSwitchUi(false);

      if (state.switching) return;

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

  function startPlugin() {
    if (!window.Lampa) return;

    ensureStyle();
    ensureFloatButton();

    if (Lampa.Manifest && Lampa.Manifest.plugins) {
      // no-op; manifest kept for clarity
    }

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
