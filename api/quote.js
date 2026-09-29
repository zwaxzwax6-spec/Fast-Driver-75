'use strict';

var P = require('../assets/pricing.js');
var http = require('../lib/http');
var geo = require('../lib/geo');
var route = require('../lib/route');

function point(p) {
  return p && typeof p === 'object' ? { lon: Number(p.lon), lat: Number(p.lat) } : null;
}

module.exports = http.postHandler(async function (body) {
  var mode = body.mode;
  if (mode !== 'course' && mode !== 'colis') throw new http.HttpError(400, 'Type de trajet invalide.');
  var from = point(body.from), to = point(body.to);
  if (!from || !to || !geo.inIdfBox(from.lon, from.lat) || !geo.inIdfBox(to.lon, to.lat)) {
    throw new http.HttpError(400, 'Adresse hors Île-de-France');
  }
  var bagages = mode === 'course' ? Number(body.bagages || 0) : 0;
  if (!(bagages >= 0 && bagages <= P.MAX_BAGAGES && bagages % 1 === 0)) throw new http.HttpError(400, 'Nombre de bagages invalide.');

  var r;
  try {
    r = await route.getRoute(from, to);
  } catch (e) {
    if (e instanceof route.RouteError) {
      throw new http.HttpError(503, 'Calcul du prix indisponible pour le moment.', { code: e.code });
    }
    throw e;
  }
  var pickup = body.date && body.time ? P.checkPickup(String(body.date), String(body.time)) : { night: false, error: null };
  var price = P.computePrice({ mode: mode, km: r.distanceKm, bagages: bagages, night: pickup.night });
  return {
    body: {
      ok: true,
      distanceKm: r.distanceKm,
      durationMin: r.durationMin,
      geometry: r.geometry,
      price: price,
      pickup: { night: pickup.night, error: pickup.error }
    }
  };
}, { scope: 'quote', max: 30, windowMs: 60 * 1000 });
