'use strict';

/* Grille et horaires du serveur de l'appli (Supabase, RPC `tarifs`, lecture seule, sans compte).
   Lue côté serveur seulement (la clé anon ne part jamais dans la page), gardée 60 s.
   Sans variable, sans réponse ou réponse invalide : la grille embarquée de assets/pricing.js, jamais un prix inventé. */
var P = require('../assets/pricing.js');
var env = require('./env').env;

var CACHE_MS = 60 * 1000;
var TIMEOUT_MS = 2500;
// Grille et horaires embarqués, relevés avant tout `configure`.
var EMBARQUEE = { grille: P.getGrille(), horaires: P.getHoraires() };
var cache = null; // { at, valeur }

async function lireServeur() {
  var url = env('FD_SUPABASE_URL', ''), key = env('FD_SUPABASE_ANON_KEY', '');
  if (!url || !key) return null;
  try {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    var r;
    try {
      r = await fetch(url.replace(/\/+$/, '') + '/rest/v1/rpc/tarifs', {
        method: 'POST',
        headers: { apikey: key, 'content-type': 'application/json' },
        body: '{}',
        signal: ctrl ? ctrl.signal : undefined
      });
    } finally { if (timer) clearTimeout(timer); }
    if (!r || !r.ok) return null;
    var j = await r.json();
    if (!j || !j.grille || !j.horaires) return null;
    var t = { grille: j.grille, horaires: { debut: j.horaires.debut, fin: j.horaires.fin } };
    P.configure(t); // lève une erreur si la grille ou les horaires sont invalides
    return t;
  } catch (e) {
    console.error('[tarifs] grille du serveur indisponible', e && e.message);
    return null;
  }
}

/* Pose la grille en vigueur dans FDPricing et la renvoie : { grille, horaires, source: 'serveur' | 'embarquee' }. */
async function appliquer(now) {
  var t = now || Date.now();
  if (!cache || t - cache.at >= CACHE_MS) cache = { at: t, valeur: await lireServeur() };
  var v = cache.valeur;
  P.configure(v || EMBARQUEE);
  return { grille: P.getGrille(), horaires: P.getHoraires(), source: v ? 'serveur' : 'embarquee' };
}

function viderCache() { cache = null; }

module.exports = { appliquer: appliquer, viderCache: viderCache, EMBARQUEE: EMBARQUEE, CACHE_MS: CACHE_MS };
