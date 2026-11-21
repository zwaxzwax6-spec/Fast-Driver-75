'use strict';

/* L'itinéraire du calculateur : celui de l'appli. La fonction `devis` du serveur de l'appli (Supabase), celle que l'appli
   appelle, géocode les mêmes adresses et calcule la même distance et le même prix du trajet (grille en vigueur).
   Demandée à une heure de jour et sans bagage : la nuit et les bagages sont ajoutés par le site (FDPricing.priceWithTrajet).
   Appelée côté serveur seulement (la clé anon ne part jamais dans la page). Sans réponse : une erreur, jamais un autre prix. */
var P = require('../assets/pricing.js');
var envMod = require('./env');
var geo = require('./geo');
var route = require('./route');

var TIMEOUT_MS = 10000;
var INDISPONIBLE = 'Calcul du prix indisponible pour le moment.';

function DevisError(status, message, code) { this.status = status; this.message = message; this.code = code; }

/* Demain à 12:00 (Paris) : une prise en charge toujours permise, au tarif de jour. */
function demainMidi() {
  return { type: 'plus_tard', date: P.todayParis(new Date(Date.now() + 24 * 3600 * 1000)), heure: '12:00' };
}

/* Le trajet seul : les lignes de distance du devis (jamais celles des bagages ou de la nuit). */
function trajetDe(lignes) {
  var l = lignes.filter(function (x) { return x && x.key !== 'bagage' && x.key !== 'nuit'; });
  return { cents: l.reduce(function (s, x) { return s + Math.round(x.amount * 100); }, 0), lignes: l };
}

/* Mode local (tests, MOCK_EXTERNAL=1) : le même calcul sur le géocodage et les itinéraires simulés du site. */
async function local(mode, depart, arrivee) {
  var pts;
  try { pts = await Promise.all([geo.geocodeIdf(depart), geo.geocodeIdf(arrivee)]); } catch (e) {
    if (e instanceof geo.GeoError) throw new DevisError(e.code === 'unavailable' ? 503 : 400, e.message, e.code);
    throw e;
  }
  var r;
  try { r = await route.getRoute(pts[0], pts[1]); } catch (e) {
    if (e instanceof route.RouteError) throw new DevisError(503, INDISPONIBLE, e.code);
    throw e;
  }
  var p = P.computePrice({ mode: mode, km: r.distanceKm });
  return { distanceKm: r.distanceKm, durationMin: r.durationMin, geometry: r.geometry, trajet: trajetDe(p.lines) };
}

/* { distanceKm, durationMin, geometry, trajet: { cents, lignes } } pour deux adresses choisies dans la liste. */
async function itineraire(mode, depart, arrivee) {
  if (envMod.isMock()) return local(mode, depart, arrivee);
  var url = envMod.env('FD_SUPABASE_URL', ''), cle = envMod.env('FD_SUPABASE_ANON_KEY', '');
  if (!url || !cle) throw new DevisError(503, INDISPONIBLE, 'config');
  var r, j;
  try {
    r = await fetch(url.replace(/\/+$/, '') + '/functions/v1/devis', {
      method: 'POST',
      headers: { apikey: cle, authorization: 'Bearer ' + cle, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: mode, depart: { libelle: depart }, arrivee: { libelle: arrivee }, bagage: 'aucun', quand: demainMidi() }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    j = await r.json().catch(function () { return null; });
  } catch (e) {
    console.error('[devis] serveur de l’appli injoignable', e && e.message);
    throw new DevisError(503, INDISPONIBLE, 'unavailable');
  }
  if (r.status === 400 && j && j.erreur) throw new DevisError(400, j.erreur, j.code);
  if (r.status !== 200 || !j || !isFinite(j.distanceKm) || !Array.isArray(j.lignes)) {
    console.error('[devis] réponse inattendue', r.status, j && (j.code || j.erreur));
    throw new DevisError(503, INDISPONIBLE, (j && j.code) || 'unavailable');
  }
  return { distanceKm: j.distanceKm, durationMin: j.durationMin, geometry: j.geometry, trajet: trajetDe(j.lignes) };
}

module.exports = { itineraire: itineraire, DevisError: DevisError };
