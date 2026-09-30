/* Fast Driver 75 — mini-carte du trajet (chargée à la demande, après Leaflet).
   Séquence : fondu de la carte → départ (halo) → tracé dégradé + caméra synchronisés (1,4 s)
   → arrivée (halo) → pastille distance/durée en compteur → boucle traînée lumineuse + pastille moto.
   Animations en transform/opacity uniquement, requestAnimationFrame, pause hors écran / onglet masqué.

   Icône moto : Tabler Icons « motorbike » v3.48.0 — MIT License, Copyright (c) 2020-2026 Paweł Kuna.
   https://github.com/tabler/tabler-icons/blob/main/LICENSE */
(function () {
  'use strict';

  var L = window.L;
  var FADE_IN_MS = 300, DRAW_MS = 1400, COUNT_MS = 600, FADE_OUT_MS = 200;
  var LOOP_MS = 3500, PAUSE_MS = 1200, TRAIL = 0.15, TRAIL_DOTS = 32, SEGMENTS = 80;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var MOTO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M2 16a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M16 16a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/>' +
    '<path d="M7.5 14h5l4 -4h-10.5m1.5 4l4 -4"/><path d="M13 6h2l1.5 3l2 4"/></svg>';
  var PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';

  var map = null, root = null, pill = null, trailPane = null, dots = [], motoEl = null, motoIcon = null;
  var segs = [], depMarker = null, arrMarker = null;
  var latlngs = [], pts = [], cum = [], total = 0, info = null;
  var raf = 0, phase = 'idle', t0 = 0, pausedAt = 0, visible = true, token = 0, failCb = null, tileOk = 0, first = true, runState = '';

  /* ---------- Outils ---------- */
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function grey(t) { // gris clair (#D0D0D0) → noir (#141414)
    var v = Math.round(lerp(208, 20, t));
    return 'rgb(' + v + ',' + v + ',' + v + ')';
  }
  function setState(s) { phase = s; if (root) root.setAttribute('data-anim', s); }
  function setRun(s) { if (s !== runState && root) { runState = s; root.setAttribute('data-run', s); } } // écrit seulement au changement
  function running() { return visible && !document.hidden; }

  function pinIcon(cls) {
    return L.divIcon({ className: 'fd-pin', html: '<span class="fd-halo ' + cls + '"></span><span class="dot ' + cls + '"></span>', iconSize: [16, 16], iconAnchor: [8, 8] });
  }

  function ensureMap(container) {
    if (map) return;
    root = container;
    map = L.map(container, {
      zoomControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false, boxZoom: false,
      keyboard: false, doubleClickZoom: true, zoomSnap: 0.25, attributionControl: true,
      renderer: L.svg({ padding: 2 }) // tracé visible pendant tout le vol de caméra
    });
    map.attributionControl.setPrefix(false);
    // Tuiles OSM standard (gratuites, sans clé), en niveaux de gris via CSS.
    var tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, className: 'fd-tiles',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);
    tiles.on('tileload', function () { tileOk++; });
    tiles.on('tileerror', function () { if (!tileOk && failCb) failCb(); });

    // Traînée + moto : calque à nous, positions en translate3d.
    trailPane = map.createPane('fdTrail');
    trailPane.style.zIndex = 650;
    trailPane.style.pointerEvents = 'none';
    for (var i = 0; i < TRAIL_DOTS; i++) {
      var d = L.DomUtil.create('div', 'fd-spark', trailPane);
      var k = i / (TRAIL_DOTS - 1);
      d.innerHTML = '<i style="transform:scale(' + (1 - k * 0.7).toFixed(2) + ')"></i>';
      d.dataset.k = k;
      dots.push(d);
    }
    motoEl = L.DomUtil.create('div', 'fd-moto', trailPane);
    motoEl.innerHTML = '<span class="fd-moto-in">' + MOTO_SVG + '</span>';
    motoIcon = motoEl.firstChild;
    hideTrail();

    pill = L.DomUtil.create('div', 'fd-pill', container);
    pill.innerHTML = PIN_SVG + '<span class="fd-pill-t"></span>';

    map.on('moveend', function () { buildPath(); if (phase === 'static') placeStatic(); }); // tout zoom se termine aussi par moveend

    var io = new IntersectionObserver(function (es) { visible = es[es.length - 1].isIntersecting; resumeOrPause(); }, { threshold: 0.05 });
    io.observe(container);
    document.addEventListener('visibilitychange', resumeOrPause);
  }

  /* ---------- Géométrie en pixels (recalculée à chaque zoom) ---------- */
  function buildPath() {
    if (!latlngs.length) return;
    pts = latlngs.map(function (ll) { return map.latLngToLayerPoint(ll); });
    cum = [0];
    for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    total = cum[cum.length - 1];
  }
  function pointAt(d) {
    d = Math.max(0, Math.min(total, d));
    var lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    var seg = cum[hi] - cum[lo] || 1, t = (d - cum[lo]) / seg;
    return L.point(pts[lo].x + (pts[hi].x - pts[lo].x) * t, pts[lo].y + (pts[hi].y - pts[lo].y) * t);
  }

  /* Découpe l'itinéraire en morceaux de longueur égale (en mètres), teintés du gris clair au noir :
     le tracé se révèle en opacité seule, avec un vrai dégradé le long de la route. */
  function buildSegments() {
    var m = [0];
    for (var i = 1; i < latlngs.length; i++) m.push(m[i - 1] + latlngs[i].distanceTo(latlngs[i - 1]));
    var len = m[m.length - 1] || 1, n = SEGMENTS, j = 0;
    function at(dist) {
      while (j < m.length - 2 && m[j + 1] < dist) j++;
      var s = m[j + 1] - m[j] || 1, t = Math.max(0, Math.min(1, (dist - m[j]) / s));
      return L.latLng(lerp(latlngs[j].lat, latlngs[j + 1].lat, t), lerp(latlngs[j].lng, latlngs[j + 1].lng, t));
    }
    var out = [];
    for (var s = 0; s < n; s++) {
      var a = len * s / n, b = len * (s + 1) / n;
      var part = [s === 0 ? latlngs[0] : at(a)];
      for (var q = 1; q < m.length - 1; q++) if (m[q] > a && m[q] < b) part.push(latlngs[q]);
      part.push(s === n - 1 ? latlngs[latlngs.length - 1] : at(b));
      var pl = L.polyline(part, { color: grey(s / (n - 1)), weight: 4, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false, smoothFactor: 0.3, className: 'fd-seg' }).addTo(map);
      pl.getElement().style.opacity = 0;
      out.push(pl);
    }
    return out;
  }
  function revealSegments(p) {
    var n = segs.length;
    for (var i = 0; i < n; i++) {
      var el = segs[i].getElement();
      if (el) el.style.opacity = Math.max(0, Math.min(1, p * n - i)).toFixed(3);
    }
  }

  /* ---------- Traînée lumineuse + pastille moto ---------- */
  function hideTrail() { dots.forEach(function (d) { d.style.opacity = 0; }); if (motoEl) motoEl.style.opacity = 0; }
  function placeTrail(head, alpha) {
    var span = total * TRAIL;
    for (var i = 0; i < dots.length; i++) {
      var k = +dots[i].dataset.k, d = head - span * k;
      L.DomUtil.setPosition(dots[i], pointAt(d));
      dots[i].style.opacity = d < 0 ? 0 : ((1 - k) * 0.95 * alpha).toFixed(3);
    }
    var p = pointAt(head), a = pointAt(head - 6), b = pointAt(head + 6);
    L.DomUtil.setPosition(motoEl, p);
    motoIcon.style.transform = b.x < a.x - 0.5 ? 'scaleX(-1)' : 'scaleX(1)';
    motoEl.style.opacity = alpha.toFixed(3);
  }
  function placeStatic() {
    if (!total) return;
    placeTrail(total / 2, 1);
    dots.forEach(function (d) { d.style.opacity = 0; });
  }

  /* ---------- Pastille distance / durée ---------- */
  function pillText(k) {
    var P = window.FDPricing;
    pill.lastChild.textContent = P.fmtKm(info.km * k) + ' km · ' + Math.round(info.min * k) + ' min';
  }

  /* ---------- Boucle rAF unique, pilotée par la phase ---------- */
  function frame(now) {
    raf = 0;
    if (!running()) { pausedAt = pausedAt || now; setRun('paused'); return; }
    setRun('running');
    var t = now - t0;
    if (phase === 'draw') {
      revealSegments(easeInOut(Math.min(1, t / DRAW_MS)));
      if (t >= DRAW_MS) { revealSegments(1); arrive(now); }
    } else if (phase === 'count') {
      pillText(easeInOut(Math.min(1, t / COUNT_MS)));
      if (t >= COUNT_MS) { pillText(1); setState('loop'); t0 = now; }
    } else if (phase === 'loop') {
      var c = t % (LOOP_MS + PAUSE_MS);
      if (c < LOOP_MS) placeTrail(easeInOut(c / LOOP_MS) * total, Math.min(1, c / 250));
      else placeTrail(total, Math.max(0, 1 - (c - LOOP_MS) / 300));
    } else return;
    raf = requestAnimationFrame(frame);
  }
  function kick() {
    if (!raf && running() && ['draw', 'count', 'loop'].indexOf(phase) !== -1) raf = requestAnimationFrame(frame);
  }
  function resumeOrPause() {
    if (!root) return;
    if (running()) {
      if (pausedAt) { t0 += performance.now() - pausedAt; pausedAt = 0; }
      kick();
    } else {
      if (!pausedAt) pausedAt = performance.now();
      cancelAnimationFrame(raf); raf = 0;
      setRun('paused');
    }
  }

  function arrive(now) {
    if (arrMarker) arrMarker.getElement().classList.add('on'); // d. arrivée + halo
    pill.classList.add('on');                                // e. pastille en verre + compteur
    setState('count');
    t0 = now;
  }

  function addMarkers() {
    depMarker = L.marker(latlngs[0], { icon: pinIcon('g'), interactive: false, keyboard: false, zIndexOffset: 500 }).addTo(map);
    arrMarker = L.marker(latlngs[latlngs.length - 1], { icon: pinIcon('r'), interactive: false, keyboard: false, zIndexOffset: 500 }).addTo(map);
  }

  function clearRoute() {
    segs.forEach(function (s) { map.removeLayer(s); });
    segs = [];
    [depMarker, arrMarker].forEach(function (m) { if (m) map.removeLayer(m); });
    depMarker = arrMarker = null;
    hideTrail();
    pill.classList.remove('on');
  }

  /* c. → e. : tracé + caméra synchronisés (même durée), puis arrivée, compteur, boucle. */
  function play(my, bounds) {
    if (my !== token) return;
    clearRoute();
    buildPath();
    addMarkers();
    segs = buildSegments();
    requestAnimationFrame(function () { if (depMarker) depMarker.getElement().classList.add('on'); });
    map.flyToBounds(bounds, { padding: [34, 34], duration: DRAW_MS / 1000, easeLinearity: 0.35 });
    setState('draw');
    t0 = performance.now();
    pausedAt = running() ? 0 : t0; // carte hors écran ou onglet masqué : le tracé attendra d'être visible
    kick();
  }

  function showStatic(bounds) {
    clearRoute();
    map.fitBounds(bounds, { padding: [34, 34], animate: false });
    buildPath();
    addMarkers();
    depMarker.getElement().classList.add('on');
    arrMarker.getElement().classList.add('on');
    segs = buildSegments();
    revealSegments(1);
    pillText(1);
    pill.classList.add('on');
    setState('static');
    placeStatic();
  }

  window.FDMap = {
    /* opts : { km, min, onFail() } */
    show: function (container, geometry, opts) {
      opts = opts || {};
      failCb = opts.onFail;
      ensureMap(container);
      map.invalidateSize();
      var my = ++token;
      cancelAnimationFrame(raf); raf = 0;
      latlngs = geometry.coordinates.map(function (c) { return L.latLng(c[1], c[0]); });
      info = { km: opts.km || 0, min: opts.min || 0 };
      var bounds = L.latLngBounds(latlngs);

      if (reduced) {
        root.classList.add('rm-shown');
        first = false;
        showStatic(bounds);
        return;
      }
      if (first) {
        // a. fondu d'entrée ; b. caméra centrée sur le départ, un cran plus serrée que le cadrage final.
        first = false;
        var z = Math.min(16, map.getBoundsZoom(bounds, false, L.point(68, 68)) + 1);
        map.setView(latlngs[0], z, { animate: false });
        setState('intro');
        requestAnimationFrame(function () { root.classList.add('rm-shown'); });
        setTimeout(function () { play(my, bounds); }, FADE_IN_MS);
      } else if (segs.length) {
        // Changement d'adresse : l'ancienne route s'efface en 200 ms, puis reprise à l'étape c.
        segs.forEach(function (s) { var el = s.getElement(); if (el) { el.style.transition = 'opacity ' + FADE_OUT_MS + 'ms'; el.style.opacity = 0; } });
        [depMarker, arrMarker].forEach(function (m) { if (m) m.getElement().classList.remove('on'); });
        hideTrail();
        pill.classList.remove('on');
        setState('fadeout');
        setTimeout(function () { play(my, bounds); }, FADE_OUT_MS);
      } else {
        play(my, bounds);
      }
    },
    /* Lecture seule, pour la recette : état de la caméra. */
    view: function () { return map ? { zoom: map.getZoom(), center: map.getCenter() } : null; },
    pause: function () { token++; cancelAnimationFrame(raf); raf = 0; setState('idle'); },
    stop: function () {
      token++;
      cancelAnimationFrame(raf); raf = 0;
      if (map) { clearRoute(); setState('idle'); }
    }
  };
})();
