/* Fast Driver 75 — lien WhatsApp prérempli vers Fast Driver.
   Fichier partagé : navigateur (window.FDWhatsApp) et fonctions serveur (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FDWhatsApp = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PHONE = '33766139850';

  /* wa.me sur mobile (ouvre l'application), WhatsApp Web sur ordinateur. */
  function link(text, desktop) {
    var t = encodeURIComponent(text);
    return desktop
      ? 'https://web.whatsapp.com/send?phone=' + PHONE + '&text=' + t
      : 'https://wa.me/' + PHONE + '?text=' + t;
  }

  /* nav = navigator. L'iPad se présente comme un Mac : on le reconnaît à l'écran tactile. */
  function isDesktop(nav) {
    var ua = (nav && nav.userAgent) || '';
    if (/Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua)) return false;
    if (/Macintosh/.test(ua) && nav.maxTouchPoints > 1) return false;
    // Tablette Android en « version pour ordinateur » : UA Linux + écran tactile (Chromebook exclu).
    if (/Linux/.test(ua) && !/CrOS/.test(ua) && nav.maxTouchPoints > 1) return false;
    if (nav && nav.userAgentData && nav.userAgentData.mobile === true) return false; // signal mobile en plus
    return true;
  }

  return { PHONE: PHONE, link: link, isDesktop: isDesktop };
});
