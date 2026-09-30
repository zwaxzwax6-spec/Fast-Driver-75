'use strict';

var fs = require('fs');
var path = require('path');
var envMod = require('./env');
var P = require('../assets/pricing.js');

// api.openrouteservice.org est déprécié : même service, même clé, même requête sur api.heigit.org.
var ORS_URL = 'https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson';

function RouteError(code, message) { this.code = code; this.message = message; }

function metres(a, b) { // haversine, [lon, lat]
  var R = 6371008.8, rad = Math.PI / 180;
  var dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* Douglas-Peucker (tolérance en mètres, projection équirectangulaire locale). */
function simplify(coords, tol) {
  if (coords.length < 3) return coords.slice();
  var k = Math.cos(coords[0][1] * Math.PI / 180) * 111320;
  function xy(p) { return [p[0] * k, p[1] * 110574]; }
  var keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  var stack = [[0, coords.length - 1]];
  while (stack.length) {
    var seg = stack.pop(), i0 = seg[0], i1 = seg[1];
    var a = xy(coords[i0]), b = xy(coords[i1]);
    var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1e-9;
    var dmax = 0, idx = -1;
    for (var i = i0 + 1; i < i1; i++) {
      var p = xy(coords[i]);
      var d = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > tol) { keep[idx] = 1; stack.push([i0, idx], [idx, i1]); }
  }
  return coords.filter(function (_, i) { return keep[i]; });
}

var fixtures = null;
function loadFixtures() {
  if (fixtures) return fixtures;
  var dir = path.join(__dirname, 'fixtures');
  fixtures = ['paris1-paris15.json', 'paris-orly.json'].map(function (f) {
    return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  });
  return fixtures;
}

/* Mock local : fixture enregistrée si les 2 points sont proches de ses extrémités
   (dans un sens ou dans l'autre), sinon route synthétique « en L » (mock uniquement). */
function mockRoute(from, to) {
  var A = [from.lon, from.lat], B = [to.lon, to.lat];
  var list = loadFixtures();
  for (var i = 0; i < list.length; i++) {
    var fx = list[i], s = [fx.from.lon, fx.from.lat], e = [fx.to.lon, fx.to.lat];
    var fwd = metres(A, s) < 1500 && metres(B, e) < 1500;
    var rev = metres(A, e) < 1500 && metres(B, s) < 1500;
    if (fwd || rev) {
      var c = fx.geometry.coordinates.slice();
      if (rev) c.reverse();
      return { distanceM: fx.distance_m, durationS: fx.duration_s, coords: c, source: 'mock:' + fx.name };
    }
  }
  var mid = [B[0], A[1]], steps = 8, coords = [];
  for (var t = 0; t <= steps; t++) coords.push([A[0] + (mid[0] - A[0]) * t / steps, A[1]]);
  for (t = 1; t <= steps; t++) coords.push([B[0], A[1] + (B[1] - A[1]) * t / steps]);
  var dist = 0;
  for (var j = 1; j < coords.length; j++) dist += metres(coords[j - 1], coords[j]);
  return { distanceM: dist, durationS: dist / (25 / 3.6), coords: coords, source: 'mock:synthetic' };
}

/* Un appel ORS. radiuses [-1, -1] : accroche à la route la plus proche sans limite de distance
   (aéroports, gares, grands sites dont le point d'adresse est loin d'une voie). */
async function orsOnce(key, from, to) {
  var r;
  try {
    r = await fetch(ORS_URL, {
      method: 'POST',
      headers: { 'Authorization': key, 'Content-Type': 'application/json', 'Accept': 'application/geo+json' },
      body: JSON.stringify({ coordinates: [[from.lon, from.lat], [to.lon, to.lat]], radiuses: [-1, -1] }),
      signal: AbortSignal.timeout(6000)
    });
  } catch (e) {
    throw new RouteError('unavailable', 'Calcul d\u2019itinéraire indisponible.');
  }
  if (!r.ok) {
    console.error('[ors] HTTP', r.status);
    // 5xx : panne passagère (nouvelle tentative utile) ; 4xx : requête refusée, inutile de recommencer.
    throw new RouteError(r.status >= 500 ? 'unavailable' : (r.status === 404 ? 'noroute' : 'rejected'), 'Calcul d\u2019itinéraire indisponible.');
  }
  var j = await r.json().catch(function () { return null; });
  var f = j && j.features && j.features[0];
  if (!f || !f.geometry || !f.geometry.coordinates || f.geometry.coordinates.length < 2) {
    throw new RouteError('noroute', 'Aucun itinéraire trouvé.');
  }
  var sum = (f.properties && f.properties.summary) || {};
  return { distanceM: sum.distance || 0, durationS: sum.duration || 0, coords: f.geometry.coordinates, source: 'ors' };
}

/* En cas d'échec passager (réseau, délai, 5xx), une seule nouvelle tentative ; ensuite seulement,
   erreur propre (jamais de prix inventé). « Aucun itinéraire » ou 4xx échoueraient à l'identique. */
async function orsRoute(from, to) {
  var key = envMod.env('ORS_API_KEY', '');
  if (!key) throw new RouteError('unavailable', 'Calcul d\u2019itinéraire indisponible.');
  try {
    return await orsOnce(key, from, to);
  } catch (e) {
    if (!(e instanceof RouteError) || e.code !== 'unavailable') throw e;
    await new Promise(function (ok) { setTimeout(ok, 400); });
    return orsOnce(key, from, to);
  }
}

/* Cache mémoire (par instance) : un même trajet ne consomme pas deux fois le quota ORS. */
var cache = new Map();
var CACHE_TTL = 3600 * 1000, CACHE_MAX = 300;
function cacheKey(from, to) {
  return (envMod.isMock() ? 'mock:' : 'ors:') + [from.lon, from.lat, to.lon, to.lat].map(function (x) { return Number(x).toFixed(5); }).join(',');
}

/* Itinéraire routier : { distanceKm (0,1 km), durationMin, geometry (GeoJSON LineString) }. */
async function getRoute(from, to) {
  var key = cacheKey(from, to), hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;
  var value = await computeRoute(from, to);
  cache.delete(key);
  cache.set(key, { at: Date.now(), value: value });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return value;
}

async function computeRoute(from, to) {
  var raw = envMod.isMock() ? mockRoute(from, to) : await orsRoute(from, to);
  var coords = simplify(raw.coords.map(function (c) { return [+c[0].toFixed(6), +c[1].toFixed(6)]; }), 3);
  return {
    distanceKm: P.roundKm(raw.distanceM / 1000),
    durationMin: Math.max(1, Math.round(raw.durationS / 60)),
    geometry: { type: 'LineString', coordinates: coords },
    source: raw.source
  };
}

module.exports = { getRoute: getRoute, RouteError: RouteError, simplify: simplify, metres: metres };
