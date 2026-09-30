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

function call(handler, body, method = 'POST', ip = '203.0.113.' + Math.floor(Math.random() * 250)) {
  return new Promise((resolve) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = method;
    req.headers = { host: 'localhost:3000', 'x-forwarded-for': ip };
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
const base = () => ({
  mode: 'course', from: '160 Rue de Rivoli 75001 Paris', to: '300 Rue de Vaugirard 75015 Paris',
  ...parisIn(72, '14:30'), bagages: '1',
  prenom: 'Camille', nom: 'Martin', tel: '06 12 34 56 78', email: 'camille@example.com',
  commentaire: 'Casque taille M', website: '', elapsed: 10000
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
  r = await call(recrutement, { elapsed: 10000, prenom: 'A' });
  assert.equal(r.status, 400);
  assert.ok(r.json.errors.motivations && r.json.errors.email);
  r = await call(mad, { elapsed: 10000, nb_vehicules: '1' });
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
    r = await call(h, { ...base(), elapsed: 1000 });
    assert.equal(r.status, 200); assert.equal(r.json.ok, true);
    r = await call(h, { ...base(), elapsed: undefined });
    assert.equal(r.status, 200);
  }
  assert.equal(mails().length, 0);
});

test('C6 course à 02h00 dans moins de 24 h bloquée, plus de 24 h acceptée +10 €', async (t) => {
  // Horloge figée : 10/10/2026 12h00 à Paris (10h00 UTC).
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-10T10:00:00Z') });
  clearMails();
  const body = (date) => ({ ...base(), date, time: '02:00', elapsed: 10000 });
  let r = await call(booking, body('2026-10-11')); // dans 14 h
  assert.equal(r.status, 422);
  assert.match(r.json.errors.time, /24h à l’avance/);
  assert.equal(mails().length, 0);
  r = await call(booking, body('2026-10-12')); // dans 38 h
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.price.total, 45); // 30 + 5 bagage + 10 nuit
  assert.match(mails()[0].html, /nuit/i);
});

test('C7m recrutement : sujet, reply-to, tous les champs', async () => {
  clearMails();
  const body = {
    elapsed: 10000, website: '', nom: 'Diallo', prenom: 'Moussa', tel: '+33 7 66 13 98 50', email: 'MOUSSA@example.com',
    vehicule_modele: 'Honda Forza 750', vehicule_cylindree: '750 cm3', experience_pro: '5 ans coursier',
    experience_secteur: 'Taxi moto 2 ans', motivations: 'Rouler dans Paris', disponibilite: 'temps plein', horaires: 'Soirs et week-ends'
  };
  const r = await call(recrutement, body);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const m = mails()[0];
  assert.equal(m.subject, '[Candidature] Candidature chauffeur : Moussa Diallo');
  assert.equal(m.reply_to, 'moussa@example.com');
  for (const k of Object.keys(body).filter(k => !['elapsed', 'website', 'email', 'tel'].includes(k))) {
    assert.ok(m.html.includes(body[k]) && m.text.includes(body[k]), k);
  }
  assert.ok(m.text.includes('07 66 13 98 50'));
});

test('C7m mise à disposition : sujet « N véhicules le JJ/MM », tous les champs', async () => {
  clearMails();
  const { date } = parisIn(24 * 10);
  const body = {
    elapsed: 10000, website: '', nb_vehicules: '4', date, heure_debut: '18:00', heure_fin: '23:30',
    lieu: 'Parc des Expositions, Paris 15e', duree: '5 heures 30', type: 'événement', details: 'Navette invités',
    prenom: 'Léa', nom: 'Bernard', tel: '0612345678', email: 'lea@societe.fr', societe: 'Société X'
  };
  const r = await call(mad, body);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const m = mails()[0];
  const [, mm, dd] = date.split('-');
  assert.match(m.subject, new RegExp(`^\\[Mise à dispo\\] FD-[0-9A-HJKMNP-TV-Z]{4} · Demande de devis : 4 véhicules le ${dd}/${mm}$`));
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
    // Clé Resend absente = erreur de configuration : 503 visible (jamais de perte silencieuse des e-mails).
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

test('horloge du téléphone en avance : la demande passe (délai mesuré sur la page)', async () => {
  clearMails();
  const r = await call(booking, { ...base(), t0: Date.now() + 300000, elapsed: 45000 });
  assert.equal(r.status, 200);
  assert.equal(mails().length, 1);
});

test('champs sur une ligne : retours à la ligne neutralisés (sujet propre)', async () => {
  clearMails();
  const r = await call(booking, { ...base(), prenom: 'Jean\r\nBcc: x@y.z' });
  assert.equal(r.status, 200);
  assert.doesNotMatch(mails()[0].subject, /[\r\n]/);
});

test('e-mail avec ?, & ou = refusé', async () => {
  const r = await call(booking, { ...base(), email: 'x?cc=boss@evil.com' });
  assert.equal(r.status, 400);
  assert.ok(r.json.errors.email);
});

test('date impossible refusée (31/02)', async () => {
  const r = await call(mad, { elapsed: 10000, nb_vehicules: '3', date: '2027-02-31', heure_debut: '10:00', heure_fin: '12:00', lieu: 'Paris', duree: '2 h', type: 'groupe', prenom: 'A', nom: 'B', tel: '0612345678', email: 'a@b.fr' });
  assert.equal(r.status, 400);
  assert.ok(r.json.errors.date);
});

test('confirmation client : gabarit fixe, aucun texte libre saisi', async () => {
  clearMails();
  process.env.RESEND_DOMAIN_VERIFIED = 'true';
  try {
    await call(booking, { ...base(), prenom: 'Achetez ici', commentaire: 'http://phishing.example' });
    await call(recrutement, { elapsed: 10000, nom: 'X', prenom: 'Spam', tel: '0612345678', email: 'v@ex.fr', vehicule_modele: 'm', vehicule_cylindree: 'c', experience_pro: 'http://phishing.example', experience_secteur: 's', motivations: 'm', disponibilite: 'temps plein', horaires: 'h' });
  } finally { delete process.env.RESEND_DOMAIN_VERIFIED; }
  const client = mails().filter(m => m.to[0] !== 'delivered@resend.dev');
  assert.equal(client.length, 2);
  for (const m of client) {
    assert.doesNotMatch(m.html + m.text + m.subject, /phishing|Achetez|Spam/);
  }
  // Numéro de réservation repris dans la confirmation client (valeur produite par le serveur)
  assert.match(client.find(m => /course/.test(m.subject)).text, /Réservation : FD-[0-9A-HJKMNP-TV-Z]{4}\n/);
});

test('origine étrangère refusée', async () => {
  const req = Readable.from([Buffer.from(JSON.stringify(base()))]);
  req.method = 'POST';
  req.headers = { host: 'fast-driver-75.fr', origin: 'https://evil.example' };
  const r = await new Promise((resolve) => {
    booking(req, { statusCode: 200, setHeader() { }, end(s) { resolve({ status: this.statusCode, json: JSON.parse(s) }); } });
  });
  assert.equal(r.status, 403);
});

test('limiteur : /api/quote plafonné par IP hors mode local', async () => {
  process.env.VERCEL_ENV = 'production';
  try {
    let last;
    for (let i = 0; i < 31; i++) last = await call(quote, { mode: 'course', from: { lon: 2.3, lat: 48.8 }, to: { lon: 2.35, lat: 48.85 } }, 'POST', '198.51.100.7');
    assert.equal(last.status, 429);
    const other = await call(quote, { mode: 'course', from: { lon: 2.3, lat: 48.8 }, to: { lon: 2.35, lat: 48.85 } }, 'POST', '198.51.100.8');
    assert.notEqual(other.status, 429);
  } finally { delete process.env.VERCEL_ENV; }
});

test('corps JSON invalide -> 400 (req.body qui lève, comme sur Vercel)', async () => {
  const req = { method: 'POST', headers: { host: 'x' }, get body() { throw new Error('Invalid JSON'); } };
  const r = await new Promise((resolve) => {
    booking(req, { statusCode: 200, setHeader() { }, end(s) { resolve({ status: this.statusCode, json: JSON.parse(s) }); } });
  });
  assert.equal(r.status, 400);
});

test('API Adresse qui renvoie autre chose que du JSON : prix à confirmer, pas de 500 ni de undefined', async () => {
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  clearMails();
  try {
    const r = await call(booking, base());
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const m = mails()[0];
    assert.match(m.subject, /prix à confirmer/);
    assert.doesNotMatch(m.html + m.text, /undefined/);
    assert.ok(m.text.includes('160 Rue de Rivoli 75001 Paris'));
  } finally { global.fetch = realFetch; }
});

test('confirmation client sans adresses si elles n’ont pas pu être vérifiées', async () => {
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  process.env.RESEND_DOMAIN_VERIFIED = 'true';
  clearMails();
  try {
    await call(booking, { ...base(), from: 'Cliquez http://phishing.example 75001', to: 'Gagnez http://phishing.example' });
  } finally { global.fetch = realFetch; delete process.env.RESEND_DOMAIN_VERIFIED; }
  const client = mails().filter(m => m.to[0] !== 'delivered@resend.dev');
  assert.equal(client.length, 1);
  assert.doesNotMatch(client[0].html + client[0].text, /phishing/);
});

test('limiteur des formulaires : seules les demandes réellement envoyées comptent', async () => {
  process.env.VERCEL_ENV = 'production';
  try {
    for (let i = 0; i < 15; i++) {
      const r = await call(booking, { ...base(), email: 'invalide' }, 'POST', '198.51.100.20');
      assert.equal(r.status, 400);
    }
  } finally { delete process.env.VERCEL_ENV; }
});

test('mise à disposition : heure de début déjà passée aujourd’hui refusée', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-10T16:00:00Z') }); // 18h00 à Paris
  const r = await call(mad, { elapsed: 10000, nb_vehicules: '3', date: '2026-10-10', heure_debut: '09:00', heure_fin: '12:00', lieu: 'Paris', duree: '3 h', type: 'groupe', prenom: 'A', nom: 'B', tel: '0612345678', email: 'a@b.fr' });
  assert.equal(r.status, 400);
  assert.ok(r.json.errors.heure_debut);
  const ok = await call(mad, { elapsed: 10000, nb_vehicules: '3', date: '2026-10-10', heure_debut: '20:00', heure_fin: '23:00', lieu: 'Paris', duree: '3 h', type: 'groupe', prenom: 'A', nom: 'B', tel: '0612345678', email: 'a@b.fr' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

test('ORS appelé sur api.heigit.org (sans mock), clé en en-tête Authorization', async () => {
  const realFetch = global.fetch, seen = [];
  global.fetch = async (url, opts) => {
    seen.push({ url: String(url), auth: opts && opts.headers && opts.headers.Authorization });
    return { ok: true, json: async () => ({ features: [{ geometry: { coordinates: [[2.3, 48.8], [2.31, 48.81]] }, properties: { summary: { distance: 1500, duration: 300 } } }] }) };
  };
  process.env.VERCEL_ENV = 'preview';
  process.env.ORS_API_KEY = 'test-key';
  try {
    const r = await call(quote, { mode: 'course', from: { lon: 2.301, lat: 48.801 }, to: { lon: 2.311, lat: 48.811 } });
    assert.equal(r.status, 200);
    assert.equal(seen[0].url, 'https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson');
    assert.equal(seen[0].auth, 'test-key');
  } finally { global.fetch = realFetch; delete process.env.VERCEL_ENV; process.env.ORS_API_KEY = ''; }
});

test('ORS : radiuses [-1,-1] envoyé, une seule nouvelle tentative, puis erreur propre', async () => {
  const realFetch = global.fetch;
  const bodies = [];
  let fails = 1, failStatus = 503;
  const okResp = { ok: true, json: async () => ({ features: [{ geometry: { coordinates: [[2.4, 48.9], [2.41, 48.91]] }, properties: { summary: { distance: 2500, duration: 400 } } }] }) };
  global.fetch = async (url, opts) => {
    bodies.push(JSON.parse(opts.body));
    if (fails-- > 0) return { ok: false, status: failStatus, text: async () => '' };
    return okResp;
  };
  process.env.VERCEL_ENV = 'preview';
  process.env.ORS_API_KEY = 'test-key';
  try {
    let r = await call(quote, { mode: 'course', from: { lon: 2.401, lat: 48.901 }, to: { lon: 2.539607, lat: 48.997627 } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(bodies.length, 2, 'une nouvelle tentative après l’échec');
    assert.deepEqual(bodies[0].radiuses, [-1, -1]);
    assert.deepEqual(bodies[1].radiuses, [-1, -1]);
    // deux échecs de suite : 503 propre, sans prix
    bodies.length = 0; fails = 2;
    r = await call(quote, { mode: 'course', from: { lon: 2.402, lat: 48.902 }, to: { lon: 2.55186, lat: 49.014964 } });
    assert.equal(r.status, 503);
    assert.equal(r.json.price, undefined);
    assert.equal(bodies.length, 2);
    // « aucun itinéraire » (404) : pas de nouvelle tentative inutile, erreur propre
    bodies.length = 0; fails = 1; failStatus = 404;
    r = await call(quote, { mode: 'course', from: { lon: 2.403, lat: 48.903 }, to: { lon: 2.56, lat: 49.01 } });
    assert.equal(r.status, 503);
    assert.equal(bodies.length, 1);
  } finally { global.fetch = realFetch; delete process.env.VERCEL_ENV; process.env.ORS_API_KEY = ''; }
});

test('destination pré-réglée : coordonnées OSM utilisées, aucun géocodage', async () => {
  const Places = require(path.join(ROOT, 'assets/places.js'));
  const t2e = Places.PLACES.find(p => p.id === 'cdg-t2e');
  const before = geoCalls;
  clearMails();
  const r = await call(booking, { ...base(), to: t2e.label });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(geoCalls - before, 1, 'seul le départ est géocodé');
  assert.equal(r.json.to, t2e.label);
  assert.ok(mails()[0].text.includes('Aéroport CDG – Terminal 2E'));
});

/* ---------- Réservation via WhatsApp (W1, W2, W4) ---------- */
const WA = require(path.join(ROOT, 'assets/whatsapp.js'));
const REF_RE = /^FD-[0-9A-HJKMNP-TV-Z]{4}$/;
const decoded = (r) => {
  const u = new URL(r.json.whatsapp.url);
  assert.equal(u.origin + u.pathname, 'https://wa.me/33766139850');
  assert.equal(WA.link(r.json.whatsapp.text, false), r.json.whatsapp.url);
  return u.searchParams.get('text');
};
const wabody = (o) => ({ ...base(), date: '2026-10-12', time: '14:30', ...o });

test('W1 course : lien wa.me décodé = texte attendu exact', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-10T10:00:00Z') });
  clearMails();
  const r = await call(booking, wabody());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.ref, REF_RE);
  assert.equal(decoded(r), [
    'Bonjour Fast Driver, je souhaite réserver :',
    'Réservation ' + r.json.ref,
    'Service : Course',
    'Départ : 160 Rue de Rivoli 75001 Paris',
    'Arrivée : 300 Rue de Vaugirard 75015 Paris',
    'Date : 12/10/2026 à 14h30',
    'Bagages : 1',
    'Distance : 5,8 km · Prix estimatif : 35,00 €',
    'Nom : Camille Martin · Tél : 06 12 34 56 78',
    'Commentaire : Casque taille M'
  ].join('\n'));
});

test('W1 colis : lien wa.me décodé = texte attendu exact (sans bagages, sans commentaire vide)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-10T10:00:00Z') });
  clearMails();
  const r = await call(booking, wabody({ mode: 'colis', bagages: '3', commentaire: '  ' }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(decoded(r), [
    'Bonjour Fast Driver, je souhaite réserver :',
    'Réservation ' + r.json.ref,
    'Service : Colis',
    'Départ : 160 Rue de Rivoli 75001 Paris',
    'Arrivée : 300 Rue de Vaugirard 75015 Paris',
    'Date : 12/10/2026 à 14h30',
    'Distance : 5,8 km · Prix estimatif : 30,00 €',
    'Nom : Camille Martin · Tél : 06 12 34 56 78'
  ].join('\n'));
});

test('W1 mise à disposition : lien wa.me décodé = texte attendu exact', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-10T10:00:00Z') });
  clearMails();
  const r = await call(mad, {
    elapsed: 10000, website: '', nb_vehicules: '4', date: '2026-10-20', heure_debut: '18:00', heure_fin: '23:30',
    lieu: 'Parc des Expositions, Paris 15e', duree: '5 heures 30', type: 'événement', details: 'Navette invités\ndepuis la gare',
    prenom: 'Léa', nom: 'Bernard', tel: '0612345678', email: 'lea@societe.fr', societe: 'Société X'
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.ref, REF_RE);
  assert.equal(decoded(r), [
    'Bonjour Fast Driver, je souhaite réserver :',
    'Réservation ' + r.json.ref,
    'Service : Mise à disposition',
    'Nombre de véhicules : 4',
    'Date : 20/10/2026',
    'Horaires : de 18h00 à 23h30',
    'Lieu : Parc des Expositions, Paris 15e',
    'Durée : 5 heures 30',
    'Type de prestation : événement',
    'Société : Société X',
    'Nom : Léa Bernard · Tél : 06 12 34 56 78',
    'Commentaire : Navette invités depuis la gare'
  ].join('\n'));
  // W4 : même numéro dans le sujet de l'e-mail de sauvegarde
  const m = mails();
  assert.equal(m.length, 1);
  assert.equal(m[0].subject, '[Mise à dispo] ' + r.json.ref + ' · Demande de devis : 4 véhicules le 20/10');
  assert.ok(m[0].text.includes(r.json.ref) && m[0].html.includes(r.json.ref));
});

test('W2 prix falsifié par le navigateur : le message WhatsApp porte le prix recalculé', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-10T10:00:00Z') });
  clearMails();
  const r = await call(booking, wabody({ price: 1, total: 1, totalText: '1,00 €', km: 0.1, distanceKm: 0.1 }));
  assert.equal(r.status, 200);
  const text = decoded(r);
  assert.match(text, /Distance : 5,8 km · Prix estimatif : 35,00 €/);
});

test('W4 course : même numéro FD-XXXX dans le sujet de l’e-mail de sauvegarde', async () => {
  clearMails();
  const r = await call(booking, base());
  const m = mails();
  assert.equal(m.length, 1);
  assert.match(m[0].subject, new RegExp('^\\[Course\\] ' + r.json.ref + ' · '));
  assert.ok(m[0].text.includes(r.json.ref));
});

test('WhatsApp : prix indisponible → « à confirmer », jamais de faux prix', async () => {
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  clearMails();
  try {
    const r = await call(booking, base());
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.match(decoded(r), /\nDistance : à confirmer · Prix estimatif : à confirmer\n/);
  } finally { global.fetch = realFetch; }
});

test('WhatsApp : numéros différents pour deux demandes successives', async () => {
  const a = await call(booking, base());
  const b = await call(booking, base());
  assert.notEqual(a.json.ref, b.json.ref);
});

test('WhatsApp : envoi piégé (honeypot, < 3 s) → ni numéro ni message', async () => {
  for (const h of [booking, mad]) {
    for (const o of [{ website: 'http://spam' }, { elapsed: 1000 }]) {
      const r = await call(h, { ...base(), ...o });
      assert.equal(r.status, 200);
      assert.deepEqual(r.json, { ok: true });
    }
  }
});

test('WhatsApp : numéro et prix jamais repris du navigateur', async () => {
  const r = await call(booking, { ...base(), ref: 'FD-HACK', whatsapp: { text: 'x' }, price: { total: 1 } });
  assert.match(r.json.ref, REF_RE);
  assert.notEqual(r.json.ref, 'FD-HACK');
  assert.match(decoded(r), /Prix estimatif : 35,00/);
});

test('numéro unique entre /api/booking et /api/mise-a-disposition dans la même minute (réservation atomique)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-10T10:00:00Z') });
  clearMails();
  // Sur Vercel, chaque fonction (et chaque instance) a sa propre mémoire : on recharge le module.
  const fresh = (rel) => {
    for (const k of Object.keys(require.cache)) if (/lib[\\/]reference\.js$|api[\\/](booking|mise-a-disposition)\.js$/.test(k)) delete require.cache[k];
    return require(path.join(ROOT, rel));
  };
  const booking2 = fresh('api/booking.js'), mad2 = fresh('api/mise-a-disposition.js');
  const a = await call(booking2, wabody());
  const b = await call(mad2, {
    elapsed: 10000, website: '', nb_vehicules: '3', date: '2026-10-20', heure_debut: '18:00', heure_fin: '20:00',
    lieu: 'Paris', duree: '2 heures', type: 'groupe', prenom: 'Léa', nom: 'Bernard', tel: '0612345678', email: 'lea@societe.fr'
  });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.notEqual(a.json.ref, b.json.ref);
  const subjects = mails().filter(m => m.to[0] === 'delivered@resend.dev').map(m => m.subject);
  assert.ok(subjects.some(x => x.includes(a.json.ref)) && subjects.some(x => x.includes(b.json.ref)));
});

/* Resend réel simulé : géocodage, ORS et Resend passent par fetch. */
function fakeNet(resendReply) {
  const sent = [];
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.hostname === 'api-adresse.data.gouv.fr') {
      const q = u.searchParams.get('q'), p = PLACES[q];
      return { ok: true, json: async () => ({ features: p ? [{ geometry: { coordinates: p.c }, properties: { label: q, postcode: p.postcode } }] : [] }) };
    }
    if (u.hostname === 'api.heigit.org') {
      return { ok: true, json: async () => ({ features: [{ geometry: { coordinates: [[2.3398, 48.8614], [2.2979, 48.8381]] }, properties: { summary: { distance: 5750, duration: 900 } } }] }) };
    }
    if (u.hostname === 'api.resend.com') {
      sent.push({ key: opts.headers['Idempotency-Key'], body: JSON.parse(opts.body) });
      return resendReply(sent[sent.length - 1], sent);
    }
    throw new Error('hôte inattendu ' + u.hostname);
  };
  return sent;
}
const onVercel = async (fn) => {
  const realFetch = global.fetch;
  process.env.VERCEL_ENV = 'preview'; process.env.ORS_API_KEY = 'k'; process.env.RESEND_API_KEY = 'k';
  try { return await fn(); } finally {
    global.fetch = realFetch; delete process.env.VERCEL_ENV; process.env.ORS_API_KEY = ''; delete process.env.RESEND_API_KEY;
  }
};
const reply = (status, obj) => ({ ok: status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });

test('Resend : clé d’idempotence = numéro ; numéro déjà pris (409) → numéro suivant', async () => {
  await onVercel(async () => {
    const taken = new Set();
    const sent = fakeNet((m) => {
      if (taken.size === 0) { taken.add(m.key); return reply(409, { statusCode: 409, name: 'invalid_idempotent_request', message: 'used' }); }
      return reply(200, { id: 'x' });
    });
    const r = await call(booking, base());
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(sent.length, 2);
    assert.match(sent[0].key, /^fd-ref-FD-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.notEqual(sent[0].key, sent[1].key);
    assert.equal(sent[1].key, 'fd-ref-' + r.json.ref);
    assert.ok(sent[1].body.subject.includes(r.json.ref));
    assert.ok(decoded(r).includes('Réservation ' + r.json.ref));
  });
});

test('Resend en panne : la réservation WhatsApp reste possible (e-mail = sauvegarde)', async () => {
  await onVercel(async () => {
    fakeNet(() => reply(500, { message: 'down' }));
    const r = await call(booking, base());
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.match(r.json.ref, REF_RE);
    assert.match(decoded(r), /Prix estimatif : 35,00/);
    const m = await call(mad, {
      elapsed: 10000, website: '', nb_vehicules: '3', date: parisIn(24 * 10).date, heure_debut: '18:00', heure_fin: '20:00',
      lieu: 'Paris', duree: '2 heures', type: 'groupe', prenom: 'Léa', nom: 'Bernard', tel: '0612345678', email: 'lea@societe.fr'
    });
    assert.equal(m.status, 200, JSON.stringify(m.json));
    assert.ok(m.json.whatsapp.text.includes(m.json.ref));
  });
});

test('mise à disposition : date et horaires formatés par le serveur pour l’écran de confirmation', async () => {
  const r = await call(mad, {
    elapsed: 10000, website: '', nb_vehicules: '3', date: parisIn(24 * 10).date, heure_debut: '18:00', heure_fin: '20:00',
    lieu: 'Paris', duree: '2 heures', type: 'groupe', prenom: 'Léa', nom: 'Bernard', tel: '0612345678', email: 'lea@societe.fr'
  });
  const [y, mo, d] = parisIn(24 * 10).date.split('-');
  assert.deepEqual(r.json.recap, { vehicules: '3', date: `${d}/${mo}/${y}`, horaires: 'de 18h00 à 20h00' });
});

test('WhatsApp : espace normale avant € (texte brut, recherche dans WhatsApp Business)', async () => {
  const r = await call(booking, base());
  assert.doesNotMatch(r.json.whatsapp.text, / /);
});

test('mock : clé d’idempotence expirée après 24 h, comme chez Resend', async (t) => {
  clearMails();
  const mail = require(path.join(ROOT, 'lib/mail.js'));
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-10T10:00:00Z') });
  await mail.sendMail({ subject: 'a', html: 'a', text: 'a', idempotencyKey: 'fd-ref-FD-TEST' });
  await assert.rejects(mail.sendMail({ subject: 'b', html: 'b', text: 'b', idempotencyKey: 'fd-ref-FD-TEST' }), mail.KeyTakenError);
  t.mock.timers.setTime(Date.parse('2026-10-11T10:01:00Z'));
  await mail.sendMail({ subject: 'c', html: 'c', text: 'c', idempotencyKey: 'fd-ref-FD-TEST' });
});

test('Resend : clé révoquée ou domaine refusé (401/403/422) = erreur de configuration → 503 visible', async () => {
  for (const status of [401, 403, 422]) {
    await onVercel(async () => {
      fakeNet(() => reply(status, { message: 'nope' }));
      const r = await call(booking, base());
      assert.equal(r.status, 503, status + ' ' + JSON.stringify(r.json));
    });
  }
});
