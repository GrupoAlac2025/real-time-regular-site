(function () {
  'use strict';

  var C = window.ALAD_CONFIG || {};
  var stageEl = null;
  var layersEl = null;
  var bgEls = [];
  var els = [];
  var weather = null;
  var weatherByRes = {};
  var resources = {};
  var apiData = {};
  var apiPrev = {};
  var apiChangedAt = {};
  var cdByRes = {};
  var cd = { active: false, d: 0, h: 0, m: 0, s: 0 };
  var bgIndex = -1;
  var curBgId = null;
  var AD_START = Date.now();

  function byId(id) { return document.getElementById(id); }
  function resById(id) { return (id && resources) ? (resources[id] || null) : null; }

  function jsonPath(obj, path) {
    var cur = obj;
    var parts = String(path || '').split('.');
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return '';
      var p = parts[i];
      if (p.charAt(0) === '[' && p.charAt(p.length - 1) === ']') p = p.slice(1, -1);
      var m = p.match(/^([^[]+)([(d+)])?$/);
      var key = m ? (m[1] || p) : p;
      cur = (typeof cur === 'object' && cur != null && key in cur) ? cur[key] : undefined;
      if (cur == null) return '';
      if (m && m[2]) cur = cur[parseInt(m[3], 10)];
    }
    return cur == null ? '' : cur;
  }
  function pad(n, zero) {
    n = parseInt(n, 10) || 0;
    // If zero is undefined or true, pad with leading zero
    // If zero is false, don't pad
    if (zero === false) return '' + n;
    return n < 10 ? '0' + n : '' + n;
  }

  function nowInTz() {
    var tz = C.clockTimezone || '';
    if (!tz) return new Date();
    try {
      if (!window.Intl || !Intl.DateTimeFormat || !Intl.DateTimeFormat.prototype.formatToParts) return new Date();
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).formatToParts(new Date());
      var vals = {};
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type !== 'literal') vals[parts[i].type] = parseInt(parts[i].value, 10);
      }
      return new Date(vals.year, vals.month - 1, vals.day, vals.hour, vals.minute, vals.second);
    } catch (e) {
      return new Date();
    }
  }

  function esc(s) {
    s = String(s == null ? '' : s);
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /* ---------- Escala del escenario (stretch / contain) ---------- */
  // La escala SIEMPRE usa la ventana real (pantalla completa / iframe), pero
  // el tamaño físico del escenario es el del breakpoint activo (igual al
  // lienzo del editor), así la vista previa coincide con lo que se dibuja.
  function windowSize() {
    return {
      w: window.innerWidth || document.documentElement.clientWidth,
      h: window.innerHeight || document.documentElement.clientHeight
    };
  }

  function activeStageSize() {
    var bp = activeBreakpoint();
    if (bp) {
      var bw = bp.width || bp.maxWidth || C.stageWidth;
      var bh = bp.height || Math.round((bw * C.stageHeight) / C.stageWidth);
      return { width: bw, height: bh };
    }
    return { width: C.stageWidth, height: C.stageHeight };
  }

  function scaleStage() {
    if (!stageEl) return;
    var size = activeStageSize();
    var stw = size.width;
    var sth = size.height;
    var vp = windowSize();
    var vw = vp.w;
    var vh = vp.h;
    var ratio = stw / sth;
    var vr = vw / vh;
    var s;
    if (C.fitMode === 'cover') {
      s = vr > ratio ? vw / stw : vh / sth;
    } else {
      s = vr > ratio ? vh / sth : vw / stw;
    }
    stageEl.style.width = stw + 'px';
    stageEl.style.height = sth + 'px';
    stageEl.style.transform = 'translate(-50%, -50%) scale(' + s + ')';
  }

  /* ---------- Fondos (imagen/video, rotación con duración y condición media) ---------- */
  var activeBgs = [];

  function bgMatches(it) {
    if (!it) return false;
    var bps = it.breakpoints;
    if (bps && bps.length > 0) {
      var cur = activeBreakpoint();
      if (!cur) return bps.indexOf('__base__') !== -1;
      for (var i = 0; i < bps.length; i++) {
        if (bps[i] === '__base__') continue;
        if (bps[i] === cur.id) return true;
      }
      return false;
    }
    return true;
  }

  function refreshActiveBgs() {
    var items = C.backgrounds || [];
    activeBgs = [];
    for (var i = 0; i < bgEls.length; i++) {
      bgEls[i].style.opacity = '0';
    }
    for (var j = 0; j < items.length; j++) {
      if (bgMatches(items[j]) && condPass(items[j].condition, cd)) {
        activeBgs.push({ el: bgEls[j], it: items[j] });
      }
    }
    if (activeBgs.length > 0 && bgIndex >= activeBgs.length) bgIndex = 0;
  }

  function syncBgs() {
    refreshActiveBgs();
    if (activeBgs.length === 0) {
      clearBgs();
      return;
    }
    var idx = -1;
    for (var i = 0; i < activeBgs.length; i++) {
      if (activeBgs[i].it && activeBgs[i].it.id === curBgId) { idx = i; break; }
    }
    showBg(idx >= 0 ? idx : 0);
  }

  function showBg(idx) {
    if (activeBgs.length === 0) return;
    bgIndex = idx % activeBgs.length;
    var active = activeBgs[bgIndex];
    curBgId = active.it ? active.it.id : null;
    for (var i = 0; i < bgEls.length; i++) {
      bgEls[i].style.opacity = bgEls[i] === active.el ? '1' : '0';
    }
  }

  function clearBgs() {
    curBgId = null;
    for (var i = 0; i < bgEls.length; i++) bgEls[i].style.opacity = '0';
  }

  /* ---------- HLS (m3u8) para videos de fondo ---------- */
  var hlsQueue = [];
  var hlsLoading = false;
  function ensureHls(cb) {
    if (window.Hls) { try { cb(window.Hls); } catch (e) {} return; }
    hlsQueue.push(cb);
    if (hlsLoading) return;
    hlsLoading = true;
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
    s.async = true;
    s.onload = function () {
      hlsLoading = false;
      var q = hlsQueue; hlsQueue = [];
      for (var i = 0; i < q.length; i++) { try { q[i](window.Hls); } catch (e) {} }
    };
    s.onerror = function () {
      hlsLoading = false;
      var q = hlsQueue; hlsQueue = [];
      for (var i = 0; i < q.length; i++) { try { q[i](null); } catch (e) {} }
    };
    document.head.appendChild(s);
  }
  function attachVideo(el, url) {
    var isHls = url && url.toLowerCase().indexOf('.m3u8') !== -1;
    if (!isHls) { el.src = url; return; }
    ensureHls(function (H) {
      if (!H || !H.isSupported || !H.isSupported()) {
        try { el.src = url; } catch (e) {}
        return;
      }
      var hls = new H();
      hls.loadSource(url);
      hls.attachMedia(el);
      el.hlsNet = 0;
      el.hlsMedia = 0;
      hls.on(H.Events.ERROR, function (evt, data) {
        if (!data || !data.fatal) return;
        if (data.type === H.ErrorTypes.NETWORK_ERROR && el.hlsNet < 5) {
          el.hlsNet++;
          try { hls.startLoad(); } catch (e) {}
        } else if (data.type === H.ErrorTypes.MEDIA_ERROR && el.hlsMedia < 3) {
          el.hlsMedia++;
          try { hls.recoverMediaError(); } catch (e) {}
        } else {
          try { hls.destroy(); el.hlsInstance = null; el.src = url; } catch (e) {}
        }
      });
      el.hlsInstance = hls;
    });
  }

  /* Algunos reproductores externos (Chromium viejo / Android WebView con
     mediaPlaybackRequiresUserGesture=true, X5) ignoran el atributo autoplay
     aunque el video esté silenciado -> queda pausado con botón gris.
     Llamamos play() explícitamente, con reintentos cross-browser. */
  function tryPlayVideo(el) {
    if (!el || el.tagName !== 'VIDEO') return;
    try { el.preload = 'auto'; } catch (e) {}
    var attempt = function () {
      try {
        try { el.muted = true; } catch (e) {}
        var pr = el.play();
        if (pr && pr.catch) pr.catch(function () {});
      } catch (e) {}
    };
    attempt();
    el.addEventListener('loadeddata', attempt);
    el.addEventListener('loadedmetadata', attempt);
    el.addEventListener('canplay', attempt);
    el.addEventListener('canplaythrough', attempt);
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (!el.paused || el.ended || tries > 60) { clearInterval(timer); return; }
      attempt();
    }, 2000);
    try {
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && el.paused) attempt();
      });
      window.addEventListener('focus', attempt);
    } catch (e2) {}
  }

  function setupBg() {
    var container = byId('bg');
    if (!container) return;
    var items = C.backgrounds || [];
    if (C.bgColor) container.style.backgroundColor = C.bgColor;

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var el;
      if (it.type === 'video') {
        el = document.createElement('video');
        try { el.preload = 'auto'; } catch (e0) {}
        el.muted = true;
        try { el.defaultMuted = true; } catch (e0b) {}
        el.autoplay = true;
        var _doLoop = items.length === 1 || (it.condition && it.condition.type !== 'always');
        el.loop = !!_doLoop;
        if (_doLoop) el.setAttribute('loop', '');
        el.setAttribute('muted', '');
        el.setAttribute('autoplay', '');
        el.setAttribute('playsinline', '');
        el.setAttribute('webkit-playsinline', '');
        el.setAttribute('x5-playsinline', '');
        el.setAttribute('x5-video-player-type', 'h5');
        el.setAttribute('x5-video-player-fullscreen', 'false');
        el.setAttribute('x-webkit-airplay', 'allow');
        try { el.playsInline = true; } catch (e1) {}
        el.controls = false;
        try { el.disablePictureInPicture = true; } catch (e2) {}
        el.style.width = '100%';
        el.style.height = '100%';
        el.style.objectFit = 'cover';
        el.addEventListener('error', function () { try { console.log('[ALAD] video error', it.src); } catch (e3) {} });
      } else {
        el = document.createElement('div');
        el.style.backgroundImage = "url('" + it.src + "')";
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
      }
      el.className = 'bg-item';
      el.style.opacity = '0';
      container.appendChild(el);
      bgEls.push(el);
      if (it.type === 'video') {
        attachVideo(el, it.src);
        tryPlayVideo(el);
      }
    }

    refreshActiveBgs();

    if (activeBgs.length > 1) {
      (function rotate() {
        var cur = activeBgs[bgIndex >= 0 ? bgIndex : 0];
        var it = cur ? cur.it : null;
        var dur = (it && it.duration) ? it.duration : 8;
        setTimeout(function () {
          if (activeBgs.length === 0) return;
          showBg(bgIndex + 1);
          rotate();
        }, dur * 1000);
      })();
    } else {
      showBg(Math.max(0, bgIndex));
    }
  }

  function onMediaResizeBg() {
    syncBgs();
  }

  /* ---------- Tokens de texto ---------- */
  var MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  var DAYS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

  function fillTokens(text) {
    var now = nowInTz();
    var hh = now.getHours();
    var mm = now.getMinutes();
    var h12 = hh % 12; if (h12 === 0) h12 = 12;
    var ampm = hh < 12 ? 'AM' : 'PM';
    var rep = {
      '{time}': pad(hh) + ':' + pad(mm),
      '{time12}': h12 + ':' + pad(mm) + ' ' + ampm,
      '{date}': pad(now.getDate()) + '/' + pad(now.getMonth() + 1) + '/' + now.getFullYear(),
      '{weekday}': DAYS[now.getDay()],
      '{month}': MONTHS[now.getMonth()],
      '{year}': '' + now.getFullYear(),
      '{temp}': weather ? Math.round(weather.temp) + '°' : '--°',
      '{temp_c}': weather ? Math.round(weather.tempC) + '°C' : '--°C',
      '{temp_f}': weather ? Math.round(weather.tempF) + '°F' : '--°F',
      '{city}': weather ? weather.city : '',
      '{condition}': weather ? weather.text : '',
      '{condition_icon}': weather ? weather.icon : '',
      '{cd_d}': pad(cd.d),
      '{cd_h}': pad(cd.h),
      '{cd_m}': pad(cd.m),
      '{cd_s}': pad(cd.s)
    };
    var rarr = C.resources || [];
    for (var rx = 0; rx < rarr.length; rx++) {
      var rr = rarr[rx];
      if (!rr) continue;
      var pfx = rr.tokenPrefix || rr.name || rr.id;
      if (rr.type === 'countdown') {
        var cr = cdByRes[rr.id] || cdValues(rr.target);
        rep['{' + pfx + '.cd_d}'] = pad(cr.d);
        rep['{' + pfx + '.cd_h}'] = pad(cr.h);
        rep['{' + pfx + '.cd_m}'] = pad(cr.m);
        rep['{' + pfx + '.cd_s}'] = pad(cr.s);
      } else if (rr.type === 'weather') {
        var wr = weatherByRes[rr.id] || null;
        rep['{' + pfx + '.temp}'] = wr ? Math.round(wr.temp) + '°' : '--°';
        rep['{' + pfx + '.temp_c}'] = wr ? Math.round(wr.tempC) + '°C' : '--°C';
        rep['{' + pfx + '.temp_f}'] = wr ? Math.round(wr.tempF) + '°F' : '--°F';
        rep['{' + pfx + '.city}'] = (wr && wr.city) || rr.city || '';
        rep['{' + pfx + '.condition}'] = (wr && wr.text) || '';
        rep['{' + pfx + '.condition_icon}'] = (wr && wr.icon) || '';
      }
    }
    var out = String(text || '');
    for (var key in rep) {
      if (Object.prototype.hasOwnProperty.call(rep, key)) out = out.split(key).join(rep[key]);
    }
    for (var aKey in apiData) {
      if (Object.prototype.hasOwnProperty.call(apiData, aKey) && apiData[aKey] != null) {
        var apiVal = apiData[aKey];
        var apiStr = typeof apiVal === 'object' ? JSON.stringify(apiVal) : String(apiVal);
        out = out.split(aKey).join(apiStr);
      }
    }
    return out;
  }

  /* ---------- Cuenta regresiva ---------- */
  function cdValues(tgt) {
    var v = { active: false, d: 0, h: 0, m: 0, s: 0 };
    if (!tgt) return v;
    var diff = new Date(tgt).getTime() - Date.now();
    if (diff <= 0) return v;
    v.active = true;
    v.d = Math.floor(diff / 86400000);
    v.h = Math.floor((diff % 86400000) / 3600000);
    v.m = Math.floor((diff % 3600000) / 60000);
    v.s = Math.floor((diff % 60000) / 1000);
    return v;
  }

  function toMin(t) {
    var p = String(t || '00:00').split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }

  /* ---------- Condiciones / mensajes dinámicos ---------- */
  function condPass(c, elCd) {
    if (!c) return true;
    var res = condBase(c, elCd);
    return c.not ? !res : res;
  }

  function condBase(c, elCd) {
    var now = nowInTz();
    switch (c.type) {
      case 'always': return true;
      case 'beforeDate': return c.date ? now < new Date(c.date) : true;
      case 'afterDate': return c.date ? now >= new Date(c.date) : true;
      case 'timeRange':
        if (!c.from || !c.to) return true;
        var m = now.getHours() * 60 + now.getMinutes();
        var f = toMin(c.from);
        var t = toMin(c.to);
        if (f <= t) return m >= f && m <= t;
        return m >= f || m <= t;
      case 'days':
        return c.days && c.days.indexOf(now.getDay()) !== -1;
      case 'countdownActive':
        return cdSource(c, elCd).active;
      case 'countdownValue':
        var src = cdSource(c, elCd);
        var cu = c.cdUnit || 'd';
        var cvv = cu === 'h' ? src.h : cu === 'm' ? src.m : cu === 's' ? src.s : src.d;
        return apiCompare(c.cdCompare || 'eq', cvv, c.cdValue);
      case 'showFor': {
        if (!c.showFor || c.showFor <= 0) return true;
        var delayMs = (c.delay != null && c.delay > 0) ? c.delay * 1000 : 0;
        var tMs = Date.now() - AD_START - delayMs;
        if (tMs < 0) return false;
        var elapsed = Math.floor(tMs / 1000) % (c.cycle || c.showFor);
        return elapsed < c.showFor;
      }
      case 'background':
        return !!c.bgId && curBgId === c.bgId;
      case 'apiChanged':
        if (!c.apiToken) return anyApiChanged();
        var ak = apiTokenKey(c.apiToken);
        var at = apiChangedAt[ak];
        if (!at) return false;
        var ahold = c.hold != null && c.hold > 0 ? c.hold : 6;
        return (Date.now() - at) <= ahold * 1000;
      case 'apiValue':
        if (!c.apiToken) return true;
        return apiCompare(c.apiCompare, apiData[apiTokenKey(c.apiToken)], c.apiValue);
    }
    return true;
  }

  function apiTokenKey(tok) {
    var s = String(tok || '').trim();
    return s.charAt(0) === '{' ? s : '{' + s + '}';
  }

  function cdSource(c, elCd) {
    if (c.cdResourceId) {
      var r = cdByRes[c.cdResourceId];
      if (r) return r;
    }
    return elCd || cd;
  }

  function anyApiChanged() {
    var t = Date.now();
    for (var k in apiChangedAt) {
      if (Object.prototype.hasOwnProperty.call(apiChangedAt, k) && (t - apiChangedAt[k]) <= 6 * 1000) return true;
    }
    return false;
  }

  function apiCompare(op, cur, want) {
    var cv = parseFloat(cur);
    var wv = parseFloat(want);
    if (!isNaN(cv) && !isNaN(wv)) {
      switch (op) {
        case 'neq': return cv !== wv;
        case 'gt': return cv > wv;
        case 'lt': return cv < wv;
        default: return cv === wv;
      }
    }
    var cs = String(cur == null ? '' : cur);
    var ws = String(want == null ? '' : want);
    switch (op) {
      case 'neq': return cs !== ws;
      case 'gt': return cs > ws;
      case 'lt': return cs < ws;
      default: return cs === ws;
    }
  }

  /* ---------- Media queries / puntos de corte ---------- */
  function activeBreakpoint() {
    var bps = C.breakpoints || [];

    // En preview forzado se indica exactamente qué breakpoint mostrar
    // (o null = Base). Así cada tamaño del selector usa su propia posición.
    if (window.ALAD_VIEWPORT && 'breakpointId' in window.ALAD_VIEWPORT) {
      var forced = window.ALAD_VIEWPORT.breakpointId;
      if (!forced) return null;
      for (var f = 0; f < bps.length; f++) {
        if (bps[f].id === forced) return bps[f];
      }
      return null;
    }

    // En producción (ventana real) se elige el breakpoint cuyo tamaño sea el
    // MÁS CERCANO a la ventana actual, comparando también contra la Base
    // (stage). Así al redimensionar el navegador se aplica el breakpoint
    // correspondiente, igual que en el preview.
    var vp = windowSize();
    var vw = vp.w;
    var vh = vp.h;
    var sw = C.stageWidth || vw;
    var sh = C.stageHeight || vh;

    function dist(w, h) {
      var dx = (w - vw) / sw;
      var dy = (h - vh) / sh;
      return dx * dx + dy * dy;
    }

    var best = null;
    var bestScore = dist(sw, sh);
    for (var i = 0; i < bps.length; i++) {
      var bp = bps[i];
      var bpW = bp.width || bp.maxWidth || 0;
      var bpH = bp.height || (bpW ? Math.round((bpW * sh) / sw) : 0);
      if (bpW <= 0) continue;
      var d = dist(bpW, bpH);
      if (d < bestScore) {
        bestScore = d;
        best = bp;
      }
    }
    return best;
  }

  function overridesFor(cfg) {
    var bp = activeBreakpoint();
    if (bp && cfg.overrides && cfg.overrides[bp.id]) return cfg.overrides[bp.id];
    return {};
  }

  /* ---------- Estilos de cada elemento ---------- */
  function applyStyle(r) {
    var cfg = r.cfg;
    var o = overridesFor(cfg);
    var x = o.x != null ? o.x : cfg.x;
    var y = o.y != null ? o.y : cfg.y;
    var w = o.width != null ? o.width : cfg.width;
    var h = o.height != null ? o.height : cfg.height;
    var fs = o.fontSize != null ? o.fontSize : cfg.fontSize;
    var hidden = o.hidden === true;

    var el = r.el;
    if (hidden) { el.style.display = 'none'; return false; }
    el.style.display = '';
    el.style.left = x + '%';
    el.style.top = y + '%';
    el.style.width = w + '%';
    if (h != null) el.style.height = h + '%';

    var inner = r.inner;
    inner.style.fontSize = fs + 'px';
    inner.style.fontWeight = cfg.fontWeight || '400';
    inner.style.color = cfg.color || '#ffffff';
    inner.style.background = cfg.background || 'transparent';
    inner.style.padding = cfg.padding || '0';
    inner.style.borderRadius = cfg.radius || '0';
    inner.style.letterSpacing = (cfg.letterSpacing || 0) + 'px';
    inner.style.lineHeight = cfg.lineHeight || 1.2;
    inner.style.textAlign = cfg.align || 'left';
    if (cfg.fontFamilyKey) inner.style.fontFamily = "'" + cfg.fontFamilyKey + "', sans-serif";
    return true;
  }

  /* ---------- Contenido por tipo ---------- */
  function buildClock(cfg) {
    var now = nowInTz();
    var hh = now.getHours();
    var mm = now.getMinutes();
    var ss = now.getSeconds();
    var time = [];
    if (cfg.clockShowHours !== false) {
      var h = cfg.clock12 ? (hh % 12 === 0 ? 12 : hh % 12) : hh;
      // Hours follow the padZero setting
      time.push(pad(h, cfg.padZero !== false));
    }
    if (cfg.clockShowMinutes !== false) {
      // Minutes ALWAYS padded
      time.push(pad(mm, true));
    }
    if (cfg.clockShowSeconds !== false) {
      // Seconds ALWAYS padded
      time.push(pad(ss, true));
    }
    var suffix = cfg.clock12 && cfg.clockShowAmPm !== false ? (hh < 12 ? 'AM' : 'PM') : '';
    var out;
    if (time.length === 0) {
      out = suffix;
    } else {
      out = time.join(':') + (suffix ? ' ' + suffix : '');
    }
    if (cfg.showDate && out) {
      out = pad(now.getDate()) + '/' + pad(now.getMonth() + 1) + '/' + now.getFullYear() + '  ' + out;
    }
    return out;
  }

  function buildAmpm(cfg) {
    var hh = nowInTz().getHours();
    var v = hh < 12 ? 'AM' : 'PM';
    return cfg.ampmUppercase === false ? v.toLowerCase() : v;
  }

  function buildCountdown(cfg, v) {
    var labels = cfg.countdownLabels !== false;
    var units = [];
    if (cfg.countdownShowDays !== false) units.push(['d', v.d]);
    if (cfg.countdownShowHours !== false) units.push(['h', v.h]);
    if (cfg.countdownShowMinutes !== false) units.push(['m', v.m]);
    if (cfg.countdownShowSeconds !== false) units.push(['s', v.s]);
    if (units.length === 0) units.push(['d', v.d]);
    var names = { d: 'Días', h: 'Horas', m: 'Min', s: 'Seg' };
    var html = '';
    for (var i = 0; i < units.length; i++) {
      if (i > 0) html += '<span class="cd-s">:</span>';
      var u = units[i];
      // Determine if this unit should be padded
      var shouldPad = true; // Default: always pad
      if ((u[0] === 'd' || u[0] === 'h') && cfg.padZero === false) {
        // Days and Hours: don't pad when padZero is false
        shouldPad = false;
      }
      if (units.length === 1) {
        var one = (u[0] === 'd' && u[1] === 1) ? 'día' : names[u[0]];
        html += '<span class="cd-n">' + pad(u[1], shouldPad) + '</span>' + (labels ? '<span class="cd-l">' + one + '</span>' : '');
      } else {
        html += '<span class="cd-b"><span class="cd-n">' + pad(u[1], shouldPad) + '</span>' + (labels ? '<span class="cd-l">' + names[u[0]] + '</span>' : '') + '</span>';
      }
    }
    return html;
  }

  function weatherIcon(code) {
    if (code === 0) return '☀️';
    if (code === 1 || code === 2) return '🌤️';
    if (code === 3) return '☁️';
    if (code === 45 || code === 48) return '🌫️';
    if (code >= 51 && code <= 57) return '🌦️';
    if (code >= 61 && code <= 67) return '🌧️';
    if (code >= 71 && code <= 77) return '🌨️';
    if (code >= 80 && code <= 82) return '🌦️';
    if (code >= 85 && code <= 86) return '🌨️';
    if (code >= 95) return '⛈️';
    return '🌡️';
  }

  function weatherText(code) {
    if (code === 0) return 'Despejado';
    if (code === 1) return 'Mayormente despejado';
    if (code === 2) return 'Parcialmente nublado';
    if (code === 3) return 'Nublado';
    if (code === 45 || code === 48) return 'Niebla';
    if (code >= 51 && code <= 57) return 'Llovizna';
    if (code >= 61 && code <= 67) return 'Lluvia';
    if (code >= 71 && code <= 77) return 'Nieve';
    if (code >= 80 && code <= 82) return 'Chubascos';
    if (code >= 85 && code <= 86) return 'Chubascos de nieve';
    if (code === 95) return 'Tormenta';
    if (code >= 96) return 'Tormenta fuerte';
    return '';
  }

  function buildWeather(cfg) {
    var w = weather;
    var unit = (C.weather && C.weather.unit) || 'celsius';
    var city = (C.weather && C.weather.city) || '';
    var res = cfg.resourceId ? resById(cfg.resourceId) : null;
    if (res && res.type === 'weather') {
      w = weatherByRes[cfg.resourceId] || null;
      unit = res.unit || 'celsius';
      city = res.city || '';
    }
    var parts = [];
    if (cfg.showWeatherIcon !== false) parts.push('<span class="w-ic">' + (w ? w.icon : '🌡️') + '</span>');
    if (cfg.showWeatherTemp !== false) {
      var isF = unit === 'fahrenheit';
      var val = w ? (isF ? w.tempF : w.tempC) : null;
      parts.push('<span class="w-tp">' + (val != null ? Math.round(val) + '°' + (isF ? 'F' : 'C') : '--°') + '</span>');
    }
    if (cfg.showWeatherCity !== false) parts.push('<span class="w-ct">' + (city ? esc(city) : '') + '</span>');
    if (cfg.showWeatherCondition !== false) parts.push('<span class="w-cn">' + (w && w.text ? esc(w.text) : '') + '</span>');
    return parts.join(' ');
  }

  function renderContent(r) {
    var cfg = r.cfg;
    var inner = r.inner;
    switch (cfg.type) {
      case 'text':
        inner.innerHTML = esc(fillTokens(cfg.text)).split('\n').join('<br>');
        break;
      case 'clock':
        inner.textContent = buildClock(cfg);
        break;
      case 'ampm':
        inner.textContent = buildAmpm(cfg);
        break;
      case 'countdown':
        inner.innerHTML = buildCountdown(cfg, r.cd || cdValues(cfg.countdownTarget));
        break;
      case 'weather':
        inner.innerHTML = buildWeather(cfg);
        break;
      case 'image':
        if (!r.domImg) {
          var img = document.createElement('img');
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'contain';
          img.src = cfg.imageSrc || '';
          inner.appendChild(img);
          r.domImg = img;
        }
        break;
    }
  }

  function renderEl(r) {
    var cfg = r.cfg;
    var bgSynced = cfg.condition && cfg.condition.type === 'background';
    var fade = bgSynced && C.backgroundFade && (C.transition || 0.8) > 0;
    var visible = cfg.enabled !== false && condPass(cfg.condition, r.cd);
    if (!visible) {
      if (fade) {
        r.el.style.display = '';
        r.el.style.transition = 'opacity ' + (C.transition || 0.8) + 's ease-in-out';
        r.el.style.opacity = '0';
      } else {
        r.el.style.display = 'none';
        r.el.style.transition = '';
        r.el.style.opacity = '';
      }
      return;
    }
    if (!applyStyle(r)) return;
    if (fade) {
      r.el.style.transition = 'opacity ' + (C.transition || 0.8) + 's ease-in-out';
      r.el.style.opacity = '1';
    } else {
      r.el.style.transition = '';
      r.el.style.opacity = '';
    }
    renderContent(r);
    if (cfg.fitText === true) fitTextToBox(r);
  }

  /* ---------- Ajuste automático de texto al cuadro ---------- */
  // Reduce el tamaño de letra (nunca por debajo de 6px) hasta que el contenido
  // quepa dentro del cuadro del elemento (ancho y alto) cuando fitText está activo.
  function fitTextToBox(r) {
    var inner = r.inner;
    if (!inner) return;
    var maxFs = parseFloat(inner.style.fontSize) || (r.cfg && r.cfg.fontSize) || 12;
    var minFs = 6;
    var pad = 1;
    if (maxFs <= minFs) return;
    inner.style.fontSize = maxFs + 'px';
    if (inner.scrollHeight <= inner.clientHeight + pad && inner.scrollWidth <= inner.clientWidth + pad) return;
    var best = minFs;
    var low = minFs;
    var high = maxFs;
    for (var i = 0; i < 8; i++) {
      var mid = (low + high) / 2;
      inner.style.fontSize = mid + 'px';
      if (inner.scrollHeight <= inner.clientHeight + pad && inner.scrollWidth <= inner.clientWidth + pad) {
        best = mid;
        low = mid;
      } else {
        high = mid;
      }
    }
    inner.style.fontSize = best + 'px';
  }

  function buildElements() {
    layersEl = byId('layers');
    var items = C.elements || [];
    for (var i = 0; i < items.length; i++) {
      var cfg = items[i];
      var el = document.createElement('div');
      el.className = 'el';
      el.id = 'el-' + cfg.id;
      el.style.zIndex = cfg.zIndex || 1;
      var inner = document.createElement('div');
      inner.className = 'el-inner';
      el.appendChild(inner);
      layersEl.appendChild(el);
      els.push({ cfg: cfg, el: el, inner: inner, cd: null, domImg: null });
    }
  }

  /* ---------- Clima (Open-Meteo, sin API key) ---------- */
  function fetchWeatherFor(lat, lon, unit, city, resId) {
    var isF = unit === 'fahrenheit';
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat +
      '&longitude=' + lon + '&current_weather=true&forecast_days=1' +
      (isF ? '&temperature_unit=fahrenheit' : '');
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var j = JSON.parse(xhr.responseText);
          var cw = j.current_weather;
          if (cw) {
            var tempRaw = parseFloat(cw.temperature);
            var obj = {
              tempC: isF ? (tempRaw - 32) * 5 / 9 : tempRaw,
              tempF: isF ? tempRaw : tempRaw * 9 / 5 + 32,
              temp: isF ? tempRaw : tempRaw,
              code: cw.weathercode,
              icon: weatherIcon(cw.weathercode),
              text: weatherText(cw.weathercode),
              city: city || ''
            };
            if (resId) weatherByRes[resId] = obj;
            else weather = obj;
            tick();
          }
        } catch (e) {}
      }
    };
    xhr.onerror = function () {};
    xhr.send();
  }

  function usesWeatherTokens() {
    var items = C.elements || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.type === 'text' && it.text &&
        /{(temp|temp_c|temp_f|city|condition|condition_icon)}/.test('' + it.text)) {
        return true;
      }
      if (it.type === 'text' && it.text &&
        /.(temp|temp_c|temp_f|city|condition|condition_icon)}/.test('' + it.text)) {
        return true;
      }
    }
    return false;
  }

  function fetchWeather() {
    var needsGlobal = false;
    var wantsTokens = usesWeatherTokens();
    var seen = {};
    for (var i = 0; i < els.length; i++) {
      var cfg = els[i].cfg;
      if (cfg.type === 'weather') {
        if (cfg.resourceId) {
          if (!seen[cfg.resourceId]) {
            seen[cfg.resourceId] = 1;
            var res = resById(cfg.resourceId);
            if (res && res.type === 'weather' && res.lat != null && res.lon != null) {
              fetchWeatherFor(res.lat, res.lon, res.unit || 'celsius', res.city || '', cfg.resourceId);
            }
          }
        } else {
          needsGlobal = true;
        }
      }
    }
    if (wantsTokens) {
      var rarr = C.resources || [];
      for (var rx = 0; rx < rarr.length; rx++) {
        var rr = rarr[rx];
        if (rr.type === 'weather' && !seen[rr.id] && rr.lat != null && rr.lon != null) {
          seen[rr.id] = 1;
          fetchWeatherFor(rr.lat, rr.lon, rr.unit || 'celsius', rr.city || '', rr.id);
        }
      }
    }
    if (needsGlobal || wantsTokens) {
      fetchWeatherFor(
        C.weather && C.weather.lat != null ? C.weather.lat : -12.0464,
        C.weather && C.weather.lon != null ? C.weather.lon : -77.0428,
        C.weather && C.weather.unit ? C.weather.unit : 'celsius',
        (C.weather && C.weather.city) || '',
        null
      );
    }
  }

  /* ---------- Datos desde API externas (Recursos) ---------- */
  var cacheKey = 'rta_cache_' + (C.projectId || 'ad');
  function apiCacheGet(res) {
    if (!res || !res.cache) return null;
    try {
      var raw = localStorage.getItem(cacheKey + '_' + res.id);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function apiCacheSet(res, j) {
    if (!res || !res.cache) return;
    try { localStorage.setItem(cacheKey + '_' + res.id, JSON.stringify(j)); } catch (e) {}
  }
  function applyApiFields(res, j) {
    if (!res || !j) return;
    var fields = res.fields || [];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f && f.token) {
        var val = jsonPath(j, f.path);
        apiData[f.token] = val;
        var key = f.token;
        if (!(key in apiPrev)) {
          apiPrev[key] = val;
        } else {
          var same = JSON.stringify(apiPrev[key]) === JSON.stringify(val);
          apiPrev[key] = val;
          if (!same) apiChangedAt[key] = Date.now();
        }
      }
    }
  }
  function fetchApiResource(res) {
    if (!res || !res.url) return;
    var cached = apiCacheGet(res);
    if (cached != null) {
      applyApiFields(res, cached);
      tick();
    }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', res.url, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var j;
          if (res.type === 'sheet') {
            var text = xhr.responseText;
            var jsonText = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
            var rawJson = JSON.parse(jsonText);
            
            var datos = rawJson.table.rows.map(function(row) {
              var obj = {};
              rawJson.table.cols.forEach(function(col, i) {
                var cell = row.c[i];
                var val = cell ? (cell.f !== undefined ? cell.f : (cell.v !== null ? cell.v : "")) : "";
                if (col && col.label) {
                  if (col.label === "Foto" && typeof val === "string" && val.indexOf("drive.google.com") !== -1) {
                    var match = val.match(/id=([^&]+)/) || val.match(/file/d/([^/]+)/);
                    if (match && match[1]) {
                      val = "https://lh3.googleusercontent.com/d/" + match[1];
                    }
                  }
                  if (col.label.indexOf("Nombre y cargo") !== -1 && typeof val === "string") {
                    var partes = val.split("-");
                    obj["SoloNombre"] = partes[0] ? partes[0].trim() : val;
                    obj["SoloCargo"] = partes[1] ? "- " + partes[1].trim() : "";
                  }
                  obj[col.label] = val;
                }
              });
              return obj;
            });
            
            datos = datos.filter(function(item) {
              return item["Permitido"] && String(item["Permitido"]).toUpperCase() === "TRUE";
            });
            
            if (datos.length > 0) {
              var rotKey = 'mi_rotador_' + res.id;
              var baseIdx = parseInt(localStorage.getItem(rotKey) || '0', 10) % datos.length;
              localStorage.setItem(rotKey, (baseIdx + 1).toString());
              
              var rotador = [];
              for (var i = 0; i < datos.length; i++) {
                var idx = (baseIdx + i) % datos.length;
                rotador.push(datos[idx]);
              }
              j = rotador;
            } else {
              j = datos;
            }
          } else {
            j = JSON.parse(xhr.responseText);
          }
          applyApiFields(res, j);
          apiCacheSet(res, j);
          tick();
        } catch (e) {
          console.error('Error parseando JSON API/Sheet', e);
        }
      }
    };
    xhr.onerror = function () {};
    xhr.send();
  }

  function fetchApis() {
    var arr = C.resources || [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].type === 'api' || arr[i].type === 'sheet') fetchApiResource(arr[i]);
    }
  }

  /* ---------- Bucle principal ---------- */
  function tick() {
    var i;
    var rarr = C.resources || [];
    cdByRes = {};
    for (i = 0; i < rarr.length; i++) {
      if (rarr[i].type === 'countdown') cdByRes[rarr[i].id] = cdValues(rarr[i].target);
    }
    for (i = 0; i < els.length; i++) {
      if (els[i].cfg.type === 'countdown') {
        var tgt = els[i].cfg.countdownTarget;
        var res = els[i].cfg.resourceId ? resById(els[i].cfg.resourceId) : null;
        if (res && res.type === 'countdown' && res.target) tgt = res.target;
        els[i].cd = cdValues(tgt);
      }
    }
    cd.active = false; cd.d = 0; cd.h = 0; cd.m = 0; cd.s = 0;
    for (i = 0; i < els.length; i++) {
      if (els[i].cfg.type === 'countdown') { cd = els[i].cd || cd; break; }
    }
    syncBgs();
    for (i = 0; i < els.length; i++) renderEl(els[i]);
  }

  function init() {
    var ri;
    resources = {};
    var resArr = C.resources || [];
    for (ri = 0; ri < resArr.length; ri++) resources[resArr[ri].id] = resArr[ri];
    stageEl = byId('stage');
    scaleStage();
    setupBg();
    buildElements();
    fetchWeather();
    fetchApis();
    setInterval(tick, 1000);
    setInterval(fetchWeather, Math.max(1, (C.weather && C.weather.refresh) ? C.weather.refresh : 15) * 60000);
    setInterval(fetchApis, Math.max(1, C.apiRefreshMin || 1) * 1000);
    window.addEventListener('resize', function () {
      scaleStage();
      if (typeof onMediaResizeBg === 'function') onMediaResizeBg();
      tick();
    });
    tick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();