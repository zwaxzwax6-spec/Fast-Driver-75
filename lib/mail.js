'use strict';

var fs = require('fs');
var path = require('path');
var envMod = require('./env');

var RESEND_URL = 'https://api.resend.com/emails';
var DEFAULT_FROM = 'Fast Driver <onboarding@resend.dev>';

function MailError(message) { this.message = message; }

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

/* En mock : écrit le payload complet (en-têtes + HTML + texte) dans test-output/emails/. */
function writeMock(payload) {
  var dir = path.join(process.cwd(), 'test-output', 'emails');
  fs.mkdirSync(dir, { recursive: true });
  var base = new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 6) + '-' + slug(payload.subject);
  fs.writeFileSync(path.join(dir, base + '.json'), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(dir, base + '.html'), payload.html);
  fs.writeFileSync(path.join(dir, base + '.txt'), payload.text);
  return { id: 'mock-' + base, file: path.join(dir, base + '.json') };
}

async function sendMail(msg) {
  var cfg = config();
  var to = msg.to || cfg.to;
  if (!to) throw new MailError('Destinataire non configuré.');
  var payload = {
    from: cfg.from,
    to: [to],
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    reply_to: msg.replyTo,
    headers: { 'X-Entity-Ref-ID': msg.ref || String(Date.now()) }
  };
  if (envMod.isMock()) return writeMock(payload);

  var key = envMod.env('RESEND_API_KEY', '');
  if (!key) throw new MailError('Envoi d’e-mail indisponible.');
  var r;
  try {
    r = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
  } catch (e) {
    throw new MailError('Envoi d’e-mail indisponible.');
  }
  if (!r.ok) {
    console.error('[resend] HTTP', r.status, (await r.text()).slice(0, 300));
    throw new MailError('Envoi d’e-mail indisponible.');
  }
  return r.json();
}

module.exports = { sendMail: sendMail, config: config, MailError: MailError, DEFAULT_FROM: DEFAULT_FROM };
