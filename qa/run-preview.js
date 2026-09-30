/* Boucle QA phase B : les 18 critères rejoués SANS mock sur la preview Vercel (vraies routes ORS,
   vrais e-mails Resend). Usage (jeton OIDC fourni par la CLI, jamais affiché) :
     QA_BASE=https://<preview>.vercel.app vc env run -- node qa/run-preview.js <iteration>
   → test-output/qa/preview-iter-N/{report.md,report.json,*.png,*.webm} */
'use strict';
const { chromium, devices } = require('playwright');
const { execSync, exec } = require('child_process');
const execP = (cmd, opts) => new Promise((ok, ko) => exec(cmd, opts, e => e ? ko(e) : ok()));
const http = require('http');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

const SITE = path.join(__dirname, '..');
const P = require(path.join(SITE, 'assets/pricing.js'));
const ITER = process.argv[2] || '1';
const OUT = path.join(SITE, 'test-output', 'qa', 'preview-iter-' + ITER);
const BASE = (process.env.QA_BASE || '').replace(/\/$/, '');
const HOST = new URL(BASE).host;
const TOKEN = process.env.VERCEL_OIDC_TOKEN;
const RESEND = process.env.RESEND_API_KEY;
const ORS = process.env.ORS_API_KEY;
const LIVE = 'https://www.fast-driver-75.fr';
const ORS_URL = 'https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson';
const FROM_DOMAIN = '@fast-driver-75.fr';
const RUN = 'QA' + Date.now().toString(36).slice(-6); // marqueur unique de ce passage
if (!BASE || !TOKEN || !RESEND || !ORS) { console.error('QA_BASE, VERCEL_OIDC_TOKEN, RESEND_API_KEY et ORS_API_KEY requis'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const results = {};
function record(id, pass, value, detail) {
  results[id] = { pass: !!pass, value, detail: detail || '' };
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} — ${value}${detail ? ' · ' + detail : ''}`);
}
const shot = name => path.join(OUT, name);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Le jeton n'est ajouté QUE pour l'hôte de la preview (jamais pour API Adresse, OSM, cdnjs, Google Fonts). */
function hfetch(url, opts = {}) {
  const h = { ...(opts.headers || {}) };
  if (new URL(url).host === HOST) h['x-vercel-trusted-oidc-idp-token'] = TOKEN;
  return fetch(url, { ...opts, headers: h });
}
const post = (u, b) => hfetch(BASE + u, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(b) })
  .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) }));

/* ---------- Boîte d'envoi Resend (compte partagé : filtre strict sur l'expéditeur + le marqueur) ---------- */
let lastResend = 0;
async function resend(pathname) {
  const wait = 650 - (Date.now() - lastResend);
  if (wait > 0) await sleep(wait);
  lastResend = Date.now();
  const r = await fetch('https://api.resend.com' + pathname, { headers: { Authorization: 'Bearer ' + RESEND } });
  if (r.status === 429) { await sleep(1500); return resend(pathname); }
  return r.json();
}
const parseTs = s => Date.parse(String(s).replace(' ', 'T').replace(/\+00$/, 'Z'));
const detailCache = new Map();
/* E-mails envoyés par le site depuis `since`, dont le contenu ou le destinataire contient `marker`. */
async function mailsSince(since, marker) {
  const list = await resend('/emails?limit=100');
  const ours = (list.data || []).filter(e => String(e.from).includes(FROM_DOMAIN) && parseTs(e.created_at) >= since);
  const out = [];
  for (const e of ours) {
    let d = detailCache.get(e.id);
    if (!d || d.last_event !== 'delivered') { d = await resend('/emails/' + e.id); detailCache.set(e.id, d); }
    const blob = [d.subject, (d.to || []).join(','), d.html, d.text].join('\n');
    if (!marker || blob.toLowerCase().includes(marker.toLowerCase())) out.push(d);
  }
  return out;
}
/* Attend n e-mails marqués, puis leur statut final (delivered / bounced…). */
async function waitMails(since, marker, n, timeoutMs = 120000) {
  const t0 = Date.now();
  let got = [];
  while (Date.now() - t0 < timeoutMs) {
    got = await mailsSince(since, marker);
    if (got.length >= n && got.every(m => m.last_event && !['queued', 'sent', 'scheduled'].includes(m.last_event))) return got;
    await sleep(4000);
  }
  return got;
}

function parisDate(daysAhead) {
  const d = new Date(Date.now() + daysAhead * 864e5);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function night2h(minH, maxH) {
  for (let d = 0; d < 4; d++) {
    const date = parisDate(d);
    const at = P.parisWallToUtc(date, '02:00').getTime() - Date.now();
    if (at > minH * 3600e3 && at < maxH * 3600e3) return { date, time: '02:00' };
  }
}
function haversineKm(a, b) {
  const R = 6371.0088, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
async function geocode(q) {
  const j = await fetch('https://api-adresse.data.gouv.fr/search/?limit=1&q=' + encodeURIComponent(q)).then(r => r.json());
  const f = j.features[0];
  return { label: f.properties.label, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
}

const FREEZE = `.rv{opacity:1!important;transform:none!important;transition:none!important}
*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
.hero-panes video{display:none!important}.pane img{display:block!important}
.nav,.fab{visibility:hidden!important}`;

async function newPage(browser, kind, extra = {}) {
  const base = kind === 'mobile'
    ? { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }
    : { viewport: { width: kind, height: 900 }, deviceScaleFactor: 1 };
  const ctx = await browser.newContext({ ...base, locale: 'fr-FR', timezoneId: 'Europe/Paris', ...extra });
  await ctx.route('**/*', route => {
    const req = route.request();
    if (new URL(req.url()).host === HOST) return route.continue({ headers: { ...req.headers(), 'x-vercel-trusted-oidc-idp-token': TOKEN } });
    return route.fallback();
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', e => page.errors.push(String(e)));
  return page;
}

async function pickAddress(page, sel, query, matchRe) {
  await page.fill(sel, '');
  await page.type(sel, query, { delay: 15 });
  await page.waitForSelector(`${sel}-list .ac-item`, { timeout: 12000 });
  const items = page.locator(`${sel}-list .ac-item`);
  const n = await items.count();
  for (let i = 0; i < n; i++) {
    if (!matchRe || matchRe.test(await items.nth(i).innerText())) { await items.nth(i).click(); return; }
  }
  throw new Error('no suggestion matching ' + matchRe + ' for ' + query);
}
const ROUTES = {
  paris: [['160 rue de Rivoli', /75001/], ['300 rue de Vaugirard', /75015/]],
  orly: [['160 rue de Rivoli', /75001/], ['Aeroport d\'Orly', /94310|94390/]],
  versailles: [['Place d\'Armes Versailles', /78000/], ['Rue de la Légion d\'Honneur Saint-Denis', /93200/]]
};
async function route(page, name) {
  const [a, b] = ROUTES[name];
  await pickAddress(page, '#f-dep', a[0], a[1]);
  await pickAddress(page, '#f-arr', b[0], b[1]);
}
async function fillContact(page, prefix, email) {
  await page.fill(`#${prefix}-prenom`, 'Camille');
  await page.fill(`#${prefix}-nom`, 'Martin ' + RUN);
  await page.fill(`#${prefix}-tel`, '06 12 34 56 78');
  await page.fill(`#${prefix}-email`, email);
}
const clientMail = tag => `delivered+${RUN.toLowerCase()}-${tag}@resend.dev`;

const MAP_PROBE = () => {
  const root = document.getElementById('route-map-in');
  const line = root.querySelector('path.fd-line');
  const pins = [...root.querySelectorAll('.fd-pin')].map(e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }; });
  const box = root.getBoundingClientRect();
  const ctm = line.getScreenCTM();
  const len = line.getTotalLength();
  const toScreen = p => ({ x: ctm.a * p.x + ctm.c * p.y + ctm.e, y: ctm.b * p.x + ctm.d * p.y + ctm.f });
  const start = toScreen(line.getPointAtLength(0)), end = toScreen(line.getPointAtLength(len));
  const samples = [];
  for (let d = 0; d <= len; d += 0.5) samples.push(toScreen(line.getPointAtLength(d)));
  const mt = root.querySelector('.fd-moto .mt');
  let moto = null;
  if (mt) { const r = mt.getBoundingClientRect(); moto = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return {
    startToGreen: dist(start, pins[0]), endToRed: dist(end, pins[1]),
    pinsInside: pins.every(p => p.r.left >= box.left && p.r.right <= box.right && p.r.top >= box.top && p.r.bottom <= box.bottom),
    motoOffset: moto ? Math.min(...samples.map(s => dist(s, moto))) : null, moto, dash: line.style.strokeDasharray,
    d: line.getAttribute('d')
  };
};

async function mapRun(browser, kind, routeName, tag, video) {
  const extra = video ? { recordVideo: { dir: OUT, size: kind === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 } } } : {};
  const p = await newPage(browser, kind, extra);
  await p.goto(BASE + '/#reserver', { waitUntil: 'load' });
  await route(p, routeName);
  await p.waitForSelector('#route-map.open path.fd-line', { timeout: 20000 });
  await p.locator('#resa-card').scrollIntoViewIfNeeded();
  await sleep(1500);
  const probes = [];
  for (let i = 0; i < 5; i++) {
    probes.push(await p.evaluate(MAP_PROBE));
    await p.locator('#route-map').screenshot({ path: shot(`C17-${tag}-${i + 1}.png`) });
    await sleep(650);
  }
  const meta = await p.innerText('#route-meta');
  await p.locator('#resa-card').screenshot({ path: shot(`C17-${tag}-carte.png`) });
  if (video) await sleep(3000);
  const pr = probes[0], offs = probes.map(q => q.motoOffset);
  const moved = new Set(probes.map(q => Math.round(q.moto.x) + ',' + Math.round(q.moto.y))).size;
  const ok = pr.startToGreen <= 1.5 && pr.endToRed <= 1.5 && pr.pinsInside && Math.max(...offs) <= 3 && moved >= 4;
  await p.close();
  if (video) fs.renameSync(await p.video().path(), shot(`C17-video-${tag}.webm`));
  await p.context().close();
  return { ok, txt: `${tag} (${meta.replace(/\s+/g, ' ')}) : tracé↔marqueurs ${pr.startToGreen.toFixed(2)}/${pr.endToRed.toFixed(2)} px, cadre ${pr.pinsInside ? 'ok' : 'COUPÉ'}, moto ${offs.map(o => o.toFixed(2)).join('/')} px` };
}

/* Proxy local neutre pour Lighthouse : même chemin réseau pour l'avant (site en ligne) et l'après (preview). */
function proxy(port, target, withToken) {
  const t = new URL(target);
  return http.createServer(async (req, res) => {
    try {
      const h = { 'user-agent': req.headers['user-agent'] || '', accept: req.headers.accept || '*/*' };
      if (withToken) h['x-vercel-trusted-oidc-idp-token'] = TOKEN;
      const r = await fetch(t.origin + req.url, { headers: h, redirect: 'follow' });
      const buf = Buffer.from(await r.arrayBuffer());
      const out = {};
      r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'strict-transport-security'].includes(k)) out[k] = v; });
      res.writeHead(r.status, out);
      res.end(buf);
    } catch (e) { res.statusCode = 502; res.end(); }
  }).listen(port, '127.0.0.1');
}

(async () => {
  const browser = await chromium.launch();
  const t0 = Date.now() - 10000;
  const spamSince = Date.now() - 10000;
  const booking = (o = {}) => ({
    mode: 'course', from: '160 Rue de Rivoli 75001 Paris', to: '300 Rue de Vaugirard 75015 Paris', date: parisDate(3), time: '14:30', bagages: '1',
    prenom: 'Camille', nom: 'Martin ' + RUN, tel: '0612345678', email: clientMail('http'), commentaire: '', website: '', elapsed: 8000, ...o
  });
  try {
    /* ================= C3 : distance routière réelle ================= */
    let parisKm = null;
    {
      const a = await geocode('160 Rue de Rivoli 75001 Paris'), b = await geocode('300 Rue de Vaugirard 75015 Paris');
      const q = await post('/api/quote', { mode: 'course', from: { lon: a.lon, lat: a.lat }, to: { lon: b.lon, lat: b.lat } });
      const direct = await fetch(ORS_URL, { method: 'POST', headers: { Authorization: ORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ coordinates: [[a.lon, a.lat], [b.lon, b.lat]] }) }).then(r => r.json());
      const dKm = direct.features[0].properties.summary.distance / 1000;
      const crow = haversineKm([a.lon, a.lat], [b.lon, b.lat]);
      parisKm = q.json.distanceKm;
      const gap = Math.abs(q.json.distanceKm - dKm) / dKm * 100;
      record('C3', q.status === 200 && q.json.distanceKm > crow && gap <= 5,
        `Paris 1er → Paris 15e : preview ${P.fmtKm(q.json.distanceKm)} km (${q.json.durationMin} min) · vol d'oiseau ${crow.toFixed(2).replace('.', ',')} km · appel ORS direct ${dKm.toFixed(2).replace('.', ',')} km · écart ${gap.toFixed(2).replace('.', ',')} %`);
    }

    /* ================= C10 / C14 : contenus servis ================= */
    {
      const htmls = await Promise.all(['/', '/recrutement'].map(u => hfetch(BASE + u).then(r => r.text())));
      const all = htmls.join('\n').replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+\/=]+/g, 'data:');
      const decode = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&ndash;/g, '–').replace(/&eacute;/g, 'é').replace(/&agrave;/g, 'à').replace(/&euro;/g, '€').replace(/ /g, ' ').replace(/\s+/g, ' ');
      const text = decode(all);
      const absent = ['1,70', '23h', 'jour & nuit', 'temps réel'];
      const present = ['1,80', '30 € minimum', '8h00 – 00h00', "24h à l'avance"];
      const hits = absent.filter(k => all.toLowerCase().includes(k) || text.toLowerCase().includes(k) || all.includes(k.replace('&', '&amp;')) || all.includes(k.replace('é', '&eacute;')));
      const missing = present.filter(k => !(all.includes(k) || text.includes(k)));
      record('C10', !hits.length && !missing.length, `preview — absents: ${hits.length ? 'TROUVÉ ' + hits.join(', ') : '0/4 trouvé'} · présents: ${present.map(k => `${k}×${all.split(k).length - 1}`).join(', ')}`);

      const served = [...htmls];
      for (const u of ['/assets/booking.js', '/assets/forms.js', '/assets/pricing.js', '/assets/route-map.js', '/assets/recrutement.js', '/lib/route.js', '/lib/env.js']) served.push(await hfetch(BASE + u).then(r => r.text()));
      const keyHit = served.some(s => s.includes(ORS) || s.includes(RESEND) || /re_[A-Za-z0-9_]{16,}|eyJvcmciOiI[A-Za-z0-9+/=]{10,}/.test(s));
      const log = execSync(`git -C ${JSON.stringify(SITE)} log -p --all`, { maxBuffer: 1 << 30 }).toString();
      const gitHit = log.includes(ORS) || log.includes(RESEND) || /re_[A-Za-z0-9_]{16,}|eyJvcmciOiI[A-Za-z0-9+/=]{10,}/.test(log);
      const envLs = execSync('vercel env ls 2>/dev/null', { cwd: SITE }).toString();
      const mockVercel = /MOCK_EXTERNAL/.test(envLs) || /MOCK/.test(fs.readFileSync(path.join(SITE, 'vercel.json'), 'utf8'));
      record('C14', !keyHit && !gitHit && !mockVercel, `clé dans le HTML/JS servi par la preview: ${keyHit ? 'OUI' : 'non'} · dans git log -p --all: ${gitHit ? 'OUI' : 'non'} · MOCK_EXTERNAL dans Vercel/vercel.json: ${mockVercel ? 'OUI' : 'non'}`);
    }

    /* ================= C4 ================= */
    {
      const cases = [['6 km pers', { mode: 'course', km: 6 }, 30], ['10 km colis', { mode: 'colis', km: 10 }, 30], ['15 km pers', { mode: 'course', km: 15 }, 40], ['15 km colis', { mode: 'colis', km: 15 }, 39], ['15 km pers 01h00 + 1 bagage', { mode: 'course', km: 15, bagages: 1, night: P.checkPickup(parisDate(3), '01:00').night }, 55], ['12,3 km colis', { mode: 'colis', km: 12.3 }, 34.14]];
      const vals = cases.map(([l, o, e]) => ({ l, got: P.computePrice(o).total, e }));
      let npm = '';
      try { npm = execSync('npm test --silent 2>&1', { cwd: SITE, env: { ...process.env, VERCEL_ENV: '', MOCK_EXTERNAL: '1', ORS_API_KEY: '', RESEND_API_KEY: '', RESEND_DOMAIN_VERIFIED: '', EMAIL_FROM: '', EMAIL_TO: 'delivered@resend.dev' } }).toString(); } catch (e) { npm = String(e.stdout); }
      const pass = (npm.match(/# pass (\d+)/) || [])[1], fail = (npm.match(/# fail (\d+)/) || [])[1];
      record('C4', vals.every(v => v.got === v.e) && fail === '0', vals.map(v => `${v.l} = ${P.fmtEur(v.got).replace(' ', ' ')}`).join(' · ') + ` · npm test ${pass}/${+pass + +fail}`);
    }

    /* ================= C5 / C6 / C9 (envois HTTP réels) ================= */
    const c5since = Date.now() - 10000;
    const c5 = await post('/api/booking', booking({ price: 1, total: '1,00 €', distanceKm: 0.1, nom: 'Martin ' + RUN + '-C5' }));
    const soon = night2h(0.05, 24), later = night2h(24.05, 48);
    const c6a = await post('/api/booking', booking({ ...soon, nom: 'Martin ' + RUN + '-C6a' }));
    const c6b = await post('/api/booking', booking({ ...later, nom: 'Martin ' + RUN + '-C6b' }));
    const spam = [];
    for (const u of ['/api/booking', '/api/recrutement', '/api/mise-a-disposition']) {
      spam.push(await post(u, { ...booking({ nom: 'Spam ' + RUN + '-HP' }), website: 'spam.example' }));
      spam.push(await post(u, { ...booking({ nom: 'Spam ' + RUN + '-FAST' }), elapsed: 1200 }));
    }

    /* ================= C1 : DA intacte + étapes avant/après ================= */
    {
      const rows = []; let ok = true;
      for (const kind of [1440, 'mobile']) {
        const pb = await newPage(browser, kind), pa = await newPage(browser, kind);
        await pb.goto(LIVE + '/', { waitUntil: 'networkidle', timeout: 60000 });
        await pa.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
        for (const p of [pb, pa]) { await p.addStyleTag({ content: FREEZE }); await p.evaluate(() => document.fonts.ready); await sleep(400); }
        for (const [label, sel, scored] of [['en-tête services', '#services .rv >> nth=0', 1], ['flotte', '#flotte', 1], ['CTA final', '.final', 1], ['en-tête tarifs', '#tarifs .rv >> nth=0', 1], ['FAQ (titre)', '#faq .rv >> nth=0', 1], ['étapes', '.steps', 0]]) {
          const tag = `${kind === 'mobile' ? 390 : kind}-${label.replace(/\W+/g, '')}`;
          const fb = shot(`C1-avant-${tag}.png`), fa = shot(`C1-apres-${tag}.png`);
          for (const pg of [pb, pa]) {
            await pg.locator(sel).first().evaluate(el => {
              el.style.top = ''; if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
              const dpr = devicePixelRatio, y = (el.getBoundingClientRect().top + scrollY) * dpr, frac = y - Math.floor(y);
              if (frac > 0.001) el.style.top = ((1 - frac) / dpr) + 'px';
            });
          }
          await pb.locator(sel).first().screenshot({ path: fb });
          await pa.locator(sel).first().screenshot({ path: fa });
          const A = PNG.sync.read(fs.readFileSync(fb)), B = PNG.sync.read(fs.readFileSync(fa));
          let pct = 100;
          if (A.width === B.width && Math.abs(A.height - B.height) <= 3) {
            for (let dy = -3; dy <= 3; dy++) {
              const h = Math.min(A.height, B.height) - Math.abs(dy) - 2;
              const crop = (img, y0) => { const o = new PNG({ width: img.width, height: h }); PNG.bitblt(img, o, 0, y0, img.width, h, 0, 0); return o; };
              const a = crop(A, 1 + Math.max(0, dy)), b = crop(B, 1 + Math.max(0, -dy));
              const n = pixelmatch(a.data, b.data, null, a.width, h, { threshold: 0.1 });
              pct = Math.min(pct, n / (a.width * h) * 100);
            }
          }
          if (scored && pct > 1) ok = false;
          rows.push(`${kind === 'mobile' ? 390 : kind} ${label} ${pct.toFixed(2)} %${scored ? '' : ' (section modifiée à dessein : étape 03)'}`);
        }
        await pb.context().close(); await pa.context().close();
      }
      record('C1', ok, rows.join(' · '), 'avant = site en ligne, après = preview');
    }

    /* ================= C2 ================= */
    {
      const p = await newPage(browser, 'mobile');
      await p.goto(BASE + '/#reserver', { waitUntil: 'load' });
      await p.type('#f-dep', '10 rue de Rivoli', { delay: 20 });
      await p.waitForSelector('#f-dep-list .ac-item');
      await sleep(700);
      const first = await p.locator('#f-dep-list .ac-item').first().innerText();
      await p.locator('#resa-card').screenshot({ path: shot('C2-rivoli-390.png') });
      await p.type('#f-arr', 'Lille', { delay: 20 });
      await p.waitForFunction(() => document.querySelector('#f-arr-err').textContent.length > 0, null, { timeout: 8000 }).catch(() => { });
      const msg = await p.locator('#f-arr-err').innerText();
      await p.locator('#resa-card').screenshot({ path: shot('C2-lille-390.png') });
      record('C2', /Paris/.test(first) && /750\d\d/.test(first) && msg === 'Adresse hors Île-de-France', `« 10 rue de Rivoli » → « ${first.replace(/\n/g, ' ')} » · « Lille » → « ${msg} »`);
      await p.context().close();
    }

    /* ================= Mobile : C16 réseau, C12, C8, course réelle (C7) ================= */
    const c7since = Date.now() - 10000;
    {
      const p = await newPage(browser, 'mobile', { recordVideo: { dir: OUT, size: { width: 390, height: 844 } } });
      const reqs = [];
      p.on('request', r => reqs.push(r.url()));
      await p.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
      await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); } });
      await sleep(500);
      const leafletBefore = reqs.filter(u => /leaflet|route-map|openstreetmap/.test(u)).length;
      await p.goto(BASE + '/#reserver', { waitUntil: 'load' });
      await p.type('#f-dep', '160 rue de Rivoli', { delay: 20 });
      await p.waitForSelector('#f-dep-list .ac-item');
      await sleep(700);
      const dd = await p.evaluate(() => {
        const list = document.getElementById('f-dep-list'), it = list.querySelector('.ac-item');
        const r = it.getBoundingClientRect(), lr = list.getBoundingClientRect();
        const topEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { h: r.height, fs: parseFloat(getComputedStyle(it).fontSize), inView: lr.left >= 0 && lr.right <= innerWidth, hit: it.contains(topEl) };
      });
      await p.locator('#resa-card').screenshot({ path: shot('C12-autocompletion-390.png') });
      await p.locator('#f-dep-list .ac-item', { hasText: '75001' }).first().tap();
      const fonts = await p.evaluate(() => [...document.querySelectorAll('input:not([tabindex="-1"]),select,textarea')].filter(e => !e.closest('.hp')).map(e => parseFloat(getComputedStyle(e).fontSize)));

      const apiCalls = [];
      p.on('request', r => { if (/\/api\/(booking|mise-a-disposition|recrutement)/.test(r.url())) apiCalls.push(r.url()); });
      await p.click('#resa-go');
      const inl1 = await p.locator('#calc-form .field.invalid').count();
      await pickAddress(p, '#f-arr', '300 rue de Vaugirard', /75015/);
      await p.fill('#f-date', parisDate(3)); await p.fill('#f-time', '14:30');
      await p.selectOption('#f-bag', '1');
      await fillContact(p, 'c', 'camille@@exemple');
      await p.fill('#c-tel', '12 34');
      await p.click('#resa-go');
      const inl2 = await p.locator('#calc-form .field.invalid').evaluateAll(els => els.map(e => e.dataset.field + ': ' + e.querySelector('.f-err').textContent));
      await p.locator('#resa-card').screenshot({ path: shot('C8-erreurs-inline-390.png') });
      results._c8 = { inl1, inl2, sent: apiCalls.length };

      await p.fill('#c-email', clientMail('course')); await p.fill('#c-tel', '06 12 34 56 78');
      await p.fill('#c-com', 'Casque taille M, merci ' + RUN);
      await p.waitForSelector('#route-map.open path.fd-line', { timeout: 20000 });
      await p.locator('#route-map').scrollIntoViewIfNeeded();
      await sleep(2500);
      const leafletAfter = reqs.filter(u => /leaflet/.test(u)).length;
      results._net = { leafletBefore, leafletAfter };
      await p.locator('#resa-card').screenshot({ path: shot('B-calculateur-mobile-390.png') });
      const priceShown = await p.innerText('#q-total');
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      await sleep(1000);
      await p.click('#resa-go');
      await p.waitForSelector('#done:not([hidden])', { timeout: 20000 });
      await sleep(900);
      await p.locator('#resa-card').screenshot({ path: shot('B-confirmation-390.png') });
      const overflowDone = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      results._coursePrice = priceShown;
      record('C12', overflow <= 0 && overflowDone <= 0 && Math.min(...fonts) >= 16 && dd.h >= 44 && dd.fs >= 14 && dd.inView && dd.hit,
        `débordement ${overflow} px / ${overflowDone} px (confirmation) · police mini des champs ${Math.min(...fonts)} px · suggestion ${dd.h.toFixed(0)} px de haut, ${dd.fs} px, cliquable: ${dd.hit ? 'oui' : 'non'}`);
      await p.close();
      fs.renameSync(await p.video().path(), shot('B-parcours-course-390.webm'));
      await p.context().close();
    }

    /* ================= C17 : 3 vraies routes + vidéos ================= */
    {
      const a = await mapRun(browser, 'mobile', 'paris', 'paris1-paris15-390', true);
      const b = await mapRun(browser, 1440, 'orly', 'paris-orly-1440', true);
      const c = await mapRun(browser, 1440, 'versailles', 'versailles-saintdenis-1440', false);
      record('C17', a.ok && b.ok && c.ok, [a.txt, b.txt, c.txt].join(' · '), 'vidéos : C17-video-paris1-paris15-390.webm, C17-video-paris-orly-1440.webm');
    }

    /* ================= C18 ================= */
    {
      const p = await newPage(browser, 'mobile');
      await p.route('**/api/quote', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Calcul du prix indisponible pour le moment.' }) }));
      await p.goto(BASE + '/#reserver', { waitUntil: 'load' });
      await route(p, 'paris');
      await p.waitForSelector('#q-alert:not([hidden])');
      const mapOpen = await p.evaluate(() => document.getElementById('route-map').classList.contains('open'));
      const alertTxt = await p.innerText('#q-alert');
      await p.fill('#f-date', parisDate(3)); await p.fill('#f-time', '10:00');
      await fillContact(p, 'c', clientMail('orsko'));
      await p.fill('#c-nom', 'Martin ' + RUN + '-ORS');
      await sleep(3000);
      await p.locator('#resa-card').screenshot({ path: shot('C18-ors-erreur-390.png') });
      await p.click('#resa-go');
      const formOk = await p.waitForSelector('#done:not([hidden])', { timeout: 20000 }).then(() => true, () => false);
      const doneTxt = formOk ? await p.innerText('#done-box') : '';
      await p.context().close();

      const q = await newPage(browser, 1440);
      await q.goto(BASE + '/#reserver', { waitUntil: 'load' });
      await route(q, 'orly');
      await q.waitForSelector('#route-map.open path.fd-line', { timeout: 20000 });
      await sleep(2000);
      const a = await q.evaluate(() => ({ id: document.getElementById('route-map-in')._leaflet_id, d: document.querySelector('path.fd-line').getAttribute('d') }));
      await route(q, 'versailles');
      await q.waitForFunction(prev => { const p = document.querySelector('#route-map.open:not(.stale) path.fd-line'); return p && p.getAttribute('d') !== prev; }, a.d, { timeout: 20000 });
      await sleep(250);
      const mid = await q.evaluate(() => ({ dash: document.querySelector('path.fd-line').style.strokeDasharray, off: parseFloat(getComputedStyle(document.querySelector('path.fd-line')).strokeDashoffset) }));
      await q.locator('#route-map').screenshot({ path: shot('C18-retrace-en-cours-1440.png') });
      await sleep(1500);
      const b = await q.evaluate(() => ({ id: document.getElementById('route-map-in')._leaflet_id, n: document.querySelectorAll('#route-map-in .leaflet-map-pane').length }));
      await q.locator('#route-map').screenshot({ path: shot('C18-retrace-fin-1440.png') });
      await q.context().close();

      const r = await newPage(browser, 'mobile', { reducedMotion: 'reduce' });
      await r.goto(BASE + '/#reserver', { waitUntil: 'load' });
      await route(r, 'versailles');
      await r.waitForSelector('#route-map.open path.fd-line', { timeout: 20000 });
      await sleep(300);
      const s1 = await r.evaluate(MAP_PROBE);
      await sleep(1200);
      const s2 = await r.evaluate(MAP_PROBE);
      await r.locator('#route-map').screenshot({ path: shot('C18-reduced-motion-390.png') });
      await r.context().close();
      const still = Math.hypot(s1.moto.x - s2.moto.x, s1.moto.y - s2.moto.y);
      const staticOk = (s1.dash === '' || s1.dash === 'none') && still < 0.5 && s1.motoOffset <= 3;

      const t = await newPage(browser, 'mobile');
      await t.route('**/tile.openstreetmap.org/**', rt => rt.abort());
      await t.goto(BASE + '/#reserver', { waitUntil: 'load' });
      await route(t, 'orly');
      await t.waitForSelector('#q-box:not([hidden])', { timeout: 20000 });
      await sleep(2500);
      const tileMapOpen = await t.evaluate(() => document.getElementById('route-map').classList.contains('open'));
      const tilePrice = await t.isVisible('#q-total');
      await t.locator('#resa-card').screenshot({ path: shot('C18-tuiles-erreur-390.png') });
      await t.context().close();

      record('C18', !mapOpen && /indisponible/.test(alertTxt) && formOk && /à confirmer|€/.test(doneTxt) && a.id === b.id && b.n === 1 && mid.dash !== 'none' && mid.off > 0 && staticOk && !tileMapOpen && tilePrice,
        `ORS en erreur → carte ${mapOpen ? 'affichée' : 'absente'}, message affiché, demande envoyée: ${formOk ? 'oui' : 'non'} · Paris → Orly puis Versailles → Saint-Denis : même carte (id ${a.id}→${b.id}, ${b.n} carte), retracé animé (reste ${mid.off.toFixed(0)} px à 250 ms) · reduced-motion (Versailles → Saint-Denis) : statique, moto immobile (${still.toFixed(2)} px) · tuiles en erreur → carte masquée: ${tileMapOpen ? 'non' : 'oui'}, prix: ${tilePrice ? 'oui' : 'non'}`);
    }

    /* ================= Colis, Plusieurs véhicules, Candidature (UI réelle) ================= */
    const md = parisDate(10);
    {
      const p = await newPage(browser, 1280);
      await p.goto(BASE + '/#reserver', { waitUntil: 'load' });
      await p.click('.tab[data-mode=colis]');
      await route(p, 'paris');
      await p.fill('#f-date', parisDate(3)); await p.fill('#f-time', '14:30');
      await p.waitForSelector('#q-box:not([hidden])', { timeout: 20000 });
      await fillContact(p, 'c', clientMail('colis'));
      await sleep(3200);
      await p.click('#resa-go');
      await p.waitForSelector('#done:not([hidden])', { timeout: 20000 });
      await p.locator('#resa-card').screenshot({ path: shot('B-confirmation-colis-1280.png') });

      await p.goto(BASE + '/', { waitUntil: 'load' });
      await p.addStyleTag({ content: '.rv{opacity:1!important;transform:none!important}' });
      await p.click('[data-open-tab=flotte]');
      await sleep(900);
      await p.fill('#m-nb', '4'); await p.selectOption('#m-type', 'événement'); await p.fill('#m-date', md);
      await p.fill('#m-hd', '18:00'); await p.fill('#m-hf', '23:30'); await p.fill('#m-lieu', 'Pavillon Ledoyen, Paris 8e');
      await p.fill('#m-duree', '5 heures 30'); await p.fill('#m-details', 'Navettes invités ' + RUN);
      await fillContact(p, 'm', clientMail('mad')); await p.fill('#m-soc', 'Agence Lumière');
      await sleep(3200);
      await p.click('#mad-form button[type=submit]');
      await p.waitForSelector('#done:not([hidden])', { timeout: 20000 });
      results._madDone = await p.innerText('#done-text');
      await p.locator('#resa-card').screenshot({ path: shot('B-confirmation-mise-a-dispo-1280.png') });
      await p.context().close();

      const r = await newPage(browser, 'mobile');
      await r.goto(BASE + '/recrutement', { waitUntil: 'load' });
      await r.addStyleTag({ content: '.rv{opacity:1!important;transform:none!important}' });
      const rv = { nom: 'Diallo', prenom: 'Moussa ' + RUN, tel: '07 66 13 98 50', email: clientMail('rec'), vehicule_modele: 'Honda Forza 750', vehicule_cylindree: '750 cm3', experience_pro: '6 ans de coursier express', experience_secteur: 'Taxi moto 2 ans, livraison 4 ans', motivations: 'Rouler dans Paris pour une équipe exigeante', horaires: 'Soirs et week-ends' };
      for (const [k, v] of Object.entries(rv)) await r.fill('#r-' + k, v);
      await r.selectOption('#r-disponibilite', 'temps partiel');
      await sleep(3200);
      await r.click('#rec-form button[type=submit]');
      await r.waitForSelector('#rec-done:not([hidden])', { timeout: 20000 });
      await sleep(1500);
      await r.screenshot({ path: shot('B-recrutement-confirmation-390.png') });
      results._rec = rv;
      await r.context().close();
    }

    /* ================= C11 / C13 / C15 ================= */
    {
      const d = await newPage(browser, 1440), m = await newPage(browser, 'mobile');
      await d.goto(BASE + '/', { waitUntil: 'load' }); await m.goto(BASE + '/', { waitUntil: 'load' });
      const dv = await d.isVisible('.nav-links a[href="/recrutement"]'), mv = await m.isVisible('.nav-jobs');
      const fv = await d.locator('footer a[href="/recrutement"]').count();
      await m.click('.nav-jobs'); await m.waitForURL('**/recrutement');
      const st = (await hfetch(BASE + '/recrutement')).status;
      await sleep(1800);
      await m.screenshot({ path: shot('B-recrutement-390.png'), fullPage: true });
      await d.goto(BASE + '/recrutement', { waitUntil: 'networkidle' }); await sleep(1800);
      await d.screenshot({ path: shot('B-recrutement-1440.png'), fullPage: true });
      record('C11', dv && mv && fv === 1 && st === 200, `desktop: ${dv ? 'visible' : 'absent'} · mobile: ${mv ? 'visible' : 'absent'} · footer: ${fv} · /recrutement HTTP ${st}`);
      await d.context().close(); await m.context().close();
    }
    {
      const rows = []; let ok = true;
      for (const w of [1280, 1440, 1920]) for (const u of ['/', '/recrutement']) {
        const p = await newPage(browser, w);
        await p.goto(BASE + u, { waitUntil: 'load', timeout: 60000 });
        await p.addStyleTag({ content: '.rv{opacity:1!important;transform:none!important}' });
        const r = await p.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const secs = [...document.querySelectorAll('body > section, body > header, body > footer')];
          const notFull = secs.filter(s => Math.abs(s.getBoundingClientRect().width - vw) > 1).length;
          const over = [...document.querySelectorAll('body *')].filter(e => {
            const r = e.getBoundingClientRect(); if (!r.width || getComputedStyle(e).visibility === 'hidden') return false;
            let a = e.parentElement; while (a && a !== document.body) { const o = getComputedStyle(a).overflowX; if (o === 'hidden' || o === 'clip' || o === 'auto') return false; a = a.parentElement; }
            return r.right > vw + 1 || r.left < -1;
          }).length;
          return { sw: document.documentElement.scrollWidth - vw, notFull, over, n: secs.length };
        });
        if (u === '/') await p.screenshot({ path: shot(`C13-accueil-${w}.png`) });
        if (r.sw > 0 || r.notFull || r.over) ok = false;
        rows.push(`${w} ${u}: ${r.sw} px, sections ${r.n - r.notFull}/${r.n}, hors cadre ${r.over}`);
        await p.context().close();
      }
      record('C13', ok, rows.join(' · '));
    }
    {
      const rows = []; let ok = true;
      for (const kind of ['mobile', 1440]) for (const u of ['/', '/recrutement']) {
        const p = await newPage(browser, kind);
        await p.goto(BASE + u, { waitUntil: 'networkidle', timeout: 60000 });
        await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { scrollTo(0, y); await new Promise(r => setTimeout(r, 30)); } });
        if (u === '/') {
          await p.goto(BASE + '/#reserver');
          await route(p, 'versailles');
          await p.waitForSelector('#route-map.open path.fd-line', { timeout: 20000 });
          await sleep(2500);
        }
        rows.push(`${kind === 'mobile' ? 390 : kind} ${u}: ${p.errors.length}`);
        if (p.errors.length) { ok = false; rows.push(p.errors.join(' | ').slice(0, 300)); }
        await p.context().close();
      }
      record('C15', ok, 'erreurs console — ' + rows.join(' · '), 'accueil testé avec calcul réel + carte');
    }

    /* ================= C16 : Lighthouse (même proxy local pour avant et après) ================= */
    {
      const px1 = proxy(4191, LIVE, false), px2 = proxy(4192, BASE, true);
      const chrome = chromium.executablePath();
      const lh = async (url, tag) => {
        const scores = [];
        for (let i = 0; i < 3; i++) {
          const f = shot(`lh-${tag}-${i}.json`);
          try {
            // exec asynchrone : le proxy local tourne dans ce même processus et doit pouvoir répondre.
            await execP(`lighthouse ${JSON.stringify(url)} --quiet --only-categories=performance --form-factor=mobile --output=json --output-path=${JSON.stringify(f)} --chrome-flags="--headless=new --no-sandbox"`, { env: { ...process.env, CHROME_PATH: chrome }, timeout: 180000 });
            scores.push(Math.round(JSON.parse(fs.readFileSync(f, 'utf8')).categories.performance.score * 100));
          } catch (e) { }
        }
        scores.sort((a, b) => a - b);
        return { scores, median: scores[Math.floor(scores.length / 2)] };
      };
      const before = await lh('http://127.0.0.1:4191/', 'avant-en-ligne');
      const after = await lh('http://127.0.0.1:4192/', 'apres-preview');
      px1.close(); px2.close();
      const net = results._net;
      record('C16', after.median >= before.median - 5 && net.leafletBefore === 0 && net.leafletAfter > 0,
        `Lighthouse mobile perf (médiane de 3, même chemin réseau) — avant (site en ligne): ${before.median} [${before.scores}] · après (preview): ${after.median} [${after.scores}] · écart ${after.median - before.median} pts · Leaflet/tuiles avant 1er calcul: ${net.leafletBefore}, après: ${net.leafletAfter}`);
    }

    /* ================= Vérifications e-mails (Resend réel) ================= */
    {
      // C5
      const m5 = (await waitMails(c5since, RUN + '-C5', 1))[0];
      const q = P.computePrice({ mode: 'course', km: parisKm, bagages: 1 });
      record('C5', c5.status === 200 && m5 && m5.subject.includes(P.fmtEur(q.total)) && m5.last_event === 'delivered',
        `POST avec prix = 1 € → e-mail « ${m5 ? m5.subject.replace(RUN + '-C5', '…') : 'aucun'} » (statut Resend: ${m5 ? m5.last_event : '—'}) · attendu ${P.fmtEur(q.total)} pour ${P.fmtKm(parisKm)} km + 1 bagage`);
      // C6
      const m6 = await waitMails(c5since, RUN + '-C6', 1, 60000);
      const m6a = m6.filter(m => m.subject.includes(RUN + '-C6a'));
      record('C6', c6a.status === 422 && c6b.status === 200 && m6a.length === 0 && c6b.json.price && Math.abs(c6b.json.price.total - P.computePrice({ mode: 'course', km: parisKm, bagages: 1, night: true }).total) < 0.001,
        `02h00 le ${soon.date} (< 24 h) → HTTP ${c6a.status} « ${c6a.json.error} » · 02h00 le ${later.date} (> 24 h) → HTTP ${c6b.status}, ${c6b.json.price && c6b.json.price.totalText} (dont +10 € nuit)`);
      // C8
      const c8 = results._c8;
      record('C8', c8.inl1 >= 6 && c8.inl2.length === 2 && c8.sent === 0, `vide → ${c8.inl1} erreurs inline · invalides → ${c8.inl2.join(' | ')} · requêtes envoyées: ${c8.sent}`);

      // C7 : 4 e-mails internes + 4 confirmations client, statut delivered
      const all = await waitMails(c7since, RUN, 10, 150000);
      const staff = all.filter(m => (m.to || []).includes('delivered@resend.dev'));
      const client = all.filter(m => (m.to || []).some(t => t.startsWith('delivered+')));
      const find = (arr, re) => arr.find(m => re.test(m.subject));
      const checks = [];
      const course = staff.find(m => /^\[Course\] /.test(m.subject) && m.subject.includes('Martin ' + RUN + ' ·')), colis = find(staff, /^\[Colis\] /), mad = staff.find(m => /^\[Mise à dispo\] /.test(m.subject) && m.html.includes(RUN)), rec = find(staff, /^\[Candidature\] Candidature chauffeur : Moussa QA/);
      const has = (m, vals) => m && vals.every(v => m.html.includes(v) && m.text.includes(v));
      const rt = m => Array.isArray(m.reply_to) ? m.reply_to[0] : m.reply_to;
      const [, mo, da] = md.split('-');
      checks.push({ l: 'Course', m: course, ok: course && course.last_event === 'delivered' && rt(course) === clientMail('course') && has(course, ['Camille', '06 12 34 56 78', clientMail('course'), 'Casque taille M', '160 Rue de Rivoli 75001 Paris', '300 Rue de Vaugirard 75015 Paris', '14h30', 'google.com/maps/dir', 'tel:+33612345678']) && course.from === 'Fast Driver <reservation@fast-driver-75.fr>' });
      checks.push({ l: 'Colis', m: colis, ok: colis && colis.last_event === 'delivered' && rt(colis) === clientMail('colis') && !/Bagages/.test(colis.text) });
      checks.push({ l: 'Mise à dispo', m: mad, ok: mad && mad.last_event === 'delivered' && mad.subject === `[Mise à dispo] Demande de devis : 4 véhicules le ${da}/${mo}` && rt(mad) === clientMail('mad') && has(mad, ['événement', 'Pavillon Ledoyen, Paris 8e', '5 heures 30', 'Navettes invités', '18h00', '23h30', 'Agence Lumière']) && results._madDone === 'Nous revenons vers vous avec un devis personnalisé.' });
      const rv = results._rec || {};
      checks.push({ l: 'Candidature', m: rec, ok: rec && rec.last_event === 'delivered' && rt(rec) === clientMail('rec') && has(rec, ['Diallo', 'Honda Forza 750', '750 cm3', '6 ans de coursier express', 'Taxi moto 2 ans', 'Rouler dans Paris', 'temps partiel', 'Soirs et week-ends']) });
      const confTags = ['course', 'colis', 'mad', 'rec'];
      const confs = confTags.map(tag => client.find(m => (m.to || []).includes(clientMail(tag))));
      const confOk = confs.every(m => m && m.last_event === 'delivered' && !m.html.includes('Camille') && !m.html.includes('Casque') && !m.html.includes('Rouler dans Paris'));
      record('C7', checks.every(c => c.ok) && confOk,
        checks.map(c => `${c.l}: ${c.ok ? 'OK' : 'KO'} « ${c.m ? c.m.subject.replace(new RegExp(' ?' + RUN + '\\S*', 'g'), '') : 'absent'} » (${c.m ? c.m.last_event : '—'})`).join(' · ') +
        ` · confirmations client: ${confs.filter(Boolean).map(m => m.last_event).join('/')} (${confs.filter(Boolean).length}/4), gabarit fixe: ${confOk ? 'oui' : 'NON'} · expéditeur: ${course ? course.from : '—'}`,
        'reply-to = e-mail saisi sur chaque formulaire');

      // Rendu des vrais e-mails envoyés
      const e = await newPage(browser, 1280);
      for (const [l, m] of [['course', course], ['colis', colis], ['mise-a-dispo', mad], ['candidature', rec], ['confirmation-client-course', confs[0]]]) {
        if (!m) continue;
        await e.setContent(m.html, { waitUntil: 'networkidle' });
        await e.screenshot({ path: shot(`B-email-reel-${l}.png`), fullPage: true });
      }
      await e.context().close();

      // C9 : après plus d'une minute, aucun e-mail pour les 6 envois piégés
      const spamMails = await mailsSince(spamSince, 'Spam ' + RUN);
      record('C9', spam.every(r => r.status === 200 && r.json.ok === true) && spamMails.length === 0,
        `honeypot ×3 et envoi à 1,2 s ×3 → ${spam.map(r => r.status).join('/')} · e-mails Resend correspondants: ${spamMails.length}`);
    }
  } catch (e) {
    console.error('QA crash:', e);
    results._crash = String(e && e.stack || e);
  } finally {
    await browser.close();
  }

  const ORDER = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'C18'];
  const ok = ORDER.filter(k => results[k] && results[k].pass).length;
  const note = Math.round(ok / 18 * 100) / 10;
  const md2 = [`# QA phase B (preview, sans mock) — itération ${ITER}`, '', `Preview : ${BASE}`, `Marqueur de passage : ${RUN}`, '', `**${ok}/18 critères · note ${String(note).replace('.', ',')}/10**`, '',
    '| # | ✓ | Valeur mesurée |', '|---|---|---|',
    ...ORDER.map(k => `| ${k} | ${results[k] ? (results[k].pass ? '✅' : '❌') : '⚠️ non mesuré'} | ${results[k] ? (results[k].value + (results[k].detail ? ' — ' + results[k].detail : '')).replace(/\|/g, '/') : ''} |`),
    results._crash ? '\n**Crash :** ' + results._crash : ''].join('\n');
  fs.writeFileSync(path.join(OUT, 'report.md'), md2);
  console.log(`\n${ok}/18 — note ${note}/10 → ${path.join(OUT, 'report.md')}`);
})();
