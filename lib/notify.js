'use strict';

var mail = require('./mail');
var envMod = require('./env');
var http = require('./http');
var T = require('./templates');
var Ref = require('./reference');

function logoUrl(req) {
  return envMod.isMock() ? http.origin(req) + '/assets/logo.png' : T.PROD_LOGO;
}

/* Envoie l'e-mail interne, puis la confirmation client si le domaine est vérifié.
   Un échec de la confirmation client n'annule pas la demande. */
async function notify(req, staff, client) {
  var logo = logoUrl(req);
  var s = T.render(Object.assign({ logoUrl: logo }, staff));
  try {
    await mail.sendMail({ subject: staff.subject, html: s.html, text: s.text, replyTo: staff.replyTo, idempotencyKey: staff.idempotencyKey, ref: staff.ref });
  } catch (e) {
    // Panne passagère de Resend : la réservation WhatsApp continue. Configuration absente : 503 visible.
    if (e instanceof mail.MailError && staff.softFail && !e.config) {
      console.error('[notify] ALERTE e-mail de sauvegarde non envoyé (réservation WhatsApp poursuivie)', staff.idempotencyKey, e.message);
      return false;
    }
    if (e instanceof mail.MailError) {
      throw new http.HttpError(503, 'Envoi impossible pour le moment. Contactez-nous sur WhatsApp au 07 66 13 98 50.');
    }
    throw e;
  }
  if (client && mail.config().confirmClient) {
    var c = T.render(Object.assign({ logoUrl: logo }, client));
    try {
      await mail.sendMail({ to: client.to, subject: client.subject, html: c.html, text: c.text, replyTo: mail.config().to });
    } catch (e) {
      console.error('[notify] confirmation client non envoyée', e && e.message);
    }
  }
  return true;
}

/* Réservation WhatsApp : attribue un numéro FD-XXXX et envoie l'e-mail de sauvegarde qui le porte.
   Le numéro est réservé de façon atomique, toutes instances confondues, par la clé d'idempotence Resend
   « fd-ref-FD-XXXX » (24 h) : s'il est déjà pris, on passe au suivant. Au-delà de 24 h, les numéros ne se
   répètent qu'après un cycle d'environ 2 ans (voir lib/reference.js). Pendant une panne de Resend,
   le numéro attribué n'est pas réservé : une autre instance pourrait, rarement, donner le même.
   build(ref) -> { staff, client }. L'e-mail n'est qu'une sauvegarde : s'il échoue, la réservation WhatsApp continue. */
var MAX_TRIES = 12;
async function notifyWithRef(req, build) {
  var tried = {};
  for (var i = 0; i < MAX_TRIES; i++) {
    // Séquence commune d'abord ; après 3 numéros pris, numéros de secours tirés au hasard.
    var ref = i < 3 ? Ref.createRef() : Ref.spareRef();
    if (tried[ref]) continue;
    tried[ref] = true;
    var b = build(ref);
    try {
      await notify(req, Object.assign({ idempotencyKey: 'fd-ref-' + ref, ref: ref, softFail: true }, b.staff), b.client);
      return ref;
    } catch (e) {
      if (!(e instanceof mail.KeyTakenError)) throw e;
    }
  }
  throw new http.HttpError(503, 'Envoi impossible pour le moment. Contactez-nous sur WhatsApp au 07 66 13 98 50.');
}

module.exports = { notify: notify, notifyWithRef: notifyWithRef };
