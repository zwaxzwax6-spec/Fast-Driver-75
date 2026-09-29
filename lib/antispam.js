'use strict';

var MIN_FILL_MS = 3000;

/* true = robot probable : on répond 200 sans rien envoyer.
   `elapsed` = durée depuis le chargement de la page, mesurée par la page elle-même
   (performance.now) : insensible à une horloge de téléphone mal réglée. */
function isSpam(body) {
  if (body.website) return true; // honeypot
  var elapsed = Number(body.elapsed);
  return !isFinite(elapsed) || elapsed < MIN_FILL_MS;
}

module.exports = { isSpam: isSpam, MIN_FILL_MS: MIN_FILL_MS };
