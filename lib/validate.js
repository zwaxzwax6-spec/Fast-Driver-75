'use strict';

var EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;
var PHONE_RE = /^(?:\+33|0033|0)[1-9]\d{8}$/;
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function clean(v) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

/* Petit validateur déclaratif : chaque règle renvoie un message ou null. */
function Validator(body) {
  this.body = body || {};
  this.data = {};
  this.errors = {};
}
Validator.prototype.field = function (name, opts) {
  opts = opts || {};
  var v = clean(this.body[name]);
  var max = opts.max || 200;
  if (!v) {
    if (opts.required !== false) this.errors[name] = opts.requiredMsg || 'Champ obligatoire.';
    this.data[name] = '';
    return this;
  }
  if (v.length > max) { this.errors[name] = 'Texte trop long (' + max + ' caractères maximum).'; return this; }
  if (opts.oneOf && opts.oneOf.indexOf(v) === -1) { this.errors[name] = 'Choix invalide.'; return this; }
  if (opts.check) {
    var msg = opts.check(v);
    if (msg) { this.errors[name] = msg; return this; }
  }
  this.data[name] = opts.map ? opts.map(v) : v;
  return this;
};
Validator.prototype.ok = function () { return Object.keys(this.errors).length === 0; };

function checkEmail(v) { return EMAIL_RE.test(v) ? null : 'Adresse e-mail invalide.'; }
function normPhone(v) { return v.replace(/[\s.\-()]/g, ''); }
function checkPhone(v) { return PHONE_RE.test(normPhone(v)) ? null : 'Numéro de téléphone français invalide.'; }
function fmtPhone(v) {
  var n = normPhone(v).replace(/^(\+33|0033)/, '0');
  return n.replace(/(\d{2})(?=\d)/g, '$1 ');
}
function telHref(v) { return '+33' + normPhone(v).replace(/^(\+33|0033|0)/, ''); }
function checkDate(v) { return DATE_RE.test(v) ? null : 'Date invalide.'; }
function checkTime(v) { return TIME_RE.test(v) ? null : 'Heure invalide.'; }

/* Champs de contact communs aux 3 formulaires. */
function contact(v) {
  return v
    .field('prenom', { max: 60 })
    .field('nom', { max: 60 })
    .field('tel', { max: 25, check: checkPhone, map: fmtPhone })
    .field('email', { max: 120, check: checkEmail, map: function (x) { return x.toLowerCase(); } });
}

function frDate(iso) { // 2026-10-01 -> 01/10
  var p = iso.split('-');
  return p[2] + '/' + p[1];
}
function frDateLong(iso) { // 2026-10-01 -> 01/10/2026
  var p = iso.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}
function frTime(t) { return t.replace(':', 'h'); }

module.exports = {
  Validator: Validator, contact: contact, clean: clean,
  checkEmail: checkEmail, checkPhone: checkPhone, fmtPhone: fmtPhone, telHref: telHref,
  checkDate: checkDate, checkTime: checkTime,
  frDate: frDate, frDateLong: frDateLong, frTime: frTime
};
