'use strict';

var P = require('../assets/pricing.js');
var http = require('../lib/http');
var geo = require('../lib/geo');
var route = require('../lib/route');
var tarifs = require('../lib/tarifs');

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
  // Bagage unique (aucun, sac, cabine, soute) ; l'ancien `bagages` (0 ou 1) reste accepté. Ignoré pour un colis.
  var bag = {};
  if (mode === 'course' && body.bagage !== undefined && body.bagage !== null && body.bagage !== '') bag.bagage = body.bagage;
  if (mode === 'course' && body.bagages !== undefined && body.bagages !== null && body.bagages !== '') bag.bagages = Number(body.bagages);
  try {
    P.computePrice(Object.assign({ mode: mode, km: 0 }, bag));
  } catch (e) {
    throw new http.HttpError(400, 'Bagage invalide.');
  }

  var r;
  try {
    r = await route.getRoute(from, to);
  } catch (e) {
    if (e instanceof route.RouteError) {
      throw new http.HttpError(503, 'Calcul du prix indisponible pour le moment.', { code: e.code });
    }
    throw e;
  }
  // Grille du serveur de l'appli (sinon la grille embarquée), renvoyée à la page pour qu'elle calcule pareil.
  var t = await tarifs.appliquer();
  // Prix hors majoration de nuit : la page l'ajuste en direct selon la date et l'heure choisies.
  var price = P.computePrice(Object.assign({ mode: mode, km: r.distanceKm }, bag));
  return {
    body: {
      ok: true,
      distanceKm: r.distanceKm,
      durationMin: r.durationMin,
      geometry: r.geometry,
      price: price,
      grille: t.grille,
      horaires: t.horaires
    }
  };
}, { scope: 'quote', max: 30, windowMs: 60 * 1000 });
