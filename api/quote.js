'use strict';

var P = require('../assets/pricing.js');
var http = require('../lib/http');
var devis = require('../lib/devis');

/* L'adresse choisie dans la liste : son libellé (le serveur de l'appli la géocode, comme pour l'appli). */
function libelle(p) {
  return p && typeof p === 'object' && typeof p.label === 'string' && p.label.trim().length >= 3 ? p.label.trim().slice(0, 200) : null;
}

module.exports = http.postHandler(async function (body) {
  var mode = body.mode;
  if (mode !== 'course' && mode !== 'colis') throw new http.HttpError(400, 'Type de trajet invalide.');
  var from = libelle(body.from), to = libelle(body.to);
  if (!from || !to) throw new http.HttpError(400, 'Choisissez les adresses dans la liste');
  var bagages = mode === 'course' ? Number(body.bagages || 0) : 0;
  if (!(bagages >= 0 && bagages <= P.MAX_BAGAGES && bagages % 1 === 0)) throw new http.HttpError(400, 'Nombre de bagages invalide.');

  // La distance et le prix du trajet de l'appli (même fonction serveur, mêmes adresses) : jamais un autre calcul.
  var r;
  try {
    r = await devis.itineraire(mode, from, to);
  } catch (e) {
    if (e instanceof devis.DevisError) throw new http.HttpError(e.status, e.message, { code: e.code });
    throw e;
  }
  // Prix hors majoration de nuit : la page l'ajuste en direct selon la date et l'heure choisies.
  var price = P.priceWithTrajet({ mode: mode, km: r.distanceKm, bagages: bagages }, r.trajet);
  return {
    body: {
      ok: true,
      distanceKm: r.distanceKm,
      durationMin: r.durationMin,
      geometry: r.geometry,
      trajet: r.trajet,
      price: price
    }
  };
}, { scope: 'quote', max: 30, windowMs: 60 * 1000 });
