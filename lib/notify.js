'use strict';

var mail = require('./mail');
var envMod = require('./env');
var http = require('./http');
var T = require('./templates');

function logoUrl(req) {
  return envMod.isMock() ? http.origin(req) + '/assets/logo.png' : T.PROD_LOGO;
}

/* Envoie l'e-mail interne, puis la confirmation client si le domaine est vérifié.
   Un échec de la confirmation client n'annule pas la demande. */
async function notify(req, staff, client) {
  var logo = logoUrl(req);
  var s = T.render(Object.assign({ logoUrl: logo }, staff));
  try {
    await mail.sendMail({ subject: staff.subject, html: s.html, text: s.text, replyTo: staff.replyTo });
  } catch (e) {
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
}

module.exports = { notify: notify };
