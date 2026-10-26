/* Fast Driver — grille tarifaire et règles horaires.
   FICHIER GÉNÉRÉ par « npm run build:site » dans fast-driver-app (packages/core) : ne pas modifier ici.
   Chargé tel quel par le navigateur (window.FDPricing) et par les fonctions serveur (require).
   La grille vient du serveur (FDPricing.configure) ; sans réponse, la grille embarquée. Le serveur fait toujours foi. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FDPricing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
"use strict";
var __FDP = (() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/site.ts
  var site_exports = {};
  __export(site_exports, {
    BAGAGES: () => BAGAGES2,
    MAX_BAGAGES: () => MAX_BAGAGES2,
    TZ: () => TZ2,
    checkPickup: () => checkPickup2,
    computePrice: () => computePrice2,
    configure: () => configure,
    fmtEur: () => fmtEur2,
    fmtKm: () => fmtKm2,
    getGrille: () => getGrille,
    getHoraires: () => getHoraires,
    isIdfPostcode: () => isIdfPostcode2,
    nightMessage: () => nightMessage,
    nowParisHm: () => nowParisHm2,
    parisWallToUtc: () => parisWallToUtc2,
    roundKm: () => roundKm2,
    todayParis: () => todayParis2
  });

  // ../../config/grille.ts
  var GRILLE_DEFAUT = {
    forfaitCentimes: 3e3,
    forfaitDixiemesKm: 100,
    kmCentimes: { course: 200, colis: 180 },
    bagageCentimes: 500,
    nuitCentimes: 1e3
  };

  // src/pricing.ts
  var pricing_exports = {};
  __export(pricing_exports, {
    HORAIRES_DEFAUT: () => HORAIRES_DEFAUT,
    MAX_BAGAGES: () => MAX_BAGAGES,
    PICKUP_MESSAGES: () => PICKUP_MESSAGES,
    TZ: () => TZ,
    checkPickup: () => checkPickup,
    computePrice: () => computePrice,
    creneauPermis: () => creneauPermis,
    fmtEur: () => fmtEur,
    fmtKm: () => fmtKm,
    horsHoraires: () => horsHoraires,
    isIdfPostcode: () => isIdfPostcode,
    libelleNuit: () => libelleNuit,
    messageNuit: () => messageNuit,
    nowParisHm: () => nowParisHm,
    parisParts: () => parisParts,
    parisWallToUtc: () => parisWallToUtc,
    pickupMessages: () => pickupMessages,
    premierCreneauPermis: () => premierCreneauPermis,
    prixCourse: () => prixCourse,
    roundKm: () => roundKm,
    todayParis: () => todayParis
  });

  // ../../config/categories.ts
  var BAGAGES = ["aucun", "sac", "cabine", "soute"];
  var BAGAGES_PAYANTS = ["sac", "cabine"];

  // ../../config/regles.ts
  var REGLES = {
    /** Durée d'une offre de dispatch (§3.3). */
    offreSecondes: 20,
    /** Le dispatch d'une course réservée part ce délai avant l'heure (§3.2). */
    dispatchAvantMinutes: 30,
    /** L'empreinte est prise ce délai avant l'heure, ou à la réservation si la course part plus tôt (§3.4). */
    empreinteAvantHeures: 24,
    /** Hors horaires : réservation au moins ce délai à l'avance (§3.1). */
    nuitPreavisHeures: 24,
    /** Course confiée sans réponse : le gérant est prévenu après ce délai (§3.3, §12). */
    confieeSansReponseMinutes: 3,
    /** Frais d'annulation après acceptation, en % de la course, figés à la réservation (§0). */
    annulationPourcent: 50,
    /** Taux de TVA légaux, en % (§3.6). */
    tvaPourcent: { course: 10, colis: 20 },
    /** Horaires de service, réglables par le gérant ; « 00:00 » en fin vaut minuit (§3.1). */
    horaires: { debut: "08:00", fin: "00:00" },
    /** Fraîcheur maximale de la dernière position d'un chauffeur candidat (§3.3). */
    positionFraicheurSecondes: 60,
    /** Le lien de suivi partagé expire ce délai après la fin de la course (§3.9). */
    suiviExpireHeures: 24,
    /** Base de la part du chauffeur (§3.5, §12) : le prix TTC payé. */
    basePart: "ttc",
    /** Délai minimal entre deux envois du code de connexion, en secondes (§3.8). */
    renvoiCodeSecondes: 60,
    /** Fuseau de l'appli (§3.9). */
    fuseau: "Europe/Paris",
    /** Position de la ville pour la bascule jour/nuit au lever et au coucher du soleil (§3.9). */
    soleil: { lat: 48.8566, lon: 2.3522 },
    /** Valeur de départ des numéros de course FD-NNNN (§3.9) — à confirmer avec le client (RAPPORT). */
    numeroDepart: 1e3
  };

  // src/pricing.ts
  var TZ = "Europe/Paris";
  var NIGHT_NOTICE_MS = REGLES.nuitPreavisHeures * 3600 * 1e3;
  var IDF = ["75", "77", "78", "91", "92", "93", "94", "95"];
  var HORAIRES_DEFAUT = REGLES.horaires;
  function toTenths(km) {
    return Math.round(Number((km * 10).toFixed(6)));
  }
  function roundKm(km) {
    return toTenths(km) / 10;
  }
  function fmtEur(amount) {
    return amount.toFixed(2).replace(".", ",") + " €";
  }
  function fmtKm(km) {
    return roundKm(km).toFixed(1).replace(".", ",");
  }
  function validerGrille(g) {
    const nums = [g.forfaitCentimes, g.forfaitDixiemesKm, g.kmCentimes.course, g.kmCentimes.colis, g.bagageCentimes, g.nuitCentimes];
    if (!nums.every((n) => Number.isInteger(n) && n >= 0)) throw new Error("grille invalide");
  }
  function bagageDe(opts) {
    const hasNew = opts.bagage !== void 0 && opts.bagage !== null;
    const hasOld = opts.bagages !== void 0 && opts.bagages !== null;
    if (hasNew && hasOld) throw new Error("bagages invalides");
    if (hasOld) {
      const n = Number(opts.bagages);
      if (n === 0) return "aucun";
      if (n === 1) return "sac";
      throw new Error("bagages invalides");
    }
    if (!hasNew) return "aucun";
    if (typeof opts.bagage !== "string" || !BAGAGES.includes(opts.bagage)) throw new Error("bagages invalides");
    return opts.bagage;
  }
  var LIBELLE_BAGAGE = { aucun: "", sac: "Sac", cabine: "Valise cabine", soute: "Valise en soute" };
  function computePrice(opts, grille2 = GRILLE_DEFAUT, horaires2 = HORAIRES_DEFAUT) {
    validerGrille(grille2);
    const mode = opts.mode;
    if (mode !== "course" && mode !== "colis") throw new Error("mode invalide");
    const km = Number(opts.km);
    if (!isFinite(km) || km < 0) throw new Error("distance invalide");
    const choisi = bagageDe(opts);
    const bagage = mode === "course" ? choisi : "aucun";
    const t = toTenths(km);
    const lines = [
      { key: "base", label: "Forfait jusqu’à " + fmtKm(grille2.forfaitDixiemesKm / 10).replace(",0", "") + " km", cents: grille2.forfaitCentimes }
    ];
    if (t > grille2.forfaitDixiemesKm) {
      const rate = grille2.kmCentimes[mode];
      lines.push({
        key: "km",
        label: fmtKm((t - grille2.forfaitDixiemesKm) / 10) + " km au-delà de " + fmtKm(grille2.forfaitDixiemesKm / 10).replace(",0", "") + " km × " + fmtEur(rate / 100).replace(" €", "") + " €",
        cents: (t - grille2.forfaitDixiemesKm) * rate / 10
      });
    }
    if (BAGAGES_PAYANTS.includes(bagage)) lines.push({ key: "bagage", label: LIBELLE_BAGAGE[bagage], cents: grille2.bagageCentimes });
    if (opts.night) lines.push({ key: "nuit", label: libelleNuit(horaires2), cents: grille2.nuitCentimes });
    let total = 0;
    const out = lines.map((l) => {
      const c = Math.round(l.cents);
      total += c;
      return { key: l.key, label: l.label, amount: c / 100 };
    });
    return { mode, km: t / 10, bagage, night: !!opts.night, lines: out, total: total / 100 };
  }
  function prixCourse(opts, grille2, horaires2 = HORAIRES_DEFAUT) {
    const p = computePrice(opts, grille2, horaires2);
    return __spreadProps(__spreadValues({}, p), { totalCentimes: Math.round(p.total * 100) });
  }
  var fmt = null;
  function parisParts(ms) {
    fmt = fmt || new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    const p = {};
    fmt.formatToParts(new Date(ms)).forEach((x) => {
      if (x.type !== "literal") p[x.type] = Number(x.value);
    });
    return p;
  }
  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function parisOffset(ms) {
    const p = parisParts(ms);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1e3) * 1e3;
  }
  function todayParis(now) {
    const p = parisParts((now || /* @__PURE__ */ new Date()).getTime());
    return p.year + "-" + pad(p.month) + "-" + pad(p.day);
  }
  function nowParisHm(now) {
    const p = parisParts((now || /* @__PURE__ */ new Date()).getTime());
    return pad(p.hour) + ":" + pad(p.minute);
  }
  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  function parisWallToUtc(date, time) {
    const d = DATE_RE.exec(date || ""), t = TIME_RE.exec(time || "");
    if (!d || !t) return null;
    const guess = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
    const check = new Date(guess);
    if (check.getUTCMonth() !== +d[2] - 1 || check.getUTCDate() !== +d[3]) return null;
    let ms = guess - parisOffset(guess);
    ms = guess - parisOffset(ms);
    return new Date(ms);
  }
  var minutes = (hm) => {
    const m = TIME_RE.exec(hm);
    if (!m) throw new Error("heure invalide");
    return +m[1] * 60 + +m[2];
  };
  function horsHoraires(time, h = HORAIRES_DEFAUT) {
    const m = minutes(time), d = minutes(h.debut), f = minutes(h.fin) || 1440;
    if (d === f % 1440) return false;
    return f > d ? !(m >= d && m < f) : !(m >= d || m < f);
  }
  var hFr = (hm) => hm.replace(":", "h");
  var hCourt = (hm) => {
    const [hh, mm] = hm.split(":");
    return String(Number(hh)) + "h" + (mm === "00" ? "" : mm);
  };
  var veille = (hm) => {
    const m = (minutes(hm) + 1439) % 1440;
    return pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  };
  function messageNuit(h = HORAIRES_DEFAUT) {
    return "Les prises en charge entre " + hFr(h.fin) + " et " + hFr(veille(h.debut)) + " se réservent au moins " + REGLES.nuitPreavisHeures + "h à l’avance.";
  }
  function libelleNuit(h = HORAIRES_DEFAUT) {
    const fin = h.fin.endsWith(":00") ? pad(Number(h.fin.slice(0, 2))) + "h" : hFr(h.fin);
    return "Prise en charge de nuit (" + fin + " – " + hCourt(h.debut) + ")";
  }
  function checkPickup(date, time, now, h = HORAIRES_DEFAUT) {
    const at = parisWallToUtc(date, time);
    if (!at) return { night: false, error: "invalide", at: null };
    const night = horsHoraires(time, h);
    const nowMs = (now || /* @__PURE__ */ new Date()).getTime();
    let error = null;
    if (at.getTime() <= nowMs) error = "passe";
    else if (night && at.getTime() - nowMs < NIGHT_NOTICE_MS) error = "nuit24h";
    return { night, error, at };
  }
  function pickupMessages(h = HORAIRES_DEFAUT) {
    return {
      invalide: "Choisissez une date et une heure valides.",
      passe: "Cette date est déjà passée : choisissez une heure à venir.",
      nuit24h: messageNuit(h)
    };
  }
  var PICKUP_MESSAGES = pickupMessages();
  function creneauPermis(at, now, h = HORAIRES_DEFAUT) {
    const p = parisParts(at.getTime());
    const r = checkPickup(p.year + "-" + pad(p.month) + "-" + pad(p.day), pad(p.hour) + ":" + pad(p.minute), now, h);
    return r.error === null;
  }
  function premierCreneauPermis(now, h = HORAIRES_DEFAUT) {
    const pas = 5 * 6e4;
    let t = Math.ceil((now.getTime() + 15 * 6e4) / pas) * pas;
    for (let i = 0; i < 12 * 24 * 3; i++, t += pas) if (creneauPermis(new Date(t), now, h)) return new Date(t);
    throw new Error("aucun créneau");
  }
  function isIdfPostcode(cp) {
    return typeof cp === "string" && /^\d{5}$/.test(cp) && IDF.indexOf(cp.slice(0, 2)) !== -1;
  }
  var MAX_BAGAGES = 1;

  // src/site.ts
  var grille = GRILLE_DEFAUT;
  var horaires = HORAIRES_DEFAUT;
  function configure(c) {
    if (c && c.grille) {
      computePrice({ mode: "course", km: 1 }, c.grille);
      grille = c.grille;
    }
    if (c && c.horaires) {
      horsHoraires("12:00", c.horaires);
      horaires = c.horaires;
    }
  }
  function computePrice2(opts) {
    return computePrice(opts, grille, horaires);
  }
  function checkPickup2(date, time, now) {
    return checkPickup(date, time, now, horaires);
  }
  function getGrille() {
    return grille;
  }
  function getHoraires() {
    return horaires;
  }
  function nightMessage() {
    return messageNuit(horaires);
  }
  var { TZ: TZ2, roundKm: roundKm2, fmtEur: fmtEur2, fmtKm: fmtKm2, parisWallToUtc: parisWallToUtc2, isIdfPostcode: isIdfPostcode2, todayParis: todayParis2, nowParisHm: nowParisHm2, MAX_BAGAGES: MAX_BAGAGES2 } = pricing_exports;
  var BAGAGES2 = ["aucun", "sac", "cabine", "soute"];
  return __toCommonJS(site_exports);
})();

  var api = {};
  Object.keys(__FDP).forEach(function (k) { api[k] = __FDP[k]; });
  Object.defineProperty(api, 'PICKUP_MESSAGES', { enumerable: true, get: function () {
    return { invalide: 'Choisissez une date et une heure valides.', passe: 'Cette date est déjà passée : choisissez une heure à venir.', nuit24h: __FDP.nightMessage() };
  } });
  Object.defineProperty(api, 'BAGAGE_EUR', { enumerable: true, get: function () { return __FDP.getGrille().bagageCentimes / 100; } });
  return api;
});
