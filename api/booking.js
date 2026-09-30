'use strict';

var P = require('../assets/pricing.js');
var http = require('../lib/http');
var V = require('../lib/validate');
var antispam = require('../lib/antispam');
var geo = require('../lib/geo');
var route = require('../lib/route');
var T = require('../lib/templates');
var notifyWithRef = require('../lib/notify').notifyWithRef;
var W = require('../lib/whatsapp');

var LABEL = { course: 'Course', colis: 'Colis' };

function priceView(price) {
  if (!price) return { unavailable: true };
  return {
    lines: price.lines.map(function (l) { return { label: l.label, amountText: P.fmtEur(l.amount) }; }),
    totalText: P.fmtEur(price.total)
  };
}

module.exports = http.postHandler(async function (body, req) {
  if (antispam.isSpam(body)) return { body: { ok: true } };

  var v = new V.Validator(body);
  v.field('mode', { oneOf: ['course', 'colis'] })
    .field('from', { max: 200, requiredMsg: 'Choisissez l’adresse de départ dans la liste.' })
    .field('to', { max: 200, requiredMsg: 'Choisissez l’adresse d’arrivée dans la liste.' })
    .field('date', { max: 10, check: V.checkDate })
    .field('time', { max: 5, check: V.checkTime })
    .field('bagages', { required: false, max: 1, check: function (x) { return /^[0-3]$/.test(x) ? null : 'Entre 0 et 3 bagages.'; }, map: Number });
  V.contact(v).field('commentaire', { multiline: true, required: false, max: 1000 });
  if (!v.ok()) throw new http.HttpError(400, 'Certains champs sont à corriger.', { errors: v.errors });
  var d = v.data;
  var bagages = d.mode === 'course' ? (d.bagages || 0) : 0;

  var pickup = P.checkPickup(d.date, d.time);
  if (pickup.error) {
    throw new http.HttpError(422, P.PICKUP_MESSAGES[pickup.error], { errors: { time: P.PICKUP_MESSAGES[pickup.error] } });
  }

  // Adresses re-géocodées et itinéraire recalculé côté serveur : rien ne vient du navigateur.
  var from = d.from, to = d.to, price = null, routeInfo = null, verified = false;
  var places = await Promise.all([d.from, d.to].map(function (label) {
    return geo.geocodeIdf(label).catch(function (e) { return e; });
  }));
  var errs = {};
  ['from', 'to'].forEach(function (k, i) {
    var p = places[i];
    if (p instanceof geo.GeoError && (p.code === 'outside' || p.code === 'notfound' || p.code === 'invalid')) errs[k] = p.message;
  });
  if (Object.keys(errs).length) throw new http.HttpError(400, 'Certains champs sont à corriger.', { errors: errs });

  if (!(places[0] instanceof geo.GeoError) && !(places[1] instanceof geo.GeoError)) {
    from = places[0].label;
    to = places[1].label;
    verified = true;
    try {
      routeInfo = await route.getRoute(places[0], places[1]);
      price = P.computePrice({ mode: d.mode, km: routeInfo.distanceKm, bagages: bagages, night: pickup.night });
    } catch (e) {
      if (!(e instanceof route.RouteError)) throw e;
      console.error('[booking] itinéraire indisponible', e.code);
    }
  }

  var when = V.frDateLong(d.date) + ' à ' + V.frTime(d.time);
  var name = d.prenom + ' ' + d.nom;
  var view = priceView(price);
  http.checkLimit(req, 'booking', http.FORM_LIMIT);
  var ref = await notifyWithRef(req, function (ref) {
    var subject = '[' + LABEL[d.mode] + '] ' + ref + ' · ' + V.frDate(d.date) + ' à ' + V.frTime(d.time) + ' · ' + name + ' · ' +
      (price ? P.fmtEur(price.total) : 'prix à confirmer');
    var rows = [
      ['Réservation', ref],
      ['Type', d.mode === 'course' ? 'Course taxi moto (personne)' : 'Livraison de colis'],
      ['Départ', from],
      ['Arrivée', to],
      ['Prise en charge', when + (pickup.night ? ' (nuit)' : '')],
      ['Distance routière', routeInfo ? P.fmtKm(routeInfo.distanceKm) + ' km · environ ' + routeInfo.durationMin + ' min' : 'à confirmer']
    ];
    if (d.mode === 'course') rows.push(['Bagages', String(bagages)]);
    rows.push(['Nom', name], ['Téléphone', d.tel], ['E-mail', d.email], ['Commentaire', d.commentaire]);
    return {
      staff: {
        subject: subject,
        replyTo: d.email,
        kicker: LABEL[d.mode] + ' · ' + ref,
        title: (d.mode === 'course' ? 'Course' : 'Colis') + ' le ' + when,
        intro: 'Demande envoyée depuis le calculateur du site. Le client est redirigé vers WhatsApp pour l’envoyer avec le numéro ' + ref + '. Prix recalculé par le serveur.',
        rows: rows,
        price: view,
        note: 'Prix estimatif. Le tarif définitif est à confirmer au client.',
        buttons: [
          { label: 'Appeler', href: 'tel:' + V.telHref(d.tel) },
          { label: 'Répondre', href: 'mailto:' + d.email + '?subject=' + encodeURIComponent('Re: ' + subject) },
          { label: 'Voir l’itinéraire', href: T.mapsUrl(from, to) }
        ]
      },
      client: {
        // Gabarit fixe : aucun texte libre saisi (nom, commentaire) n'est renvoyé à l'adresse fournie.
        to: d.email,
        subject: 'Votre demande ' + (d.mode === 'course' ? 'de course' : 'de livraison') + ' du ' + V.frDate(d.date) + ' · Fast Driver 75',
        kicker: 'Demande reçue',
        title: 'Votre demande est bien reçue.',
        intro: 'Fast Driver vous confirme rapidement le tarif définitif.',
        // Adresses reprises seulement si elles viennent du géocodeur (jamais le texte brut saisi).
        rows: rows.slice(0, 6).filter(function (r) { return verified || (r[0] !== 'Départ' && r[0] !== 'Arrivée'); }),
        price: view,
        note: 'Prix estimatif. Le tarif définitif vous est confirmé par Fast Driver.'
      }
    };
  });

  return {
    body: {
      ok: true,
      price: price ? { total: price.total, totalText: P.fmtEur(price.total) } : null,
      from: from, to: to, when: when,
      ref: ref,
      whatsapp: W.bookingMessage(ref, d, { from: from, to: to, bagages: bagages, route: routeInfo, price: price })
    }
  };
});
