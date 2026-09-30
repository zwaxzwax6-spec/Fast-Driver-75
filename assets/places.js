/* Fast Driver 75 — destinations pré-réglées (aéroports, grandes gares, La Défense).
   Coordonnées = point de dépose-minute relevé dans OpenStreetMap (élément cité), vérifié par un calcul ORS réel.
   Fichier partagé : navigateur (window.FDPlaces) + serveur (require). Le serveur n'utilise que ces coordonnées
   quand le libellé reçu correspond exactement à une destination de cette liste. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FDPlaces = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [id, nom affiché, code postal, ville, lon, lat, élément OSM, alias de recherche]
  var DATA = [
    ["cdg-t1", "Aéroport CDG – Terminal 1", "77990", "Mauregard", 2.543026, 49.013975, "node/4146386944", "t1"],
    ["cdg-t2a", "Aéroport CDG – Terminal 2A", "93290", "Tremblay-en-France", 2.561829, 49.002902, "node/1836856174", "t2a t2"],
    ["cdg-t2c", "Aéroport CDG – Terminal 2C", "93290", "Tremblay-en-France", 2.566933, 49.003153, "node/1836856195", "t2c t2"],
    ["cdg-t2d", "Aéroport CDG – Terminal 2D", "77990", "Le Mesnil-Amelot", 2.56678, 49.004381, "node/1892302761", "t2d t2"],
    ["cdg-t2e", "Aéroport CDG – Terminal 2E", "77990", "Le Mesnil-Amelot", 2.57744, 49.003656, "node/4986301531", "t2e t2"],
    ["cdg-t2f", "Aéroport CDG – Terminal 2F", "77990", "Le Mesnil-Amelot", 2.576586, 49.00497, "node/10961908065", "t2f t2"],
    ["cdg-t2g", "Aéroport CDG – Terminal 2G", "77290", "Mitry-Mory", 2.602951, 49.005625, "node/1654390593", "t2g t2"],
    ["cdg-t3", "Aéroport CDG – Terminal 3", "77990", "Mauregard", 2.560604, 49.013278, "way/38789044", "t3"],
    ["orly-1", "Aéroport d'Orly – Orly 1", "91550", "Paray-Vieille-Poste", 2.361476, 48.730327, "way/1340985241", "o1"],
    ["orly-2", "Aéroport d'Orly – Orly 2", "91550", "Paray-Vieille-Poste", 2.361476, 48.730327, "way/1340985241", "o2"],
    ["orly-3", "Aéroport d'Orly – Orly 3", "91550", "Paray-Vieille-Poste", 2.360486, 48.728487, "way/1336637164", "o3"],
    ["orly-4", "Aéroport d'Orly – Orly 4", "91550", "Paray-Vieille-Poste", 2.367167, 48.728735, "way/424486851", "o4"],
    ["gare-nord", "Gare du Nord", "75010", "Paris", 2.356167, 48.879972, "node/4086595159", "paris nord"],
    ["gare-est", "Gare de l'Est", "75010", "Paris", 2.358969, 48.87624, "way/243245757", "paris est"],
    ["gare-lyon", "Gare de Lyon", "75012", "Paris", 2.376539, 48.84452, "relation/15692032", "paris lyon"],
    ["gare-montparnasse", "Gare Montparnasse", "75015", "Paris", 2.317774, 48.838902, "way/356673672", "paris montparnasse"],
    ["gare-saint-lazare", "Gare Saint-Lazare", "75008", "Paris", 2.32683, 48.877077, "node/4046087261", "st lazare paris saint lazare"],
    ["gare-austerlitz", "Gare d'Austerlitz", "75013", "Paris", 2.366883, 48.841655, "node/6840764744", "paris austerlitz"],
    ["gare-bercy", "Gare de Bercy", "75012", "Paris", 2.382619, 48.83874, "node/4701374445", "paris bercy"],
    ["chessy", "Marne-la-Vallée – Chessy", "77700", "Chessy", 2.784398, 48.866596, "node/11260174919", "gare tgv disneyland disney"],
    ["la-defense", "La Défense", "92800", "Puteaux", 2.238424, 48.893297, "node/5640314065", "grande arche cnit"]
  ];

  var AIRPORT = 'aeroport airport terminal';
  var CDG = ' cdg roissy charles de gaulle';
  var ORLY = ' orly';

  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[’'`\-–—_.,()]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  var PLACES = DATA.map(function (d) {
    var id = d[0], kind = /^cdg/.test(id) ? 'cdg' : /^orly/.test(id) ? 'orly' : 'gare';
    var extra = kind === 'cdg' ? AIRPORT + CDG : kind === 'orly' ? AIRPORT + ORLY : (id === 'la-defense' ? 'la defense grande arche cnit' : 'gare train sncf');
    return {
      id: id, name: d[1], postcode: d[2], city: d[3], lon: d[4], lat: d[5], osm: d[6],
      label: d[1] + ', ' + d[2] + ' ' + d[3],
      search: ' ' + norm(d[1] + ' ' + extra + ' ' + (d[7] || '')) + ' '
    };
  });

  // Un de ces mots déclenche l'affichage des destinations pré-réglées en tête de liste.
  var TRIGGERS = ['aeroport', 'airport', 'cdg', 'roissy', 'charles de gaulle', 'orly', 'gare', 'terminal',
    'nord', 'lyon', 'montparnasse', 'lazare', 'austerlitz', 'bercy', 'chessy', 'marne la vallee', 'disney', 'defense', 'l est'];

  /* Destinations correspondant à la saisie : un mot déclencheur est présent et chaque mot saisi
     se retrouve dans la fiche (nom + alias). */
  function match(query, max) {
    var q = norm(query);
    if (q.length < 2) return [];
    var padded = ' ' + q + ' ';
    if (!TRIGGERS.some(function (t) { return padded.indexOf(' ' + t) !== -1; })) return [];
    var tokens = q.split(' ').filter(function (t) { return t && ['de', 'du', 'la', 'le', 'l', 'des', 'd', 'a'].indexOf(t) === -1; });
    var out = PLACES.filter(function (p) {
      return tokens.every(function (t) { return p.search.indexOf(' ' + t) !== -1; });
    });
    return out.slice(0, max || 8);
  }

  function byLabel(label) {
    for (var i = 0; i < PLACES.length; i++) if (PLACES[i].label === label) return PLACES[i];
    return null;
  }

  return { PLACES: PLACES, match: match, byLabel: byLabel, norm: norm };
});
