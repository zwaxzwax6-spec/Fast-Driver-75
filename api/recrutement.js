'use strict';

var http = require('../lib/http');
var V = require('../lib/validate');
var antispam = require('../lib/antispam');
var notify = require('../lib/notify').notify;

module.exports = http.postHandler(async function (body, req) {
  if (antispam.isSpam(body)) return { body: { ok: true } };

  var v = new V.Validator(body);
  V.contact(v)
    .field('vehicule_modele', { max: 80 })
    .field('vehicule_cylindree', { max: 20 })
    .field('experience_pro', { max: 1500 })
    .field('experience_secteur', { max: 1500 })
    .field('motivations', { max: 1500 })
    .field('disponibilite', { oneOf: ['temps plein', 'temps partiel'] })
    .field('horaires', { max: 500 });
  if (!v.ok()) throw new http.HttpError(400, 'Certains champs sont à corriger.', { errors: v.errors });
  var d = v.data;
  var name = d.prenom + ' ' + d.nom;
  var subject = '[Candidature] Candidature chauffeur : ' + name;
  var rows = [
    ['Nom', d.nom],
    ['Prénom', d.prenom],
    ['Téléphone', d.tel],
    ['E-mail', d.email],
    ['Véhicule possédé', d.vehicule_modele + ' · ' + d.vehicule_cylindree],
    ['Expérience professionnelle', d.experience_pro],
    ['Expérience taxi-moto / transport / livraison / course', d.experience_secteur],
    ['Motivations', d.motivations],
    ['Disponibilité', d.disponibilite],
    ['Disponibilités / horaires', d.horaires]
  ];

  await notify(req, {
    subject: subject,
    replyTo: d.email,
    kicker: 'Candidature',
    title: 'Candidature chauffeur : ' + name,
    intro: 'Candidature envoyée depuis la page /recrutement.',
    rows: rows,
    buttons: [
      { label: 'Appeler', href: 'tel:' + V.telHref(d.tel) },
      { label: 'Répondre', href: 'mailto:' + d.email + '?subject=' + encodeURIComponent('Re: ' + subject) }
    ]
  }, {
    to: d.email,
    subject: 'Votre candidature chauffeur · Fast Driver 75',
    kicker: 'Candidature reçue',
    title: 'Merci ' + d.prenom + ', votre candidature est bien reçue.',
    intro: 'Fast Driver revient vers vous rapidement.',
    rows: rows.slice(4)
  });

  return { body: { ok: true } };
});
