'use strict';

/* Texte du message WhatsApp, construit côté serveur à partir des valeurs validées
   et du prix recalculé : rien ne vient tel quel du navigateur. Sobre, sans emoji, une info par ligne. */

var P = require('../assets/pricing.js');
var WA = require('../assets/whatsapp.js');
var V = require('./validate');

var HELLO = 'Bonjour Fast Driver, je souhaite réserver :';

function oneLine(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

function finish(lines, d) {
  lines.push('Nom : ' + d.prenom + ' ' + d.nom + ' · Tél : ' + d.tel);
  var c = oneLine(d.commentaire);
  if (c) lines.push('Commentaire : ' + c);
  var text = lines.join('\n');
  return { text: text, url: WA.link(text, false) };
}

/* d : données validées de /api/booking ; route/price : recalculés par le serveur (null si indisponibles). */
function bookingMessage(ref, d, o) {
  var lines = [
    HELLO,
    'Réservation ' + ref,
    'Service : ' + (d.mode === 'colis' ? 'Colis' : 'Course'),
    'Départ : ' + o.from,
    'Arrivée : ' + o.to,
    'Date : ' + V.frDateLong(d.date) + ' à ' + V.frTime(d.time)
  ];
  if (d.mode === 'course') lines.push('Bagages : ' + o.bagages);
  lines.push('Distance : ' + (o.route ? P.fmtKm(o.route.distanceKm) + ' km' : 'à confirmer') +
    ' · Prix estimatif : ' + (o.price ? P.fmtEur(o.price.total) : 'à confirmer'));
  return finish(lines, d);
}

function madMessage(ref, d) {
  var lines = [
    HELLO,
    'Réservation ' + ref,
    'Service : Mise à disposition',
    'Nombre de véhicules : ' + d.nb_vehicules,
    'Date : ' + V.frDateLong(d.date),
    'Horaires : de ' + V.frTime(d.heure_debut) + ' à ' + V.frTime(d.heure_fin),
    'Lieu : ' + d.lieu,
    'Durée : ' + d.duree,
    'Type de prestation : ' + d.type
  ];
  if (d.societe) lines.push('Société : ' + d.societe);
  return finish(lines, { prenom: d.prenom, nom: d.nom, tel: d.tel, commentaire: d.details });
}

module.exports = { bookingMessage: bookingMessage, madMessage: madMessage };
