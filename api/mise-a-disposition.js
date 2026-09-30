'use strict';

var P = require('../assets/pricing.js');
var http = require('../lib/http');
var V = require('../lib/validate');
var antispam = require('../lib/antispam');
var notifyWithRef = require('../lib/notify').notifyWithRef;
var W = require('../lib/whatsapp');

var TYPES = ['événement', 'entreprise', 'groupe', 'autre'];

module.exports = http.postHandler(async function (body, req) {
  if (antispam.isSpam(body)) return { body: { ok: true } };

  var v = new V.Validator(body);
  v.field('nb_vehicules', { max: 2, check: function (x) { return /^\d+$/.test(x) && +x >= 2 && +x <= 50 ? null : 'Entre 2 et 50 véhicules.'; }, map: Number })
    .field('date', { max: 10, check: function (x) { return V.checkDate(x) || (x < P.todayParis() ? 'Cette date est déjà passée.' : null); } })
    .field('heure_debut', { max: 5, check: V.checkTime })
    .field('heure_fin', { max: 5, check: V.checkTime })
    .field('lieu', { max: 200 })
    .field('duree', { max: 100 })
    .field('type', { oneOf: TYPES })
    .field('details', { multiline: true, required: false, max: 2000 });
  V.contact(v).field('societe', { required: false, max: 120 });
  if (!v.errors.date && !v.errors.heure_debut && v.data.date === P.todayParis() && v.data.heure_debut <= P.nowParisHm()) {
    v.errors.heure_debut = 'Cette heure est déjà passée.';
  }
  if (!v.ok()) throw new http.HttpError(400, 'Certains champs sont à corriger.', { errors: v.errors });
  var d = v.data;
  var name = d.prenom + ' ' + d.nom;
  var date = V.frDateLong(d.date), horaires = 'de ' + V.frTime(d.heure_debut) + ' à ' + V.frTime(d.heure_fin);

  http.checkLimit(req, 'mise-a-disposition', http.FORM_LIMIT);
  var ref = await notifyWithRef(req, function (ref) {
    var subject = '[Mise à dispo] ' + ref + ' · Demande de devis : ' + d.nb_vehicules + ' véhicules le ' + V.frDate(d.date);
    var rows = [
      ['Réservation', ref],
      ['Nombre de véhicules', String(d.nb_vehicules)],
      ['Date', date],
      ['Horaires', horaires],
      ['Lieu', d.lieu],
      ['Durée de mise à disposition', d.duree],
      ['Type de prestation', d.type],
      ['Détails', d.details],
      ['Nom', name],
      ['Société', d.societe],
      ['Téléphone', d.tel],
      ['E-mail', d.email]
    ];
    return {
      staff: {
        subject: subject,
        replyTo: d.email,
        kicker: 'Mise à disposition · ' + ref,
        title: 'Demande de devis : ' + d.nb_vehicules + ' véhicules le ' + date,
        intro: 'Demande envoyée depuis l’onglet « Plusieurs véhicules » du site. Le client est redirigé vers WhatsApp pour l’envoyer avec le numéro ' + ref + '.',
        rows: rows,
        buttons: [
          { label: 'Appeler', href: 'tel:' + V.telHref(d.tel) },
          { label: 'Répondre', href: 'mailto:' + d.email + '?subject=' + encodeURIComponent('Re: ' + subject) }
        ]
      },
      client: {
        // Gabarit fixe : seules des valeurs contrôlées (numéro, nombre, date, heures, type) sont reprises.
        to: d.email,
        subject: 'Votre demande de devis · Fast Driver 75',
        kicker: 'Demande reçue',
        title: 'Votre demande est bien reçue.',
        intro: 'Nous revenons vers vous avec un devis personnalisé.',
        rows: [rows[0], rows[1], rows[2], rows[3], rows[6]]
      }
    };
  });

  return {
    body: {
      ok: true, ref: ref, whatsapp: W.madMessage(ref, d),
      recap: { vehicules: String(d.nb_vehicules), date: date, horaires: horaires }
    }
  };
});
