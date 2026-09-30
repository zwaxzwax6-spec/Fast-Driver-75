'use strict';

/* Numéro de réservation court « FD-XXXX », partagé par le message WhatsApp et l'e-mail de sauvegarde.
   Sans base de données : un numéro par minute depuis le 01/01/2026, brouillé par une bijection sur 20 bits
   (32^4 codes, cycle d'environ 2 ans). Deux demandes dans la même minute sur la même instance prennent
   la minute suivante ; seules deux instances serveur recevant une demande dans la même minute
   pourraient produire le même numéro (l'e-mail garde de toute façon l'heure exacte). */

var ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford : sans I, L, O, U
var BITS = 20;
var MASK = (1 << BITS) - 1;
var CYCLE_MIN = 1 << BITS; // 32^4
var EPOCH_MS = Date.UTC(2026, 0, 1);

function mulMod(a, b) { return (a * b) % CYCLE_MIN; } // a, b < 2^20 : produit exact en double

/* Bijection sur [0, 2^20) : multiplications impaires + xorshift, pour que deux minutes voisines
   donnent des codes sans ressemblance. */
function scramble(x) {
  x = (mulMod(x, 0x9E3B5) + 0x5A3C7) & MASK;
  x ^= x >>> 10;
  x = mulMod(x, 0x7F4A1) & MASK;
  x ^= x >>> 7;
  x = mulMod(x, 0x3C6EF) & MASK;
  return x ^ (x >>> 11);
}

function codeForMinute(minute) {
  var x = scramble(((minute % CYCLE_MIN) + CYCLE_MIN) % CYCLE_MIN), s = '';
  for (var i = 0; i < 4; i++) { s = ALPHABET[x & 31] + s; x >>>= 5; }
  return s;
}

function generator() {
  var last = -Infinity;
  return function (now) {
    var m = Math.floor(((now == null ? Date.now() : now) - EPOCH_MS) / 60000);
    if (m <= last) m = last + 1;
    last = m;
    return 'FD-' + codeForMinute(m);
  };
}

var createRef = generator();

module.exports = { createRef: createRef, generator: generator, codeForMinute: codeForMinute, EPOCH_MS: EPOCH_MS, CYCLE_MIN: CYCLE_MIN };
