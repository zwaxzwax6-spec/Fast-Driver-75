const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { Readable } = require('stream');

/* Grille du serveur de l'appli : le prix de api/quote.js et celui du calculateur la suivent ;
   sans réponse du serveur (ou sans variable), la grille embarquée s'applique. */
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fd-tarifs-')));
process.env.MOCK_EXTERNAL = '1';
delete process.env.VERCEL_ENV;
process.env.FD_SUPABASE_URL = 'https://recette.example.supabase.co';
process.env.FD_SUPABASE_ANON_KEY = 'cle-anon-de-test';

const ROOT = path.join(__dirname, '..');
const quote = require(path.join(ROOT, 'api/quote.js'));
const apiTarifs = require(path.join(ROOT, 'api/tarifs.js'));
const tarifs = require(path.join(ROOT, 'lib/tarifs.js'));

const GRILLE = { forfaitCentimes: 3000, forfaitDixiemesKm: 100, kmCentimes: { course: 200, colis: 180 }, bagageCentimes: 500, nuitCentimes: 1000 };
let serveur = null; // réponse du serveur ; null = pas de réponse
let appels = 0;
global.fetch = async (url, init) => {
  appels++;
  assert.equal(url, 'https://recette.example.supabase.co/rest/v1/rpc/tarifs');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.apikey, 'cle-anon-de-test');
  if (!serveur) throw new TypeError('fetch failed');
  return { ok: true, json: async () => serveur };
};

function call(handler, body, method = 'POST') {
  return new Promise((resolve) => {
    const req = Readable.from([Buffer.from(body ? JSON.stringify(body) : '')]);
    req.method = method;
    req.headers = { host: 'localhost:3000', 'x-forwarded-for': '198.51.100.' + Math.floor(Math.random() * 250) };
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(s) { resolve({ status: this.statusCode, json: JSON.parse(s) }); }
    };
    handler(req, res);
  });
}

/* Le calculateur : assets/pricing.js chargé comme dans le navigateur (window.FDPricing), configuré avec la réponse de /api/tarifs. */
function calculateur(t) {
  const ctx = { self: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assets/pricing.js'), 'utf8'), ctx);
  const P = ctx.self.FDPricing;
  if (t && t.ok) P.configure({ grille: t.grille, horaires: t.horaires });
  return P;
}

// Rivoli -> Orly (fixture du mock) : 20,2 km.
const ORLY = { mode: 'course', from: { lon: 2.339822, lat: 48.861399 }, to: { lon: 2.374862, lat: 48.740097 } };

test('grille du serveur changée (course 2,50 €/km) : api/quote.js et le calculateur suivent', async () => {
  tarifs.viderCache();
  serveur = { version: 2, grille: { ...GRILLE, kmCentimes: { course: 250, colis: 180 } }, horaires: { debut: '08:00', fin: '00:00' } };
  const q = await call(quote, ORLY);
  assert.equal(q.status, 200);
  assert.equal(q.json.distanceKm, 20.2);
  assert.equal(q.json.price.total, 55.5); // 30 + 10,2 km × 2,50
  assert.equal(q.json.grille.kmCentimes.course, 250);

  const t = await call(apiTarifs, null, 'GET');
  assert.equal(t.status, 200);
  assert.equal(t.json.source, 'serveur');
  const P = calculateur(t.json);
  assert.equal(P.computePrice({ mode: 'course', km: q.json.distanceKm }).total, 55.5);
  assert.equal(P.computePrice({ mode: 'course', km: q.json.distanceKm, bagage: 'sac', night: true }).total, 70.5);
});

test('horaires du serveur : la règle de nuit et son message suivent', async () => {
  tarifs.viderCache();
  serveur = { version: 3, grille: GRILLE, horaires: { debut: '07:00', fin: '23:00' } };
  const t = await call(apiTarifs, null, 'GET');
  const P = calculateur(t.json);
  const now = new Date('2026-09-30T10:00:00Z');
  assert.equal(P.checkPickup('2026-10-05', '07:30', now).night, false);
  assert.equal(P.checkPickup('2026-10-05', '23:30', now).night, true);
  assert.equal(P.PICKUP_MESSAGES.nuit24h, 'Les prises en charge entre 23h00 et 06h59 se réservent au moins 24h à l’avance.');
});

test('grille gardée 60 s : un seul appel au serveur', async () => {
  tarifs.viderCache();
  serveur = { version: 2, grille: { ...GRILLE, kmCentimes: { course: 250, colis: 180 } }, horaires: { debut: '08:00', fin: '00:00' } };
  appels = 0;
  const t0 = Date.now();
  await tarifs.appliquer(t0);
  await tarifs.appliquer(t0 + 30000);
  assert.equal(appels, 1);
  await tarifs.appliquer(t0 + 61000);
  assert.equal(appels, 2);
});

test('sans réponse du serveur : la grille embarquée s’applique (quote et calculateur)', async () => {
  tarifs.viderCache();
  serveur = { version: 2, grille: { ...GRILLE, kmCentimes: { course: 250, colis: 180 } }, horaires: { debut: '08:00', fin: '00:00' } };
  await tarifs.appliquer(); // une grille du serveur a été posée…
  tarifs.viderCache();
  serveur = null;           // …puis le serveur ne répond plus
  const q = await call(quote, ORLY);
  assert.equal(q.status, 200);
  assert.equal(q.json.price.total, 50.4); // 30 + 10,2 km × 2 €
  const t = await call(apiTarifs, null, 'GET');
  assert.equal(t.json.source, 'embarquee');
  assert.equal(calculateur(t.json).computePrice({ mode: 'course', km: 20.2 }).total, 50.4);
  assert.equal(calculateur(null).computePrice({ mode: 'course', km: 20.2 }).total, 50.4); // /api/tarifs injoignable
});

test('réponse invalide du serveur : grille embarquée, jamais un prix inventé', async () => {
  tarifs.viderCache();
  serveur = { version: 9, grille: { ...GRILLE, kmCentimes: { course: -1, colis: 180 } }, horaires: { debut: '08:00', fin: '00:00' } };
  const q = await call(quote, ORLY);
  assert.equal(q.json.price.total, 50.4);
});

test('sans variables d’environnement : grille embarquée, aucun appel', async () => {
  const url = process.env.FD_SUPABASE_URL;
  delete process.env.FD_SUPABASE_URL;
  try {
    tarifs.viderCache();
    appels = 0;
    const t = await tarifs.appliquer();
    assert.equal(t.source, 'embarquee');
    assert.equal(appels, 0);
  } finally { process.env.FD_SUPABASE_URL = url; }
});
