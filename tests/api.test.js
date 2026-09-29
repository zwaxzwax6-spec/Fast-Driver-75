const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-api-'));
process.chdir(tmp);
process.env.MOCK_EXTERNAL = '1';
process.env.EMAIL_TO = 'delivered@resend.dev';
delete process.env.VERCEL_ENV;
delete process.env.RESEND_DOMAIN_VERIFIED;

const ROOT = path.join(__dirname, '..');
const booking = require(path.join(ROOT, 'api/booking.js'));
const quote = require(path.join(ROOT, 'api/quote.js'));
const recrutement = require(path.join(ROOT, 'api/recrutement.js'));
const mad = require(path.join(ROOT, 'api/mise-a-disposition.js'));

const PLACES = {
  '160 Rue de Rivoli 75001 Paris': { postcode: '75001', c: [2.339822, 48.861399] },
  '300 Rue de Vaugirard 75015 Paris': { postcode: '75015', c: [2.297895, 48.838126] },
  'Lille': { postcode: '59000', c: [3.06, 50.63] }
};
let geoCalls = 0;
global.fetch = async (url) => {
  const u = new URL(url);
  assert.equal(u.hostname, 'api-adresse.data.gouv.fr', 'seul l’API Adresse est appelée en mock');
  geoCalls++;
  const q = u.searchParams.get('q');
  const p = PLACES[q];
  const features = p ? [{ geometry: { coordinates: p.c }, properties: { label: q, postcode: p.postcode } }] : [];
  return { ok: true, json: async () => ({ features }) };
};

function call(handler, body, method = 'POST') {
  return new Promise((resolve) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = method;
    req.headers = { host: 'localhost:3000' };
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(s) { resolve({ status: this.statusCode, json: JSON.parse(s) }); }
    };
    handler(req, res);
  });
}

const mailDir = () => path.join(tmp, 'test-output', 'emails');
function mails() {
  if (!fs.existsSync(mailDir())) return [];
  return fs.readdirSync(mailDir()).filter(f => f.endsWith('.json')).sort()
    .map(f => JSON.parse(fs.readFileSync(path.join(mailDir(), f), 'utf8')));
}
function clearMails() { fs.rmSync(mailDir(), { recursive: true, force: true }); }

/* Date/heure à Paris dans `hours` heures, calée sur une heure donnée si besoin. */
function parisIn(hours, forceTime) {
  const d = new Date(Date.now() + hours * 3600e3);
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const p = Object.fromEntries(f.map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: forceTime || `${p.hour}:${p.minute}` };
}
/* Prochaine date (≥ minHours) à laquelle 02:00 Paris tombe dans la fenêtre voulue. */
function night2h(minHours, maxHours) {
  for (let h = 0; h < 72; h++) {
    const c = parisIn(h, '02:00');
    const P = require(path.join(ROOT, 'assets/pricing.js'));
    const at = P.parisWallToUtc(c.date, c.time).getTime() - Date.now();
    if (at > minHours * 3600e3 && at < maxHours * 3600e3) return c;
  }
  throw new Error('no slot');
}

const base = () => ({
  mode: 'course', from: '160 Rue de Rivoli 75001 Paris', to: '300 Rue de Vaugirard 75015 Paris',
  ...parisIn(72, '14:30'), bagages: '1',
  prenom: 'Camille', nom: 'Martin', tel: '06 12 34 56 78', email: 'camille@example.com',
  commentaire: 'Casque taille M', website: '', t0: Date.now() - 10000
});

test('C5 prix falsifié ignoré : e-mail avec le prix recalculé', async () => {
  clearMails();
  const r = await call(booking, { ...base(), price: 1, total: 1, km: 0.1 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  // fixture Paris 1er -> 15e : 5,75 km -> 5,8 km -> 30 € + 1 bagage
  assert.equal(r.json.price.total, 35);
  const m = mails();
  assert.equal(m.length, 1);
  assert.match(m[0].subject, /^\[Course\] /);
  assert.match(m[0].subject, /35,00/);
  assert.equal(m[0].reply_to, 'camille@example.com');
  assert.deepEqual(m[0].to, ['delivered@resend.dev']);
  assert.match(m[0].html, /35,00/);
  assert.doesNotMatch(m[0].html, /1,00 €/);
  assert.match(m[0].text, /Prix estimatif : 35,00/);
  assert.match(m[0].html, /google\.com\/maps\/dir/);
  assert.match(m[0].html, /tel:\+33612345678/);
  for (const v of ['Camille', 'Martin', '06 12 34 56 78', 'camille@example.com', 'Casque taille M', '160 Rue de Rivoli', '300 Rue de Vaugirard', '14h30']) {
    assert.ok(m[0].html.includes(v) && m[0].text.includes(v), 'champ ' + v);
  }
});

test('colis : sujet [Colis], bagages ignorés', async () => {
  clearMails();
  const r = await call(booking, { ...base(), mode: 'colis', bagages: '3' });
  assert.equal(r.status, 200);
  assert.equal(r.json.price.total, 30);
  assert.match(mails()[0].subject, /^\[Colis\] /);
});

test('C8 champs invalides : 400, erreurs par champ, aucun e-mail', async () => {
  clearMails();
  let r = await call(booking, { ...base(), prenom: '' });
  assert.equal(r.status, 400);
  assert.ok(r.json.errors.prenom);
  r = await call(booking, { ...base(), email: 'pas-un-mail' });
  assert.ok(r.json.errors.email);
  r = await call(booking, { ...base(), tel: '12345' });
  assert.ok(r.json.errors.tel);
  r = await call(recrutement, { t0: Date.now() - 10000, prenom: 'A' });
  assert.equal(r.status, 400);
  assert.ok(r.json.errors.motivations && r.json.errors.email);
  r = await call(mad, { t0: Date.now() - 10000, nb_vehicules: '1' });
  assert.equal(r.status, 400);
  assert.ok(r.json.errors.nb_vehicules);
  assert.equal(mails().length, 0);
});

test('adresse hors IDF refusée côté serveur', async () => {
  clearMails();
  const r = await call(booking, { ...base(), to: 'Lille' });
  assert.equal(r.status, 400);
  assert.equal(r.json.errors.to, 'Adresse hors Île-de-France');
  assert.equal(mails().length, 0);
});

test('C9 honeypot ou envoi < 3 s : 200 silencieux, aucun e-mail', async () => {
  clearMails();
  for (const h of [booking, recrutement, mad]) {
    let r = await call(h, { ...base(), website: 'http://spam' });
    assert.equal(r.status, 200); assert.equal(r.json.ok, true);
    r = await call(h, { ...base(), t0: Date.now() - 1000 });
    assert.equal(r.status, 200); assert.equal(r.json.ok, true);
    r = await call(h, { ...base(), t0: undefined });
    assert.equal(r.status, 200);
  }
  assert.equal(mails().length, 0);
});

test('C6 course à 02h00 dans moins de 24 h bloquée, plus de 24 h acceptée +10 €', async () => {
  clearMails();
  let r = await call(booking, { ...base(), ...night2h(0.5, 24) });
  assert.equal(r.status, 422);
  assert.match(r.json.errors.time, /24h à l’avance/);
  assert.equal(mails().length, 0);
  r = await call(booking, { ...base(), ...night2h(24.5, 72) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.price.total, 45); // 30 + 5 bagage + 10 nuit
  assert.match(mails()[0].html, /nuit/i);
});

test('C7m recrutement : sujet, reply-to, tous les champs', async () => {
  clearMails();
  const body = {
    t0: Date.now() - 10000, website: '', nom: 'Diallo', prenom: 'Moussa', tel: '+33 7 66 13 98 50', email: 'MOUSSA@example.com',
    vehicule_modele: 'Honda Forza 750', vehicule_cylindree: '750 cm3', experience_pro: '5 ans coursier',
    experience_secteur: 'Taxi moto 2 ans', motivations: 'Rouler dans Paris', disponibilite: 'temps plein', horaires: 'Soirs et week-ends'
  };
  const r = await call(recrutement, body);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const m = mails()[0];
  assert.equal(m.subject, '[Candidature] Candidature chauffeur : Moussa Diallo');
  assert.equal(m.reply_to, 'moussa@example.com');
  for (const k of Object.keys(body).filter(k => !['t0', 'website', 'email', 'tel'].includes(k))) {
    assert.ok(m.html.includes(body[k]) && m.text.includes(body[k]), k);
  }
  assert.ok(m.text.includes('07 66 13 98 50'));
});

test('C7m mise à disposition : sujet « N véhicules le JJ/MM », tous les champs', async () => {
  clearMails();
  const { date } = parisIn(24 * 10);
  const body = {
    t0: Date.now() - 10000, website: '', nb_vehicules: '4', date, heure_debut: '18:00', heure_fin: '23:30',
    lieu: 'Parc des Expositions, Paris 15e', duree: '5 heures 30', type: 'événement', details: 'Navette invités',
    prenom: 'Léa', nom: 'Bernard', tel: '0612345678', email: 'lea@societe.fr', societe: 'Société X'
  };
  const r = await call(mad, body);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const m = mails()[0];
  const [, mm, dd] = date.split('-');
  assert.equal(m.subject, `[Mise à dispo] Demande de devis : 4 véhicules le ${dd}/${mm}`);
  assert.equal(m.reply_to, 'lea@societe.fr');
  for (const v of ['Parc des Expositions', '5 heures 30', 'événement', 'Navette invités', 'Léa', 'Bernard', 'Société X', '18h00', '23h30']) {
    assert.ok(m.html.includes(v) && m.text.includes(v), v);
  }
});

test('confirmation client seulement si RESEND_DOMAIN_VERIFIED=true', async () => {
  clearMails();
  await call(booking, base());
  assert.equal(mails().length, 1);
  clearMails();
  process.env.RESEND_DOMAIN_VERIFIED = 'true';
  await call(booking, base());
  delete process.env.RESEND_DOMAIN_VERIFIED;
  const m = mails();
  assert.equal(m.length, 2);
  assert.ok(m.some(x => x.to[0] === 'camille@example.com'));
});

test('quote : route mock + prix + géométrie qui relie les points', async () => {
  const r = await call(quote, { mode: 'course', from: { lon: 2.339822, lat: 48.861399 }, to: { lon: 2.297895, lat: 48.838126 }, bagages: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.json.distanceKm, 5.8);
  assert.equal(r.json.price.total, 30);
  assert.ok(r.json.geometry.coordinates.length > 10);
  assert.ok(r.json.durationMin > 5);
  const rev = await call(quote, { mode: 'colis', from: { lon: 2.297895, lat: 48.838126 }, to: { lon: 2.339822, lat: 48.861399 } });
  assert.deepEqual(rev.json.geometry.coordinates[0], r.json.geometry.coordinates.at(-1));
  const out = await call(quote, { mode: 'course', from: { lon: 3.06, lat: 50.63 }, to: { lon: 2.3, lat: 48.8 } });
  assert.equal(out.status, 400);
});

test('C14 sur Vercel : mock ignoré, sans clé ORS -> 503 propre, jamais de faux prix', async () => {
  process.env.VERCEL_ENV = 'production';
  process.env.ORS_API_KEY = '';
  try {
    const r = await call(quote, { mode: 'course', from: { lon: 2.339822, lat: 48.861399 }, to: { lon: 2.297895, lat: 48.838126 } });
    assert.equal(r.status, 503);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.price, undefined);
    process.env.RESEND_API_KEY = '';
    clearMails();
    const b = await call(booking, base());
    assert.equal(b.status, 503);
    assert.equal(mails().length, 0);
  } finally {
    delete process.env.VERCEL_ENV;
  }
});

test('méthode GET refusée', async () => {
  const r = await call(booking, {}, 'GET');
  assert.equal(r.status, 405);
});
