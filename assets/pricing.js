/* Fast Driver 75 — grille tarifaire et règles horaires.
   Fichier partagé : chargé tel quel par le navigateur (window.FDPricing)
   et par les fonctions serveur (require). Le serveur fait toujours foi. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FDPricing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TZ = 'Europe/Paris';
  var BASE_CENTS = 3000;          // 30 € jusqu'à 10 km
  var BASE_TENTHS = 100;          // 10,0 km
  var RATE_CENTS = { course: 200, colis: 180 }; // €/km au-delà de 10 km
  var BAGAGE_CENTS = 500;
  var NIGHT_CENTS = 1000;
  var MAX_BAGAGES = 3;
  var NIGHT_NOTICE_MS = 24 * 3600 * 1000;
  var IDF = ['75', '77', '78', '91', '92', '93', '94', '95'];

  function toTenths(km) { return Math.round(Number((km * 10).toFixed(6))); }
  function roundKm(km) { return toTenths(km) / 10; }

  function fmtEur(amount) {
    return amount.toFixed(2).replace('.', ',') + ' €';
  }
  function fmtKm(km) { return roundKm(km).toFixed(1).replace('.', ','); }

  function computePrice(opts) {
    var mode = opts.mode, km = Number(opts.km);
    if (!RATE_CENTS[mode]) throw new Error('mode invalide');
    if (!isFinite(km) || km < 0) throw new Error('distance invalide');
    var bagages = mode === 'course' ? Number(opts.bagages || 0) : 0;
    if (!(bagages >= 0 && bagages <= MAX_BAGAGES && bagages % 1 === 0)) throw new Error('bagages invalides');

    var t = toTenths(km);
    var lines = [{ key: 'base', label: 'Forfait jusqu’à 10 km', cents: BASE_CENTS }];
    if (t > BASE_TENTHS) {
      var rate = RATE_CENTS[mode];
      lines.push({
        key: 'km',
        label: fmtKm((t - BASE_TENTHS) / 10) + ' km au-delà de 10 km × ' + fmtEur(rate / 100).replace(' €', '') + ' €',
        cents: (t - BASE_TENTHS) * rate / 10
      });
    }
    for (var i = 0; i < bagages; i++) {
      lines.push({ key: 'bagage', label: 'Bagage ' + (i + 1), cents: BAGAGE_CENTS });
    }
    if (opts.night) lines.push({ key: 'nuit', label: 'Prise en charge de nuit (00h – 8h)', cents: NIGHT_CENTS });

    var total = 0;
    lines = lines.map(function (l) {
      var c = Math.round(l.cents);
      total += c;
      return { key: l.key, label: l.label, amount: c / 100 };
    });
    return { mode: mode, km: t / 10, bagages: bagages, night: !!opts.night, lines: lines, total: total / 100 };
  }

  var fmt = null;
  function parisParts(ms) {
    fmt = fmt || new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var p = {};
    fmt.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = Number(x.value); });
    return p;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* Décalage (ms) de Europe/Paris par rapport à UTC à l'instant donné. */
  function parisOffset(ms) {
    var p = parisParts(ms);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  }

  /* Date du jour (AAAA-MM-JJ) et heure (HH:MM) à Paris. */
  function todayParis(now) {
    var p = parisParts((now || new Date()).getTime());
    return p.year + '-' + pad(p.month) + '-' + pad(p.day);
  }
  function nowParisHm(now) {
    var p = parisParts((now || new Date()).getTime());
    return pad(p.hour) + ':' + pad(p.minute);
  }

  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

  /* Heure « murale » de Paris (date AAAA-MM-JJ, heure HH:MM) -> Date (instant UTC). */
  function parisWallToUtc(date, time) {
    var d = DATE_RE.exec(date || ''), t = TIME_RE.exec(time || '');
    if (!d || !t) return null;
    var guess = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
    var check = new Date(guess);
    if (check.getUTCMonth() !== +d[2] - 1 || check.getUTCDate() !== +d[3]) return null;
    var ms = guess - parisOffset(guess);
    ms = guess - parisOffset(ms);
    return new Date(ms);
  }

  /* Vérifie une prise en charge : nuit (00h00–07h59) et délai de 24 h. */
  function checkPickup(date, time, now) {
    var at = parisWallToUtc(date, time);
    if (!at) return { night: false, error: 'invalide', at: null };
    var hour = Number(time.slice(0, 2));
    var night = hour < 8;
    var nowMs = (now || new Date()).getTime();
    var error = null;
    if (at.getTime() <= nowMs) error = 'passe';
    else if (night && at.getTime() - nowMs < NIGHT_NOTICE_MS) error = 'nuit24h';
    return { night: night, error: error, at: at };
  }

  var PICKUP_MESSAGES = {
    invalide: 'Choisissez une date et une heure valides.',
    passe: 'Cette date est déjà passée : choisissez une heure à venir.',
    nuit24h: 'Les prises en charge entre 00h00 et 07h59 se réservent au moins 24h à l’avance.'
  };

  function isIdfPostcode(cp) {
    return typeof cp === 'string' && /^\d{5}$/.test(cp) && IDF.indexOf(cp.slice(0, 2)) !== -1;
  }

  return {
    TZ: TZ,
    MAX_BAGAGES: MAX_BAGAGES,
    computePrice: computePrice,
    roundKm: roundKm,
    fmtEur: fmtEur,
    fmtKm: fmtKm,
    parisWallToUtc: parisWallToUtc,
    checkPickup: checkPickup,
    PICKUP_MESSAGES: PICKUP_MESSAGES,
    isIdfPostcode: isIdfPostcode,
    todayParis: todayParis,
    nowParisHm: nowParisHm
  };
});
