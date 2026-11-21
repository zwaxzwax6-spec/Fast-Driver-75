// Le calculateur du site prend l'itinéraire et le prix du trajet de l'appli : la fonction `devis` du serveur de l'appli
// (Supabase), appelée côté serveur avec les adresses choisies. Ici, hors mock : la fonction est simulée par `fetch`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fd-devis-')));
delete process.env.MOCK_EXTERNAL;
delete process.env.VERCEL_ENV;
process.env.FD_SUPABASE_URL = 'https://appli.example.supabase.co/';
process.env.FD_SUPABASE_ANON_KEY = 'cle-anon';

const ROOT = path.join(__dirname, '..');
const quote = require(path.join(ROOT, 'api/quote.js'));
const devis = require(path.join(ROOT, 'lib/devis.js'));

const GDL = 'Gare de Lyon, 75012 Paris', ORLY4 = 'Aéroport d’Orly – Orly 4, 91550 Paray-Vieille-Poste';
let appels = [], reponse;
global.fetch = async (url, init) => {
  appels.push({ url, init, corps: JSON.parse(init.body) });
  return { ok: reponse.status === 200, status: reponse.status, json: async () => reponse.corps };
};
const devisAppli = (km, cents, label) => ({
  status: 200,
  corps: {
    mode: 'course', distanceKm: km, durationMin: 24, geometry: { type: 'LineString', coordinates: [[2.37, 48.84], [2.36, 48.73]] },
    depart: { libelle: GDL, lon: 2.37, lat: 48.84 }, arrivee: { libelle: ORLY4, lon: 2.36, lat: 48.73 },
    nuit: false, bagage: 'aucun', totalCentimes: cents, trajetCentimes: cents, motos: 1,
    lignes: [{ key: 'km', label, amount: cents / 100 }], grilleVersion: 2,
  },
});

function call(handler, body) {
  return new Promise((resolve) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = 'POST';
    req.headers = { host: 'localhost:3000', 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 250) };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(s) { resolve({ status: this.statusCode, json: JSON.parse(s) }); } };
    handler(req, res);
  });
}

test('la fonction devis de l’appli : adresses envoyées telles quelles, à une heure de jour, sans bagage', async () => {
  appels = []; reponse = devisAppli(17.7, 3540, '17,7 km × 2,00 €');
  const it = await devis.itineraire('course', GDL, ORLY4);
  assert.equal(appels.length, 1);
  const a = appels[0];
  assert.equal(a.url, 'https://appli.example.supabase.co/functions/v1/devis');
  assert.equal(a.init.method, 'POST');
  assert.equal(a.init.headers.apikey, 'cle-anon');
  assert.equal(a.init.headers.authorization, 'Bearer cle-anon');
  assert.deepEqual([a.corps.mode, a.corps.depart, a.corps.arrivee, a.corps.bagage], ['course', { libelle: GDL }, { libelle: ORLY4 }, 'aucun']);
  assert.equal(a.corps.quand.type, 'plus_tard');
  assert.equal(a.corps.quand.heure, '12:00');
  assert.match(a.corps.quand.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(it.distanceKm, 17.7);
  assert.equal(it.durationMin, 24);
  assert.deepEqual(it.trajet, { cents: 3540, lignes: [{ key: 'km', label: '17,7 km × 2,00 €', amount: 35.4 }] });
});

test('quote : la distance et le prix du trajet de l’appli (Gare de Lyon → Orly 4 = 17,7 km = 35,40 €)', async () => {
  reponse = devisAppli(17.7, 3540, '17,7 km × 2,00 €');
  const r = await call(quote, { mode: 'course', from: { lon: 2.37, lat: 48.84, label: GDL }, to: { lon: 2.36, lat: 48.73, label: ORLY4 }, bagages: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.distanceKm, 17.7);
  assert.equal(r.json.price.total, 35.4);
  assert.deepEqual(r.json.price.lines, [{ key: 'km', label: '17,7 km × 2,00 €', amount: 35.4 }]);
  // les bagages du site s'ajoutent au trajet de l'appli (+5 € chacun)
  const b = await call(quote, { mode: 'course', from: { lon: 2.37, lat: 48.84, label: GDL }, to: { lon: 2.36, lat: 48.73, label: ORLY4 }, bagages: 2 });
  assert.equal(b.json.price.total, 45.4);
  assert.deepEqual(b.json.price.lines.map(l => l.key), ['km', 'bagage', 'bagage']);
});

test('quote : sans adresse choisie dans la liste, refusé sans appeler l’appli', async () => {
  appels = [];
  const r = await call(quote, { mode: 'course', from: { lon: 2.37, lat: 48.84 }, to: { lon: 2.36, lat: 48.73, label: ORLY4 } });
  assert.equal(r.status, 400);
  assert.equal(appels.length, 0);
});

test('les refus de l’appli : adresse hors Île-de-France (400), itinéraire indisponible (503), jamais un autre prix', async () => {
  reponse = { status: 400, corps: { erreur: 'Adresse hors Île-de-France', code: 'outside' } };
  await assert.rejects(devis.itineraire('course', 'Lille', ORLY4), e => e instanceof devis.DevisError && e.status === 400 && e.message === 'Adresse hors Île-de-France');
  const r = await call(quote, { mode: 'course', from: { lon: 2.37, lat: 48.84, label: 'Lille' }, to: { lon: 2.36, lat: 48.73, label: ORLY4 } });
  assert.equal(r.status, 400);
  assert.equal(r.json.price, undefined);
  reponse = { status: 503, corps: { erreur: 'Calcul du prix indisponible pour le moment.', code: 'unavailable' } };
  const u = await call(quote, { mode: 'course', from: { lon: 2.37, lat: 48.84, label: GDL }, to: { lon: 2.36, lat: 48.73, label: ORLY4 } });
  assert.equal(u.status, 503);
  assert.equal(u.json.price, undefined);
  global.fetch = async () => { throw new Error('réseau'); };
  await assert.rejects(devis.itineraire('course', GDL, ORLY4), e => e instanceof devis.DevisError && e.status === 503);
});

test('sans adresse du serveur de l’appli (variables absentes) : 503, jamais un prix calculé ailleurs', async () => {
  const url = process.env.FD_SUPABASE_URL;
  process.env.FD_SUPABASE_URL = '';
  try {
    await assert.rejects(devis.itineraire('course', GDL, ORLY4), e => e instanceof devis.DevisError && e.status === 503);
  } finally { process.env.FD_SUPABASE_URL = url; }
});
