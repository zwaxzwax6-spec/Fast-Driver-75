const test = require('node:test');
const assert = require('node:assert/strict');
const Places = require('../assets/places.js');
const P = require('../assets/pricing.js');

const ids = list => list.map(p => p.id);
const ALL = ['cdg-t1', 'cdg-t2a', 'cdg-t2c', 'cdg-t2d', 'cdg-t2e', 'cdg-t2f', 'cdg-t2g', 'cdg-t3', 'orly-1', 'orly-2', 'orly-3', 'orly-4',
  'gare-nord', 'gare-est', 'gare-lyon', 'gare-montparnasse', 'gare-saint-lazare', 'gare-austerlitz', 'gare-bercy', 'chessy', 'la-defense'];

test('21 destinations pré-réglées, toutes en Île-de-France, avec leur élément OSM', () => {
  assert.deepEqual(ids(Places.PLACES), ALL);
  for (const p of Places.PLACES) {
    assert.ok(P.isIdfPostcode(p.postcode), p.id + ' ' + p.postcode);
    assert.match(p.osm, /^(node|way|relation)\/\d+$/, p.id);
    assert.ok(p.lon > 1.4 && p.lon < 3.6 && p.lat > 48.1 && p.lat < 49.25, p.id);
  }
});

test('aéroport / CDG / Roissy / Orly / gare déclenchent les destinations pré-réglées', () => {
  assert.ok(ids(Places.match('aéroport', 20)).includes('cdg-t2e'));
  assert.ok(ids(Places.match('aéroport', 20)).includes('orly-4'));
  assert.ok(!ids(Places.match('aéroport', 20)).some(id => id.startsWith('gare')));
  assert.ok(ids(Places.match('Aéroport Charles de Gaulle', 20)).every(id => id.startsWith('cdg')));
  assert.equal(Places.match('Aéroport Charles de Gaulle', 20).length, 8);
  assert.ok(ids(Places.match('Roissy', 20)).every(id => id.startsWith('cdg')));
  assert.deepEqual(ids(Places.match('CDG T2E')), ['cdg-t2e']);
  assert.deepEqual(ids(Places.match('cdg terminal 1')), ['cdg-t1']);
  assert.deepEqual(ids(Places.match('Orly 4')), ['orly-4']);
  assert.equal(Places.match('orly', 20).length, 4);
  assert.equal(Places.match('gare', 20).length, 8);
});

test('grandes gares et sites par leur nom', () => {
  assert.equal(ids(Places.match('Gare du Nord'))[0], 'gare-nord');
  assert.equal(ids(Places.match("Gare de l'Est"))[0], 'gare-est');
  assert.equal(ids(Places.match('Gare de Lyon'))[0], 'gare-lyon');
  assert.equal(ids(Places.match('Montparnasse'))[0], 'gare-montparnasse');
  assert.equal(ids(Places.match('Saint-Lazare'))[0], 'gare-saint-lazare');
  assert.equal(ids(Places.match('Austerlitz'))[0], 'gare-austerlitz');
  assert.equal(ids(Places.match('Bercy'))[0], 'gare-bercy');
  assert.equal(ids(Places.match('Chessy'))[0], 'chessy');
  assert.equal(ids(Places.match('Marne-la-Vallée'))[0], 'chessy');
  assert.equal(ids(Places.match('La Défense'))[0], 'la-defense');
});

test('rien pour une adresse ordinaire ni pour Beauvais', () => {
  assert.deepEqual(Places.match('160 rue de Rivoli'), []);
  assert.deepEqual(Places.match('Beauvais'), []);
  assert.deepEqual(Places.match('Aéroport de Beauvais'), []);
  assert.deepEqual(Places.match('Lille'), []);
});

test('libellé exact → destination (utilisé par le serveur)', () => {
  const t2e = Places.PLACES.find(p => p.id === 'cdg-t2e');
  assert.equal(Places.byLabel(t2e.label), t2e);
  assert.equal(Places.byLabel(t2e.label + ' '), null);
});
