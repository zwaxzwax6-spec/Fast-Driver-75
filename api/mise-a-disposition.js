'use strict';

var P = require('../assets/pricing.js');
var http = require('../lib/http');
var V = require('../lib/validate');
var antispam = require('../lib/antispam');
var notify = require('../lib/notify').notify;

var TYPES = ['événement', 'entreprise', 'groupe', 'autre'];

function todayParis() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: P.TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

module.exports = http.postHandler(async function (body, req) {
  if (antispam.isSpam(body)) return { body: { ok: true } };

  var v = new V.Validator(body);
  v.field('nb_vehicules', { max: 2, check: function (x) { return /^\d+$/.test(x) && +x >= 2 && +x <= 50 ? null : 'Entre 2 et 50 véhicules.'; }, map: Number })
    .field('date', { max: 10, check: function (x) { return V.checkDate(x) || (x < todayParis() ? 'Cette date est déjà passée.' : null); } })
    .field('heure_debut', { max: 5, check: V.checkTime })
    .field('heure_fin', { max: 5, check: V.checkTime })
    .field('lieu', { max: 200 })
    .field('duree', { max: 100 })
    .field('type', { oneOf: TYPES })
    .field('details', { required: false, max: 2000 });
  V.contact(v).field('societe', { required: false, max: 120 });
  if (!v.ok()) throw new http.HttpError(400, 'Certains champs sont à corriger.', { errors: v.errors });
  var d = v.data;
  var name = d.prenom + ' ' + d.nom;
  var subject = '[Mise à dispo] Demande de devis : ' + d.nb_vehicules + ' véhicules le ' + V.frDate(d.date);
  var rows = [
    ['Nombre de véhicules', String(d.nb_vehicules)],
    ['Date', V.frDateLong(d.date)],
    ['Horaires', 'de ' + V.frTime(d.heure_debut) + ' à ' + V.frTime(d.heure_fin)],
    ['Lieu', d.lieu],
    ['Durée de mise à disposition', d.duree],
    ['Type de prestation', d.type],
    ['Détails', d.details],
    ['Nom', name],
    ['Société', d.societe],
    ['Téléphone', d.tel],
    ['E-mail', d.email]
  ];

  await notify(req, {
    subject: subject,
    replyTo: d.email,
    kicker: 'Mise à disposition',
    title: 'Demande de devis : ' + d.nb_vehicules + ' véhicules le ' + V.frDateLong(d.date),
    intro: 'Demande envoyée depuis l’onglet « Plusieurs véhicules » du site.',
    rows: rows,
    buttons: [
      { label: 'Appeler', href: 'tel:' + V.telHref(d.tel) },
      { label: 'Répondre', href: 'mailto:' + d.email + '?subject=' + encodeURIComponent('Re: ' + subject) }
    ]
  }, {
    to: d.email,
    subject: 'Votre demande de devis · Fast Driver 75',
    kicker: 'Demande reçue',
    title: 'Merci ' + d.prenom + ', votre demande est bien reçue.',
    intro: 'Nous revenons vers vous avec un devis personnalisé.',
    rows: rows.slice(0, 7)
  });

  return { body: { ok: true } };
});
