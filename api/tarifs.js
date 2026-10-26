'use strict';

/* Grille et horaires en vigueur, pour la page (lecture seule) : ceux du serveur de l'appli, sinon la grille embarquée. */
var tarifs = require('../lib/tarifs');
var http = require('../lib/http');

module.exports = async function (req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return http.send(res, 405, { ok: false, error: 'Méthode non autorisée.' });
  }
  try {
    var t = await tarifs.appliquer();
    http.send(res, 200, { ok: true, grille: t.grille, horaires: t.horaires, source: t.source });
  } catch (e) {
    console.error('[tarifs]', e && e.stack || e);
    http.send(res, 500, { ok: false, error: 'Une erreur est survenue.' });
  }
};
