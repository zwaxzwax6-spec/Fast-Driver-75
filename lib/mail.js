'use strict';

var fs = require('fs');
var path = require('path');
var envMod = require('./env');

var RESEND_URL = 'https://api.resend.com/emails';
var DEFAULT_FROM = 'Fast Driver <onboarding@resend.dev>';
var KEY_TTL_MS = 24 * 3600 * 1000; // durée de vie d'une clé d'idempotence chez Resend

/* config : erreur de configuration (destinataire ou clé absents), jamais traitée comme une panne passagère. */
function MailError(message, config) { this.message = message; this.config = !!config; }
/* Clé d'idempotence déjà utilisée par un autre envoi (numéro de réservation déjà attribué). */
function KeyTakenError(key) { this.message = 'Clé déjà utilisée : ' + key; this.key = key; }

function config() {
  return {
    from: envMod.env('EMAIL_FROM', DEFAULT_FROM),
    to: envMod.env('EMAIL_TO', ''),
    confirmClient: envMod.env('RESEND_DOMAIN_VERIFIED', 'false') === 'true'
  };
}

function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase();
}

/* En mock : écrit le payload complet (en-têtes + HTML + texte) dans test-output/emails/.
   Idempotence simulée comme chez Resend : même clé + autre contenu = refus ; même clé + même contenu = même envoi. */
function writeMock(payload, key) {
  var dir = path.join(process.cwd(), 'test-output', 'emails');
  fs.mkdirSync(dir, { recursive: true });
  if (key) {
    var kdir = path.join(dir, 'keys'), kfile = path.join(kdir, key.replace(/[^\w-]/g, '_'));
    fs.mkdirSync(kdir, { recursive: true });
    var body = JSON.stringify(payload), prev = null;
    try { prev = JSON.parse(fs.readFileSync(kfile, 'utf8')); } catch (e) { /* clé libre */ }
    if (prev && Date.now() - prev.t < KEY_TTL_MS) {
      if (prev.body !== body) throw new KeyTakenError(key);
      return { id: 'mock-idempotent' };
    }
    fs.writeFileSync(kfile, JSON.stringify({ t: Date.now(), body: body }));
  }
  var base = new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 6) + '-' + slug(payload.subject);
  fs.writeFileSync(path.join(dir, base + '.json'), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(dir, base + '.html'), payload.html);
  fs.writeFileSync(path.join(dir, base + '.txt'), payload.text);
  return { id: 'mock-' + base, file: path.join(dir, base + '.json') };
}

async function sendMail(msg) {
  var cfg = config();
  var to = msg.to || cfg.to;
  if (!to) throw new MailError('Destinataire non configuré.', true);
  var payload = {
    from: cfg.from,
    to: [to],
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    reply_to: msg.replyTo,
    headers: { 'X-Entity-Ref-ID': msg.ref || String(Date.now()) }
  };
  if (envMod.isMock()) return writeMock(payload, msg.idempotencyKey);

  var key = envMod.env('RESEND_API_KEY', '');
  if (!key) throw new MailError('Envoi d’e-mail indisponible.', true);
  var headers = { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };
  if (msg.idempotencyKey) headers['Idempotency-Key'] = msg.idempotencyKey;
  var r;
  try {
    r = await fetch(RESEND_URL, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
  } catch (e) {
    throw new MailError('Envoi d’e-mail indisponible.');
  }
  if (r.status === 409 && msg.idempotencyKey) {
    // invalid_idempotent_request / concurrent_idempotent_requests : clé prise par un autre envoi (24 h chez Resend)
    throw new KeyTakenError(msg.idempotencyKey);
  }
  if (!r.ok) {
    console.error('[resend] HTTP', r.status, (await r.text()).slice(0, 300));
    // 401/403 : clé révoquée ou invalide ; 422 : domaine ou expéditeur refusé → configuration, pas une panne passagère.
    throw new MailError('Envoi d’e-mail indisponible.', r.status === 401 || r.status === 403 || r.status === 422);
  }
  return r.json();
}

module.exports = { sendMail: sendMail, config: config, MailError: MailError, KeyTakenError: KeyTakenError, DEFAULT_FROM: DEFAULT_FROM };
