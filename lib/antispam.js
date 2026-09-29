'use strict';

var MIN_FILL_MS = 3000;

/* true = robot probable : on répond 200 sans rien envoyer. */
function isSpam(body, now) {
  if (body.website) return true; // honeypot
  var t0 = Number(body.t0);
  if (!isFinite(t0) || t0 <= 0) return true;
  return (now || Date.now()) - t0 < MIN_FILL_MS;
}

module.exports = { isSpam: isSpam, MIN_FILL_MS: MIN_FILL_MS };
