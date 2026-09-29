'use strict';

var envMod = require('./env');

/* Limiteur mémoire par IP (par instance de fonction). Complément d'une règle WAF Vercel,
   pas un remplacement. Inactif en mode local (mock) pour les tests de bout en bout. */
var buckets = new Map();
var MAX_KEYS = 5000;

function clientIp(req) {
  var h = req.headers || {};
  var xff = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || h['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function allow(req, scope, max, windowMs) {
  if (envMod.isMock()) return true;
  var key = scope + '|' + clientIp(req);
  var now = Date.now();
  var list = (buckets.get(key) || []).filter(function (t) { return now - t < windowMs; });
  if (list.length >= max) { buckets.set(key, list); return false; }
  list.push(now);
  buckets.delete(key);
  buckets.set(key, list);
  if (buckets.size > MAX_KEYS) buckets.delete(buckets.keys().next().value);
  return true;
}

module.exports = { allow: allow, clientIp: clientIp };
