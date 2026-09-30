'use strict';

var P = require('../assets/pricing.js');
var Places = require('../assets/places.js');

var API = 'https://api-adresse.data.gouv.fr/search/';

function GeoError(code, message) { this.code = code; this.message = message; }

/* Re-géocode une adresse choisie côté client : le serveur ne croit pas les coordonnées reçues. */
async function geocodeIdf(label) {
  if (!label || label.length < 3) throw new GeoError('invalid', 'Adresse manquante.');
  // Destination pré-réglée (aéroport, gare…) : coordonnées de dépose-minute issues d'OSM, sans géocodage.
  var preset = Places.byLabel(label);
  if (preset) return { label: preset.label, postcode: preset.postcode, lon: preset.lon, lat: preset.lat, preset: preset.id };
  var url = API + '?limit=1&q=' + encodeURIComponent(label.slice(0, 200));
  var r;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  } catch (e) {
    throw new GeoError('unavailable', 'Service d’adresses indisponible.');
  }
  if (!r.ok) throw new GeoError('unavailable', 'Service d’adresses indisponible.');
  var j;
  try { j = await r.json(); } catch (e) { throw new GeoError('unavailable', 'Service d’adresses indisponible.'); }
  var f = j && j.features && j.features[0];
  if (!f) throw new GeoError('notfound', 'Adresse introuvable.');
  var p = f.properties || {};
  var c = f.geometry && f.geometry.coordinates;
  if (!c || !isFinite(c[0]) || !isFinite(c[1]) || !p.label) throw new GeoError('unavailable', 'Service d’adresses indisponible.');
  if (!P.isIdfPostcode(p.postcode)) throw new GeoError('outside', 'Adresse hors Île-de-France');
  return { label: p.label, postcode: p.postcode, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
}

/* Boîte englobante large de l'Île-de-France, pour les coordonnées reçues par /api/quote. */
function inIdfBox(lon, lat) {
  return typeof lon === 'number' && typeof lat === 'number' && lon > 1.4 && lon < 3.6 && lat > 48.1 && lat < 49.25;
}

module.exports = { geocodeIdf: geocodeIdf, inIdfBox: inIdfBox, GeoError: GeoError };
