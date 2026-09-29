'use strict';

var MAX_BODY = 32 * 1024;

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === 'string') return Promise.resolve(parse(req.body));
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

/* Enveloppe commune : POST uniquement, JSON, erreurs propres (jamais de pile). */
function postHandler(fn) {
  return async function (req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, { ok: false, error: 'Méthode non autorisée.' });
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

module.exports = { send: send, readJson: readJson, HttpError: HttpError, postHandler: postHandler, origin: origin };
