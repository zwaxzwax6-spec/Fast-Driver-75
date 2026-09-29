'use strict';

var ratelimit = require('./ratelimit');

var MAX_BODY = 32 * 1024;

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function readJson(req) {
  var pre;
  try { pre = req.body; } catch (e) { return Promise.reject(new HttpError(400, 'Requête invalide.')); } // Vercel : JSON mal formé
  if (pre && typeof pre === 'object' && !Buffer.isBuffer(pre)) return Promise.resolve(pre);
  if (typeof pre === 'string') return Promise.resolve(parse(pre));
  return new Promise(function (resolve, reject) {
    var size = 0, chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Requête trop volumineuse.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      try { resolve(parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function parse(s) {
  try {
    var o = JSON.parse(s || '{}');
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error();
    return o;
  } catch (e) {
    throw new HttpError(400, 'Requête invalide.');
  }
}

function HttpError(status, message, extra) {
  this.status = status;
  this.message = message;
  this.extra = extra;
}

/* Les appels viennent du site lui-même : une origine étrangère est refusée. */
function sameOrigin(req) {
  var h = req.headers || {};
  if (!h.origin) return true;
  try {
    var host = h['x-forwarded-host'] || h.host;
    return new URL(h.origin).host === host;
  } catch (e) { return false; }
}

/* Enveloppe commune : POST uniquement, même origine, limite par IP, JSON, erreurs propres. */
function postHandler(fn, limit) {
  return async function (req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, { ok: false, error: 'Méthode non autorisée.' });
    }
    if (!sameOrigin(req)) return send(res, 403, { ok: false, error: 'Origine non autorisée.' });
    if (limit && !ratelimit.allow(req, limit.scope, limit.max, limit.windowMs)) {
      res.setHeader('Retry-After', String(Math.ceil(limit.windowMs / 1000)));
      return send(res, 429, { ok: false, error: 'Trop de demandes. Réessayez dans quelques minutes ou contactez-nous sur WhatsApp.' });
    }
    try {
      var body = await readJson(req);
      var out = await fn(body, req);
      send(res, out.status || 200, out.body);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, Object.assign({ ok: false, error: e.message }, e.extra || {}));
      console.error('[api]', e && e.stack || e);
      send(res, 500, { ok: false, error: 'Une erreur est survenue. Réessayez ou contactez-nous sur WhatsApp.' });
    }
  };
}

function origin(req) {
  var h = req.headers || {};
  var host = h['x-forwarded-host'] || h.host || 'localhost';
  var proto = h['x-forwarded-proto'] || (/^localhost|^127\./.test(host) ? 'http' : 'https');
  return proto + '://' + host;
}

var FORM_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 };

/* Pour les formulaires : appelé juste avant l'envoi, pour que les erreurs de saisie ne consomment pas le quota. */
function checkLimit(req, scope, limit) {
  if (!ratelimit.allow(req, scope, limit.max, limit.windowMs)) {
    throw new HttpError(429, 'Trop de demandes. Réessayez dans quelques minutes ou contactez-nous sur WhatsApp.');
  }
}

module.exports = { FORM_LIMIT: FORM_LIMIT, checkLimit: checkLimit, send: send, readJson: readJson, HttpError: HttpError, postHandler: postHandler, origin: origin };
