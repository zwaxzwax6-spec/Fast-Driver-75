/* Fast Driver 75 — mini-carte du trajet (chargée à la demande, après Leaflet).
   Tracé qui se dessine (~1,2 s), puis une moto parcourt la route en boucle. */
(function () {
  'use strict';

  var L = window.L;
  var DRAW_MS = 1200, RIDE_MS = 4000, PAUSE_MS = 1500, FADE_MS = 300;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var MOTO_SVG = '<svg viewBox="0 0 34 34" aria-hidden="true">' +
    '<circle cx="8" cy="23" r="5.2"/><circle cx="26" cy="23" r="5.2"/>' +
    '<circle cx="8" cy="23" r="1.3" style="fill:#141414;stroke:none"/><circle cx="26" cy="23" r="1.3" style="fill:#141414;stroke:none"/>' +
    '<path d="M8 23 13 16h8.5l3-4.5H28" style="fill:none"/>' +
    '<path d="M26 23 22.5 12.5M13 16l-2.5-3.5H6.5M21.5 16l-1.5 7h-7" style="fill:none"/>' +
    '<path d="M14 12.5c.8-2.2 2.4-3.5 4.5-3.5h2.5" style="fill:none"/>' +
    '</svg>';

  var map = null, tiles = null, layers = [], moto = null, motoEl = null, raf = 0;
  var pts = [], cum = [], total = 0, latlngs = [], failCb = null, tileOk = 0;

  function pin(cls) {
    return L.divIcon({ className: 'fd-pin', html: '<span class="dot ' + cls + '"></span>', iconSize: [16, 16], iconAnchor: [8, 8] });
  }

  function ensureMap(container) {
    if (map) return;
    map = L.map(container, {
      zoomControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false, boxZoom: false,
      keyboard: false, doubleClickZoom: true, zoomSnap: 0.25, attributionControl: true
    });
    map.attributionControl.setPrefix(false);
    // Tuiles OSM standard (gratuites, sans clé), passées en niveaux de gris en CSS.
    // Les tuiles CARTO exigent désormais une clé (filigrane « API KEY REQUIRED »).
    tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, className: 'fd-tiles',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);
    tiles.on('tileload', function () { tileOk++; });
    tiles.on('tileerror', function () { if (!tileOk && failCb) failCb(); });
    map.on('zoomend', function () { buildPath(); if (reduced) placeStatic(); });
  }

  function clear() {
    cancelAnimationFrame(raf);
    layers.forEach(function (l) { map.removeLayer(l); });
    layers = [];
    moto = motoEl = null;
  }

  /* Longueurs cumulées de la polyligne, en pixels de calque (recalculées à chaque zoom). */
  function buildPath() {
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

  /* Cap lissé : direction entre deux points de part et d'autre sur la route. */
  function headingAt(d) {
    var a = pointAt(d - 8), b = pointAt(d + 8);
    return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  }

  function placeMoto(d, opacity) {
    moto.setLatLng(map.layerPointToLatLng(pointAt(d)));
    var deg = headingAt(d);
    var flip = Math.abs(deg) > 90 ? ' scaleY(-1)' : '';
    motoEl.style.transform = 'rotate(' + deg.toFixed(1) + 'deg)' + flip;
    motoEl.style.opacity = opacity == null ? 1 : opacity;
  }

  function placeStatic() { if (moto) placeMoto(total / 2, 1); }

  function ease(t) { return 0.5 - Math.cos(Math.PI * t) / 2; }

  function ride(start) {
    var cycle = RIDE_MS + PAUSE_MS;
    function frame(now) {
      var t = (now - start) % cycle;
      var d = t < RIDE_MS ? ease(t / RIDE_MS) * total : total;
      var op = 1;
      if (t < FADE_MS) op = t / FADE_MS;
      else if (t > cycle - FADE_MS) op = (cycle - t) / FADE_MS;
      placeMoto(d, op);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }

  function draw(paths, done) {
    if (reduced) { done(); return; }
    paths.forEach(function (p) {
      var el = p.getElement(), len = el.getTotalLength();
      el.style.transition = 'none';
      el.style.strokeDasharray = len + ' ' + len;
      el.style.strokeDashoffset = len;
    });
    paths[0].getElement().getBoundingClientRect(); // reflow
    paths.forEach(function (p) {
      var el = p.getElement();
      el.style.transition = 'stroke-dashoffset ' + DRAW_MS + 'ms cubic-bezier(.45,.05,.3,1)';
      el.style.strokeDashoffset = '0';
    });
    setTimeout(function () {
      paths.forEach(function (p) {
        var el = p.getElement();
        if (!el) return;
        el.style.transition = 'none';
        el.style.strokeDasharray = 'none';
        el.style.strokeDashoffset = '0';
      });
      done();
    }, DRAW_MS + 40);
  }

  var drawToken = 0;

  window.FDMap = {
    show: function (container, geometry, opts) {
      failCb = opts && opts.onFail;
      ensureMap(container);
      map.invalidateSize();
      clear();
      var token = ++drawToken;
      latlngs = geometry.coordinates.map(function (c) { return L.latLng(c[1], c[0]); });
      map.fitBounds(L.latLngBounds(latlngs), { padding: [34, 34], animate: false });

      var style = { lineCap: 'round', lineJoin: 'round', interactive: false, smoothFactor: 0.3 };
      var halo = L.polyline(latlngs, L.extend({ color: '#141414', weight: 12, opacity: 0.12, className: 'fd-route fd-halo' }, style)).addTo(map);
      var line = L.polyline(latlngs, L.extend({ color: '#141414', weight: 4, opacity: 1, className: 'fd-route fd-line' }, style)).addTo(map);
      var a = L.marker(latlngs[0], { icon: pin('g'), interactive: false, keyboard: false, zIndexOffset: 500 }).addTo(map);
      var b = L.marker(latlngs[latlngs.length - 1], { icon: pin('r'), interactive: false, keyboard: false, zIndexOffset: 500 }).addTo(map);
      moto = L.marker(latlngs[0], {
        icon: L.divIcon({ className: 'fd-moto', html: '<div class="mt">' + MOTO_SVG + '</div>', iconSize: [34, 34], iconAnchor: [17, 17] }),
        interactive: false, keyboard: false, zIndexOffset: 1000
      }).addTo(map);
      motoEl = moto.getElement().querySelector('.mt');
      motoEl.style.opacity = 0;
      layers = [halo, line, a, b, moto];
      buildPath();

      draw([halo, line], function () {
        if (token !== drawToken || !moto) return;
        if (reduced) placeStatic();
        else ride(performance.now());
      });
    },
    stop: function () {
      drawToken++;
      if (map) clear();
    }
  };
})();
