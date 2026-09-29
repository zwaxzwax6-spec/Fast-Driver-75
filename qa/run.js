/* Boucle QA phase A : critères binaires C1–C18 (hors C3, phase B) avec valeurs mesurées.
   Usage : node qa/run.js [iteration]   → test-output/qa/iter-N/{report.md,report.json,*.png,*.webm} */
'use strict';
const { chromium, devices } = require('playwright');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

const SITE = path.join(__dirname, '..');
const ITER = process.argv[2] || '1';
const OUT = path.join(SITE, 'test-output', 'qa', 'iter-' + ITER);
const MAILS = path.join(SITE, 'test-output', 'emails');
const PORT = 4176, BASE = `http://localhost:${PORT}`;
const PORT_BEFORE = 4177, BEFORE_LOCAL = `http://localhost:${PORT_BEFORE}`;
const LIVE = 'https://www.fast-driver-75.fr';
fs.mkdirSync(OUT, { recursive: true });

const results = {};
function record(id, pass, value, detail) {
  results[id] = { pass: !!pass, value, detail: detail || '' };
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} — ${value}${detail ? ' · ' + detail : ''}`);
}
const shot = name => path.join(OUT, name);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer(port, env) {
  const p = spawn('node', ['scripts/dev-server.js', String(port)], { cwd: SITE, env: { ...process.env, ...env }, stdio: 'pipe' });
  p.stderr.on('data', d => process.stderr.write('[srv' + port + '] ' + d));
  return p;
}
async function waitUp(url) {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(url); if (r.status) return; } catch (e) { } await sleep(100); }
  throw new Error('server down ' + url);
}

const FREEZE = `.rv{opacity:1!important;transform:none!important;transition:none!important}
*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
.hero-panes video{display:none!important}.pane img{display:block!important}
.nav,.fab{visibility:hidden!important}`;

function mailFiles() {
  if (!fs.existsSync(MAILS)) return [];
  return fs.readdirSync(MAILS).filter(f => f.endsWith('.json')).sort();
}
function newMails(before) {
  return mailFiles().filter(f => !before.includes(f)).map(f => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(MAILS, f), 'utf8')) }));
}

function parisDate(daysAhead) {
  const d = new Date(Date.now() + daysAhead * 864e5);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
/* Créneau 02:00 Paris dans la fenêtre [minH, maxH] heures. */
function night2h(minH, maxH) {
  const P = require(path.join(SITE, 'assets/pricing.js'));
  for (let d = 0; d < 4; d++) {
    const date = parisDate(d);
    const at = P.parisWallToUtc(date, '02:00').getTime() - Date.now();
    if (at > minH * 3600e3 && at < maxH * 3600e3) return { date, time: '02:00' };
  }
}

async function newPage(browser, kind, extra = {}) {
  const base = kind === 'mobile'
    ? { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }
    : { viewport: { width: kind, height: 900 }, deviceScaleFactor: 1 };
  const ctx = await browser.newContext({ ...base, locale: 'fr-FR', timezoneId: 'Europe/Paris', ...extra });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', e => page.errors.push(String(e)));
  return page;
}

async function pickAddress(page, sel, query, matchRe) {
  await page.fill(sel, '');
  await page.type(sel, query, { delay: 15 });
  const list = sel + '-list';
  await page.waitForSelector(`${list} .ac-item`, { timeout: 10000 });
  const items = page.locator(`${list} .ac-item`);
  const n = await items.count();
  for (let i = 0; i < n; i++) {
    if (!matchRe || matchRe.test(await items.nth(i).innerText())) { await items.nth(i).click(); return; }
  }
  throw new Error('no suggestion matching ' + matchRe + ' for ' + query);
}

async function fillCalc(page, { dep = '160 rue de Rivoli', arr = '300 rue de Vaugirard', date = parisDate(3), time = '14:30', bag = '1' } = {}) {
  await pickAddress(page, '#f-dep', dep, /75001/);
  await pickAddress(page, '#f-arr', arr, /75015/);
  await page.fill('#f-date', date);
  await page.fill('#f-time', time);
  if (await page.isVisible('#f-bag')) await page.selectOption('#f-bag', bag);
  await page.waitForSelector('#q-box:not([hidden])', { timeout: 10000 });
}
async function fillContact(page, prefix) {
  await page.fill(`#${prefix}-prenom`, 'Camille');
  await page.fill(`#${prefix}-nom`, 'Martin');
  await page.fill(`#${prefix}-tel`, '06 12 34 56 78');
  await page.fill(`#${prefix}-email`, 'camille.martin@example.com');
}

/* ---- Mesures carte (coordonnées écran) ---- */
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
  if (mt) { const r = mt.getBoundingClientRect(); moto = { x: r.left + r.width / 2, y: r.top + r.height / 2, op: getComputedStyle(mt).opacity }; }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const near = moto ? Math.min(...samples.map(s => dist(s, moto))) : null;
  return {
    startToGreen: dist(start, pins[0]), endToRed: dist(end, pins[1]),
    pinsInside: pins.every(p => p.r.left >= box.left && p.r.right <= box.right && p.r.top >= box.top && p.r.bottom <= box.bottom),
    motoOffset: near, moto, len, dash: line.style.strokeDasharray, leafletId: root._leaflet_id, d: line.getAttribute('d').slice(0, 40)
  };
};

(async () => {
  execSync('mkdir -p ' + JSON.stringify(MAILS));
  const srv = startServer(PORT, {});
  // Version « avant » (main) servie à l'identique pour une comparaison Lighthouse équitable.
  const beforeDir = path.join(SITE, 'test-output', 'before-main');
  fs.mkdirSync(beforeDir, { recursive: true });
  execSync(`git -C ${JSON.stringify(SITE)} show main:index.html > ${JSON.stringify(path.join(beforeDir, 'index.html'))}`);
  const srvBefore = startServer(PORT_BEFORE, { FD_ROOT: beforeDir });
  await waitUp(BASE + '/');
  await waitUp(BEFORE_LOCAL + '/');
  const browser = await chromium.launch();

  try {
    /* ================= C10 : textes servis ================= */
    {
      const decode = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&ndash;/g, '–')
        .replace(/&eacute;/g, 'é').replace(/&agrave;/g, 'à').replace(/&rsquo;/g, '’').replace(/&euro;/g, '€').replace(/ /g, ' ').replace(/\s+/g, ' ');
      const htmls = await Promise.all(['/', '/recrutement'].map(u => fetch(BASE + u).then(r => r.text())));
      const all = htmls.join('\n');
      const text = decode(all);
      const absent = ['1,70', '23h', 'jour & nuit', 'temps réel'];
      const present = ['1,80', '30 € minimum', '8h00 – 00h00', "24h à l'avance"];
      const hitsAbsent = absent.filter(k => all.toLowerCase().includes(k) || text.toLowerCase().includes(k) || all.includes(k.replace('&', '&amp;')) || all.includes(k.replace('é', '&eacute;')));
      const missing = present.filter(k => !(all.includes(k) || text.includes(k)));
      const counts = present.map(k => `${k}×${(all.split(k).length - 1)}`).join(', ');
      record('C10', !hitsAbsent.length && !missing.length,
        `absents: ${hitsAbsent.length ? 'TROUVÉ ' + hitsAbsent.join(', ') : '0/4 trouvé'} · présents: ${counts}`);
    }

    /* ================= C14 : aucune clé ================= */
    {
      const served = [];
      for (const u of ['/', '/recrutement', '/assets/booking.js', '/assets/forms.js', '/assets/pricing.js', '/assets/route-map.js', '/assets/recrutement.js']) served.push(await fetch(BASE + u).then(r => r.text()));
      const keyRe = /(re_[A-Za-z0-9_]{16,}|5b3ce3597851110001cf6248[a-f0-9]{8,}|eyJvcmciOiI[A-Za-z0-9+/=]{10,})/;
      const servedHit = served.some(s => keyRe.test(s));
      const log = execSync(`git -C ${JSON.stringify(SITE)} log -p --all`, { maxBuffer: 1 << 30 }).toString();
      const gitHit = keyRe.test(log) || /^\+\s*(ORS_API_KEY|RESEND_API_KEY)\s*=\s*\S+/m.test(log);
      const envTracked = execSync(`git -C ${JSON.stringify(SITE)} ls-files`).toString().split('\n').filter(f => /^\.env/.test(f));
      const vercelJson = fs.readFileSync(path.join(SITE, 'vercel.json'), 'utf8');
      const mockInVercel = /MOCK/.test(vercelJson);
      const mockInServed = served.some(s => /MOCK_EXTERNAL/.test(s));
      const envJs = fs.readFileSync(path.join(SITE, 'lib/env.js'), 'utf8');
      const mockDefaultOff = /process\.env\.MOCK_EXTERNAL === '1'/.test(envJs) && /VERCEL_ENV === 'production'/.test(envJs);
      record('C14', !servedHit && !gitHit && !envTracked.length && !mockInVercel && !mockInServed && mockDefaultOff,
        `clé dans HTML/JS servi: ${servedHit ? 'OUI' : 'non'} · dans git log -p: ${gitHit ? 'OUI' : 'non'} · .env suivi: ${envTracked.length} · MOCK dans vercel.json: ${mockInVercel ? 'oui' : 'non'} · mock off par défaut et ignoré sur Vercel: ${mockDefaultOff ? 'oui' : 'non'}`);
    }

    /* ================= C4 : tests unitaires ================= */
    {
      const P = require(path.join(SITE, 'assets/pricing.js'));
      const cases = [
        ['6 km pers', { mode: 'course', km: 6 }, 30], ['10 km colis', { mode: 'colis', km: 10 }, 30],
        ['15 km pers', { mode: 'course', km: 15 }, 40], ['15 km colis', { mode: 'colis', km: 15 }, 39],
        ['15 km pers 01h00 + 1 bagage', { mode: 'course', km: 15, bagages: 1, night: P.checkPickup(parisDate(3), '01:00').night }, 55],
        ['12,3 km colis', { mode: 'colis', km: 12.3 }, 34.14]
      ];
      const vals = cases.map(([l, o, e]) => ({ l, got: P.computePrice(o).total, e }));
      let npm = '';
      try { npm = execSync('npm test --silent 2>&1', { cwd: SITE }).toString(); } catch (e) { npm = e.stdout.toString(); }
      const pass = (npm.match(/# pass (\d+)/) || [])[1], fail = (npm.match(/# fail (\d+)/) || [])[1];
      record('C4', vals.every(v => v.got === v.e) && fail === '0',
        vals.map(v => `${v.l} = ${P.fmtEur(v.got).replace(' ', ' ')}`).join(' · ') + ` · npm test ${pass}/${+pass + +fail}`);
    }

    /* ================= C5 / C6 / C9 via HTTP réel ================= */
    const post = (u, b) => fetch(BASE + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, json: await r.json() }));
    const bookingBody = (o = {}) => ({
      mode: 'course', from: '160 Rue de Rivoli 75001 Paris', to: '300 Rue de Vaugirard 75015 Paris', date: parisDate(3), time: '14:30', bagages: '1',
      prenom: 'Camille', nom: 'Martin', tel: '0612345678', email: 'camille@example.com', commentaire: '', website: '', t0: Date.now() - 8000, ...o
    });
    {
      const before = mailFiles();
      const r = await post('/api/booking', bookingBody({ price: 1, total: '1,00 €', distanceKm: 0.1 }));
      const m = newMails(before)[0];
      const got = m && (m.subject.match(/(\d+,\d\d)/) || [])[1];
      record('C5', r.status === 200 && m && got === '35,00' && !/1,00 €/.test(m.html),
        `POST prix=1 € → e-mail « ${m ? m.subject : 'aucun'} » (5,8 km + 1 bagage = 35,00 €)`);
    }
    {
      const before = mailFiles();
      const soon = night2h(0.2, 24), later = night2h(24.2, 72);
      const a = await post('/api/booking', bookingBody(soon));
      const b = await post('/api/booking', bookingBody(later));
      const m = newMails(before);
      record('C6', a.status === 422 && b.status === 200 && b.json.price.total === 45 && m.length === 1,
        `02h00 le ${soon.date} (<24h) → HTTP ${a.status} « ${a.json.error} » · 02h00 le ${later.date} (>24h) → HTTP ${b.status}, ${b.json.price && b.json.price.totalText} (30 + 5 bagage + 10 nuit)`);
    }
    {
      const before = mailFiles();
      const hp = await Promise.all(['/api/booking', '/api/recrutement', '/api/mise-a-disposition'].map(u => post(u, { ...bookingBody(), website: 'spam.example' })));
      const fast = await Promise.all(['/api/booking', '/api/recrutement', '/api/mise-a-disposition'].map(u => post(u, { ...bookingBody(), t0: Date.now() - 1200 })));
      const m = newMails(before);
      record('C9', [...hp, ...fast].every(r => r.status === 200 && r.json.ok === true) && m.length === 0,
        `honeypot ×3 → ${hp.map(r => r.status).join('/')} · envoi à 1,2 s ×3 → ${fast.map(r => r.status).join('/')} · e-mails créés: ${m.length}`);
    }

    /* ================= C1 : DA intacte (diff pixel avant/après) ================= */
    {
      const rows = [];
      let ok = true;
      for (const kind of [1440, 'mobile']) {
        const pb = await newPage(browser, kind), pa = await newPage(browser, kind);
        await pb.goto(LIVE + '/', { waitUntil: 'networkidle', timeout: 60000 });
        await pa.goto(BASE + '/', { waitUntil: 'networkidle' });
        for (const p of [pb, pa]) { await p.addStyleTag({ content: FREEZE }); await p.evaluate(() => document.fonts.ready); await sleep(400); }
        for (const [label, sel] of [['en-tête services', '#services .rv >> nth=0'], ['flotte', '#flotte'], ['CTA final', '.final'], ['en-tête tarifs', '#tarifs .rv >> nth=0'], ['FAQ (titre)', '#faq .rv >> nth=0']]) {
          const tag = `${kind}-${label.replace(/\W+/g, '')}`;
          const fb = shot(`C1-before-${tag}.png`), fa = shot(`C1-after-${tag}.png`);
          await pb.locator(sel).first().screenshot({ path: fb });
          await pa.locator(sel).first().screenshot({ path: fa });
          const A = PNG.sync.read(fs.readFileSync(fb)), B = PNG.sync.read(fs.readFileSync(fa));
          let pct;
          if (A.width !== B.width || A.height !== B.height) pct = 100;
          else {
            const diff = new PNG({ width: A.width, height: A.height });
            const n = pixelmatch(A.data, B.data, diff.data, A.width, A.height, { threshold: 0.1 });
            pct = n / (A.width * A.height) * 100;
            fs.writeFileSync(shot(`C1-diff-${tag}.png`), PNG.sync.write(diff));
          }
          if (pct > 1) ok = false;
          rows.push(`${kind === 'mobile' ? '390' : kind} ${label} ${pct.toFixed(2)} %`);
        }
        await pb.context().close(); await pa.context().close();
      }
      record('C1', ok, rows.join(' · '), 'référence avant = site en ligne ' + LIVE);
    }

    /* ================= C2 : API Adresse réelle ================= */
    {
      const p = await newPage(browser, 'mobile');
      await p.goto(BASE + '/#reserver', { waitUntil: 'load' });
      await p.type('#f-dep', '10 rue de Rivoli', { delay: 20 });
      await p.waitForSelector('#f-dep-list .ac-item');
      const first = await p.locator('#f-dep-list .ac-item').first().innerText();
      await p.locator('#resa-card').screenshot({ path: shot('C2-rivoli-mobile.png') });
      await p.fill('#f-arr', '');
      await p.type('#f-arr', 'Lille', { delay: 20 });
      await p.waitForFunction(() => document.querySelector('#f-arr-err').textContent.length > 0, null, { timeout: 8000 }).catch(() => { });
      const msg = await p.locator('#f-arr-err').innerText();
      const vis = await p.isVisible('#f-arr-err');
      await p.locator('#resa-card').screenshot({ path: shot('C2-lille-mobile.png') });
      record('C2', /Paris/.test(first) && /750\d\d/.test(first) && msg === 'Adresse hors Île-de-France' && vis,
        `« 10 rue de Rivoli » → 1re suggestion « ${first.replace(/\n/g, ' ')} » · « Lille » → « ${msg} »`);
      await p.context().close();
    }

    /* ================= C16 (réseau) + C12 + C17 + C8 + C7m (course) sur mobile ================= */
    {
      const p = await newPage(browser, 'mobile', { recordVideo: { dir: OUT, size: { width: 390, height: 844 } } });
      const reqs = [];
      p.on('request', r => reqs.push(r.url()));
      await p.goto(BASE + '/', { waitUntil: 'networkidle' });
      await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); } });
      await sleep(500);
      const leafletBefore = reqs.filter(u => /leaflet|route-map|openstreetmap|cartocdn/.test(u)).length;
      await p.goto(BASE + '/#reserver', { waitUntil: 'load' });

      // C12 : dropdown d'autocomplétion lisible et cliquable
      await p.type('#f-dep', '160 rue de Rivoli', { delay: 20 });
      await p.waitForSelector('#f-dep-list .ac-item');
      const dd = await p.evaluate(() => {
        const list = document.getElementById('f-dep-list'), it = list.querySelector('.ac-item');
        const r = it.getBoundingClientRect(), lr = list.getBoundingClientRect();
        const topEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { h: r.height, fs: parseFloat(getComputedStyle(it).fontSize), inView: lr.left >= 0 && lr.right <= innerWidth, hit: it.contains(topEl) };
      });
      await p.locator('#resa-card').screenshot({ path: shot('C12-autocomplete-390.png') });
      await p.locator('#f-dep-list .ac-item', { hasText: '75001' }).first().tap();
      const depVal = await p.inputValue('#f-dep');
      const fieldFonts = await p.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]):not([tabindex="-1"]),select,textarea')]
        .filter(e => !e.closest('.hp')).map(e => parseFloat(getComputedStyle(e).fontSize)));

      // C8 (UI) : champs vides / invalides → erreurs inline, aucun envoi
      const apiCalls = [];
      p.on('request', r => { if (/\/api\/(booking|mise-a-disposition|recrutement)/.test(r.url())) apiCalls.push(r.url()); });
      const mailsBefore = mailFiles();
      await p.click('#resa-go');
      const inl1 = await p.locator('#calc-form .field.invalid').count();
      await pickAddress(p, '#f-arr', '300 rue de Vaugirard', /75015/);
      await p.fill('#f-date', parisDate(3)); await p.fill('#f-time', '14:30');
      await p.selectOption('#f-bag', '1');
      await fillContact(p, 'c');
      await p.fill('#c-email', 'camille@@exemple'); await p.fill('#c-tel', '12 34');
      await p.click('#resa-go');
      const inl2 = await p.locator('#calc-form .field.invalid').evaluateAll(els => els.map(e => e.dataset.field + ': ' + e.querySelector('.f-err').textContent));
      await p.locator('#resa-card').screenshot({ path: shot('C8-erreurs-inline-390.png') });
      const sentC8 = apiCalls.length, mailsC8 = newMails(mailsBefore).length;
      record('C8', inl1 >= 6 && inl2.length === 2 && sentC8 === 0 && mailsC8 === 0,
        `formulaire vide → ${inl1} erreurs inline · e-mail et tél invalides → ${inl2.join(' | ')} · requêtes envoyées: ${sentC8} · e-mails: ${mailsC8}`);

      // C17 : carte, mobile
      await p.fill('#c-email', 'camille.martin@example.com'); await p.fill('#c-tel', '06 12 34 56 78');
      await p.fill('#c-com', 'Casque taille M, merci');
      await p.waitForSelector('#route-map.open path.fd-line');
      await p.locator('#route-map').scrollIntoViewIfNeeded();
      const leafletAfter = reqs.filter(u => /leaflet/.test(u)).length;
      record('C16net', leafletBefore === 0 && leafletAfter > 0, `requêtes Leaflet/tuiles avant 1er calcul: ${leafletBefore} · après: ${leafletAfter}`);
      await sleep(1500);
      const probes = [];
      for (let i = 0; i < 5; i++) {
        probes.push(await p.evaluate(MAP_PROBE));
        await p.locator('#route-map').screenshot({ path: shot(`C17-moto-390-${i + 1}.png`) });
        await sleep(650);
      }
      await p.locator('#quote').screenshot({ path: shot('C17-carte-prix-390.png') });
      await p.locator('#resa-card').screenshot({ path: shot('A1-calculateur-mobile-390.png') });
      const pr = probes[0];
      const offs = probes.map(q => q.motoOffset);
      const moved = new Set(probes.map(q => Math.round(q.moto.x) + ',' + Math.round(q.moto.y))).size;
      const c17m = pr.startToGreen <= 1.5 && pr.endToRed <= 1.5 && pr.pinsInside && Math.max(...offs) <= 3 && moved >= 4;
      results._c17m = { c17m, txt: `390 px : écart tracé↔marqueurs ${pr.startToGreen.toFixed(2)} / ${pr.endToRed.toFixed(2)} px · marqueurs dans le cadre: ${pr.pinsInside ? 'oui' : 'non'} · moto↔polyligne sur 5 captures: ${offs.map(o => o.toFixed(2)).join(' / ')} px (${moved} positions distinctes)` };

      // C12 : pas de scroll horizontal, polices des champs
      const overflow390 = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);

      // C7m (course) : envoi réel dans l'UI → confirmation
      const beforeSend = mailFiles();
      await p.click('#resa-go');
      await p.waitForSelector('#done:not([hidden])', { timeout: 10000 });
      await sleep(700);
      await p.locator('#resa-card').screenshot({ path: shot('A1-confirmation-390.png') });
      const waHref = await p.getAttribute('#done-wa', 'href');
      const overflowDone = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const mCourse = newMails(beforeSend);
      results._course = { m: mCourse[0], waHref };
      record('C12', overflow390 <= 0 && overflowDone <= 0 && Math.min(...fieldFonts) >= 16 && dd.h >= 44 && dd.fs >= 14 && dd.inView && dd.hit && /75001/.test(depVal),
        `débordement horizontal: ${overflow390} px (calcul) / ${overflowDone} px (confirmation) · police mini des champs: ${Math.min(...fieldFonts)} px · suggestion: ${dd.h.toFixed(0)} px de haut, ${dd.fs} px, dans l'écran: ${dd.inView ? 'oui' : 'non'}, cliquable: ${dd.hit ? 'oui' : 'non'}`);
      await p.close();
      const vid = await p.video().path();
      fs.renameSync(vid, shot('C17-video-carte-390.webm'));
      await p.context().close();
    }

    /* ================= C17 desktop 1440 + vidéo ================= */
    {
      const p = await newPage(browser, 1440, { recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } });
      await p.goto(BASE + '/#reserver', { waitUntil: 'load' });
      await fillCalc(p, { dep: '160 rue de Rivoli', arr: 'Aeroport Orly', bag: '0' }).catch(async () => {
        await pickAddress(p, '#f-arr', 'Aeroport d\'Orly', /94310/);
      });
      await p.waitForSelector('#route-map.open path.fd-line');
      await p.locator('#resa-card').scrollIntoViewIfNeeded();
      await sleep(1500);
      const probes = [];
      for (let i = 0; i < 5; i++) {
        probes.push(await p.evaluate(MAP_PROBE));
        await p.locator('#route-map').screenshot({ path: shot(`C17-moto-1440-${i + 1}.png`) });
        await sleep(650);
      }
      await p.locator('#resa-card').screenshot({ path: shot('A2-carte-animee-1440.png') });
      await sleep(3000);
      const pr = probes[0], offs = probes.map(q => q.motoOffset);
      const moved = new Set(probes.map(q => Math.round(q.moto.x) + ',' + Math.round(q.moto.y))).size;
      const ok = pr.startToGreen <= 1.5 && pr.endToRed <= 1.5 && pr.pinsInside && Math.max(...offs) <= 3 && moved >= 4;
      await p.close();
      fs.renameSync(await p.video().path(), shot('C17-video-carte-1440.webm'));
      await p.context().close();
      const m = results._c17m;
      record('C17', m.c17m && ok, m.txt + ` · 1440 px (Paris → Orly) : ${pr.startToGreen.toFixed(2)} / ${pr.endToRed.toFixed(2)} px, marqueurs dans le cadre: ${pr.pinsInside ? 'oui' : 'non'}, moto: ${offs.map(o => o.toFixed(2)).join(' / ')} px`, 'vidéos: C17-video-carte-390.webm, C17-video-carte-1440.webm');
    }

    /* ================= C18 : ORS en erreur, retracé, reduced-motion (+ tuiles en erreur) ================= */
    {
      // a) ORS en erreur
      const p = await newPage(browser, 'mobile');
      await p.route('**/api/quote', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Calcul du prix indisponible pour le moment.' }) }));
      await p.goto(BASE + '/#reserver', { waitUntil: 'load' });
      await pickAddress(p, '#f-dep', '160 rue de Rivoli', /75001/);
      await pickAddress(p, '#f-arr', '300 rue de Vaugirard', /75015/);
      await p.waitForSelector('#q-alert:not([hidden])');
      const mapOpen = await p.evaluate(() => document.getElementById('route-map').classList.contains('open'));
      const alertTxt = await p.innerText('#q-alert');
      await p.fill('#f-date', parisDate(3)); await p.fill('#f-time', '10:00');
      await fillContact(p, 'c');
      await sleep(3000);
      await p.locator('#resa-card').screenshot({ path: shot('C18-ors-erreur-390.png') });
      await p.click('#resa-go');
      const formOk = await p.waitForSelector('#done:not([hidden])', { timeout: 10000 }).then(() => true, () => false);
      const errs1 = p.errors.filter(e => !/503/.test(e));
      await p.context().close();

      // b) changement d'adresse → retracé sans recréer la carte
      const q = await newPage(browser, 1440);
      await q.goto(BASE + '/#reserver', { waitUntil: 'load' });
      await pickAddress(q, '#f-dep', '160 rue de Rivoli', /75001/);
      await pickAddress(q, '#f-arr', '300 rue de Vaugirard', /75015/);
      await q.waitForSelector('#route-map.open path.fd-line');
      await sleep(2000);
      const a = await q.evaluate(() => ({ id: document.getElementById('route-map-in')._leaflet_id, n: document.querySelectorAll('#route-map-in .leaflet-map-pane').length, d: document.querySelector('path.fd-line').getAttribute('d') }));
      await pickAddress(q, '#f-arr', 'Aeroport Orly', /94310|Orly/);
      await q.waitForFunction(prev => { const p = document.querySelector('path.fd-line'); return p && p.getAttribute('d') !== prev; }, a.d, { timeout: 10000 });
      await sleep(250);
      const mid = await q.evaluate(() => ({ dash: document.querySelector('path.fd-line').style.strokeDasharray, off: parseFloat(getComputedStyle(document.querySelector('path.fd-line')).strokeDashoffset) }));
      await q.locator('#route-map').screenshot({ path: shot('C18-retrace-en-cours-1440.png') });
      await sleep(1500);
      const b = await q.evaluate(() => ({ id: document.getElementById('route-map-in')._leaflet_id, n: document.querySelectorAll('#route-map-in .leaflet-map-pane').length }));
      await q.locator('#route-map').screenshot({ path: shot('C18-retrace-fin-1440.png') });
      await q.context().close();

      // c) prefers-reduced-motion
      const r = await newPage(browser, 'mobile', { reducedMotion: 'reduce' });
      await r.goto(BASE + '/#reserver', { waitUntil: 'load' });
      await pickAddress(r, '#f-dep', '160 rue de Rivoli', /75001/);
      await pickAddress(r, '#f-arr', '300 rue de Vaugirard', /75015/);
      await r.waitForSelector('#route-map.open path.fd-line');
      await sleep(300);
      const s1 = await r.evaluate(MAP_PROBE);
      await sleep(1200);
      const s2 = await r.evaluate(MAP_PROBE);
      await r.locator('#route-map').screenshot({ path: shot('C18-reduced-motion-390.png') });
      await r.context().close();
      const staticOk = (s1.dash === '' || s1.dash === 'none') && s1.moto && s2.moto && Math.hypot(s1.moto.x - s2.moto.x, s1.moto.y - s2.moto.y) < 0.5 && s1.motoOffset <= 3;

      // d) tuiles en erreur
      const t = await newPage(browser, 'mobile');
      await t.route('**/tile.openstreetmap.org/**', rt => rt.abort());
      await t.goto(BASE + '/#reserver', { waitUntil: 'load' });
      await pickAddress(t, '#f-dep', '160 rue de Rivoli', /75001/);
      await pickAddress(t, '#f-arr', '300 rue de Vaugirard', /75015/);
      await t.waitForSelector('#q-box:not([hidden])');
      await sleep(2500);
      const tileMapOpen = await t.evaluate(() => document.getElementById('route-map').classList.contains('open'));
      const tilePrice = await t.isVisible('#q-total');
      await t.locator('#resa-card').screenshot({ path: shot('C18-tuiles-erreur-390.png') });
      await t.context().close();

      record('C18', !mapOpen && /indisponible/.test(alertTxt) && formOk && a.id === b.id && b.n === 1 && mid.dash !== 'none' && mid.off > 0 && staticOk && !tileMapOpen && tilePrice,
        `ORS 503 → carte: ${mapOpen ? 'affichée' : 'absente'}, message « ${alertTxt.slice(0, 60)}… », formulaire envoyé: ${formOk ? 'oui' : 'non'} · changement d'adresse → même carte (id ${a.id}→${b.id}, ${b.n} carte), retracé animé (dashoffset ${mid.off.toFixed(0)} px à 250 ms) · reduced-motion: tracé sans animation, moto immobile (${Math.hypot(s1.moto.x - s2.moto.x, s1.moto.y - s2.moto.y).toFixed(2)} px en 1,2 s) · tuiles en erreur → carte masquée: ${tileMapOpen ? 'non' : 'oui'}, prix affiché: ${tilePrice ? 'oui' : 'non'}`,
        errs1.length ? 'console: ' + errs1.join(' | ') : '');
    }

    /* ================= C7m : 3 formulaires → e-mails complets ================= */
    {
      const checks = [];
      // Course (envoyée plus haut via l'UI mobile)
      const mc = results._course.m;
      const courseVals = ['Camille', 'Martin', '06 12 34 56 78', 'camille.martin@example.com', 'Casque taille M, merci', '160 Rue de Rivoli 75001 Paris', '300 Rue de Vaugirard 75015 Paris', '14h30', 'Bagages'];
      checks.push({ l: 'Course', ok: mc && /^\[Course\] /.test(mc.subject) && mc.reply_to === 'camille.martin@example.com' && courseVals.every(v => mc.html.includes(v) && mc.text.includes(v)) && /google\.com\/maps\/dir/.test(mc.html), s: mc && mc.subject });

      // Colis (UI desktop)
      const p = await newPage(browser, 1280);
      await p.goto(BASE + '/#reserver', { waitUntil: 'load' });
      await p.click('.tab[data-mode=colis]');
      await fillCalc(p);
      await fillContact(p, 'c');
      await sleep(3000);
      let before = mailFiles();
      await p.click('#resa-go');
      await p.waitForSelector('#done:not([hidden])');
      const mco = newMails(before)[0];
      checks.push({ l: 'Colis', ok: mco && /^\[Colis\] /.test(mco.subject) && mco.reply_to === 'camille.martin@example.com' && !/Bagages/.test(mco.text), s: mco && mco.subject });
      await p.locator('#resa-card').screenshot({ path: shot('A1-confirmation-colis-1280.png') });

      // Plusieurs véhicules (UI, via la carte #services)
      await p.goto(BASE + '/', { waitUntil: 'load' });
      await p.addStyleTag({ content: '.rv{opacity:1!important;transform:none!important}' });
      await p.click('[data-open-tab=flotte]');
      await sleep(900);
      const madVisible = await p.isVisible('#mad-form');
      const md = parisDate(10);
      await p.fill('#m-nb', '4'); await p.selectOption('#m-type', 'événement'); await p.fill('#m-date', md);
      await p.fill('#m-hd', '18:00'); await p.fill('#m-hf', '23:30'); await p.fill('#m-lieu', 'Pavillon Ledoyen, Paris 8e');
      await p.fill('#m-duree', '5 heures 30'); await p.fill('#m-details', 'Navettes invités entre la gare et le lieu');
      await fillContact(p, 'm'); await p.fill('#m-soc', 'Agence Lumière');
      await p.locator('#resa-card').screenshot({ path: shot('A4-plusieurs-vehicules-1280.png') });
      await sleep(1000);
      before = mailFiles();
      await p.click('#mad-form button[type=submit]');
      await p.waitForSelector('#done:not([hidden])');
      const doneTxt = await p.innerText('#done-text');
      await p.locator('#resa-card').screenshot({ path: shot('A4-confirmation-1280.png') });
      const mm = newMails(before)[0];
      const [, mo, da] = md.split('-');
      const madVals = ['4', 'événement', 'Pavillon Ledoyen, Paris 8e', '5 heures 30', 'Navettes invités', '18h00', '23h30', 'Camille', 'Martin', 'Agence Lumière', '06 12 34 56 78'];
      checks.push({ l: 'Mise à dispo', ok: madVisible && mm && mm.subject === `[Mise à dispo] Demande de devis : 4 véhicules le ${da}/${mo}` && mm.reply_to === 'camille.martin@example.com' && madVals.every(v => mm.html.includes(v) && mm.text.includes(v)) && doneTxt === 'Nous revenons vers vous avec un devis personnalisé.', s: mm && mm.subject });
      await p.context().close();

      // Recrutement (UI mobile)
      const r = await newPage(browser, 'mobile');
      await r.goto(BASE + '/recrutement', { waitUntil: 'load' });
      await r.addStyleTag({ content: '.rv{opacity:1!important;transform:none!important}' });
      const rv = { nom: 'Diallo', prenom: 'Moussa', tel: '07 66 13 98 50', email: 'moussa.diallo@example.com', vehicule_modele: 'Honda Forza 750', vehicule_cylindree: '750 cm3', experience_pro: '6 ans de coursier express', experience_secteur: 'Taxi moto 2 ans, livraison 4 ans', motivations: 'Rouler dans Paris pour une équipe exigeante', horaires: 'Soirs et week-ends' };
      for (const [k, v] of Object.entries(rv)) await r.fill('#r-' + k, v);
      await r.selectOption('#r-disponibilite', 'temps partiel');
      await r.locator('#rec-form').screenshot({ path: shot('A3-recrutement-formulaire-390.png') });
      await sleep(2000);
      before = mailFiles();
      await r.click('#rec-form button[type=submit]');
      await r.waitForSelector('#rec-done:not([hidden])');
      await sleep(600);
      await r.screenshot({ path: shot('A3-recrutement-confirmation-390.png') });
      const mr = newMails(before)[0];
      checks.push({ l: 'Candidature', ok: mr && mr.subject === '[Candidature] Candidature chauffeur : Moussa Diallo' && mr.reply_to === 'moussa.diallo@example.com' && [...Object.values(rv), 'temps partiel'].every(v => mr.html.includes(v) && mr.text.includes(v)), s: mr && mr.subject });
      await r.context().close();

      // Rendu des e-mails
      const e = await newPage(browser, 1280);
      for (const [l, m] of [['course', mc], ['colis', mco], ['mise-a-dispo', mm], ['candidature', mr]]) {
        if (!m) continue;
        await e.goto('file://' + path.join(MAILS, m.file.replace(/\.json$/, '.html')));
        await e.waitForLoadState('networkidle');
        await e.screenshot({ path: shot(`A6-email-${l}.png`), fullPage: true });
      }
      await e.context().close();
      record('C7m', checks.every(c => c.ok), checks.map(c => `${c.l}: ${c.ok ? 'OK' : 'KO'} « ${c.s} »`).join(' · '), 'reply-to = e-mail saisi sur les 3 formulaires');
    }

    /* ================= C11 : lien On recrute + /recrutement ================= */
    {
      const d = await newPage(browser, 1440), m = await newPage(browser, 'mobile');
      await d.goto(BASE + '/', { waitUntil: 'load' });
      await m.goto(BASE + '/', { waitUntil: 'load' });
      const dv = await d.isVisible('.nav-links a[href="/recrutement"]');
      const mv = await m.isVisible('.nav-jobs');
      const fv = await d.locator('footer a[href="/recrutement"]').count();
      await d.locator('#nav').screenshot({ path: shot('C11-nav-1440.png') });
      await m.locator('#nav').screenshot({ path: shot('C11-nav-390.png') });
      await m.click('.nav-jobs');
      await m.waitForURL('**/recrutement');
      const st = (await fetch(BASE + '/recrutement')).status;
      await m.addStyleTag({ content: '.rv{opacity:1!important;transform:none!important}' });
      await m.screenshot({ path: shot('A3-recrutement-390.png'), fullPage: true });
      await d.goto(BASE + '/recrutement', { waitUntil: 'load' });
      await d.addStyleTag({ content: '.rv{opacity:1!important;transform:none!important}' });
      await d.screenshot({ path: shot('A3-recrutement-1440.png'), fullPage: true });
      record('C11', dv && mv && fv === 1 && st === 200, `desktop 1440 (.nav-links): ${dv ? 'visible' : 'absent'} · mobile 390 (à côté du CTA): ${mv ? 'visible' : 'absent'} · footer: ${fv} lien · /recrutement HTTP ${st}`);
      await d.context().close(); await m.context().close();
    }

    /* ================= C13 : desktop pleine largeur ================= */
    {
      const rows = []; let ok = true;
      for (const w of [1280, 1440, 1920]) {
        for (const u of ['/', '/recrutement']) {
          const p = await newPage(browser, w);
          await p.goto(BASE + u, { waitUntil: 'load' });
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
          if (u === '/') await p.screenshot({ path: shot(`C13-accueil-${w}.png`), fullPage: false });
          if (r.sw > 0 || r.notFull || r.over) ok = false;
          rows.push(`${w} ${u}: débord. ${r.sw} px, sections pleine largeur ${r.n - r.notFull}/${r.n}, éléments hors cadre ${r.over}`);
          await p.context().close();
        }
      }
      record('C13', ok, rows.join(' · '));
    }

    /* ================= C15 : console ================= */
    {
      const rows = []; let ok = true;
      for (const kind of ['mobile', 1440]) {
        for (const u of ['/', '/recrutement']) {
          const p = await newPage(browser, kind);
          await p.goto(BASE + u, { waitUntil: 'networkidle' });
          await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { scrollTo(0, y); await new Promise(r => setTimeout(r, 30)); } });
          if (u === '/') {
            await p.goto(BASE + '/#reserver');
            await fillCalc(p);
            await p.waitForSelector('#route-map.open path.fd-line');
            await sleep(2500);
          }
          rows.push(`${kind === 'mobile' ? 390 : kind} ${u}: ${p.errors.length}`);
          if (p.errors.length) { ok = false; rows.push(p.errors.join(' | ').slice(0, 300)); }
          await p.context().close();
        }
      }
      record('C15', ok, 'erreurs console — ' + rows.join(' · '), 'accueil testé avec calcul + carte animée');
    }

    /* ================= C16 : Lighthouse mobile ================= */
    {
      const chrome = chromium.executablePath();
      const lh = (url, tag) => {
        const scores = [];
        for (let i = 0; i < 3; i++) {
          const f = shot(`lh-${tag}-${i}.json`);
          try {
            execSync(`lighthouse ${JSON.stringify(url)} --quiet --only-categories=performance --form-factor=mobile --output=json --output-path=${JSON.stringify(f)} --chrome-flags="--headless=new --no-sandbox"`, { env: { ...process.env, CHROME_PATH: chrome }, stdio: 'ignore', timeout: 180000 });
            scores.push(Math.round(JSON.parse(fs.readFileSync(f, 'utf8')).categories.performance.score * 100));
          } catch (e) { }
        }
        scores.sort((a, b) => a - b);
        return { scores, median: scores[Math.floor(scores.length / 2)] };
      };
      const live = lh(LIVE + '/', 'live');
      const before = lh(BEFORE_LOCAL + '/', 'avant-local');
      const after = lh(BASE + '/', 'apres-local');
      const net = results.C16net;
      const ref = before.median;
      const ok = after.median >= ref - 5 && net.pass;
      record('C16', ok, `Lighthouse mobile perf (médiane de 3) — avant (main, même serveur local): ${before.median} [${before.scores}] · après: ${after.median} [${after.scores}] · écart ${after.median - ref} pts · site en ligne: ${live.median} [${live.scores}] · ${net.value}`);
      delete results.C16net;
    }
  } catch (e) {
    console.error('QA crash:', e);
    results._crash = String(e && e.stack || e);
  } finally {
    await browser.close();
    srv.kill(); srvBefore.kill();
  }

  /* ================= Rapport ================= */
  const ORDER = ['C1', 'C2', 'C4', 'C5', 'C6', 'C7m', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'C18'];
  const LABEL = {
    C1: 'DA intacte (diff pixel ≤ 1 %)', C2: 'API Adresse : Rivoli → Paris, Lille → hors zone', C4: 'Tests unitaires de la grille',
    C5: 'Prix falsifié → prix recalculé', C6: 'Nuit 02h00 : < 24 h bloquée, > 24 h +10 €', C7m: '3 formulaires → e-mail complet (mock)',
    C8: 'Champs vides/invalides → erreur inline, aucun envoi', C9: 'Honeypot / < 3 s → 200 silencieux', C10: 'Textes servis (absents/présents)',
    C11: '« On recrute » desktop + mobile, /recrutement 200', C12: 'Mobile 390 px', C13: 'Desktop 1280/1440/1920', C14: 'Aucune clé, mock hors prod',
    C15: 'Zéro erreur console', C16: 'Lighthouse mobile + Leaflet lazy', C17: 'Carte : tracé, marqueurs, moto, vidéos', C18: 'Carte : erreurs, retracé, reduced-motion'
  };
  const ok = ORDER.filter(k => results[k] && results[k].pass).length;
  const note = Math.round(ok / 17 * 100) / 10;
  const md = [`# QA phase A — itération ${ITER}`, '', `**${ok}/17 critères · note ${String(note).replace('.', ',')}/10**`, '',
    '| # | Critère | ✓ | Valeur mesurée |', '|---|---|---|---|',
    ...ORDER.map(k => `| ${k} | ${LABEL[k]} | ${results[k] ? (results[k].pass ? '✅' : '❌') : '⚠️ non mesuré'} | ${results[k] ? (results[k].value + (results[k].detail ? ' — ' + results[k].detail : '')).replace(/\|/g, '/') : ''} |`),
    '', 'C3, C7 (réel) : phase B.', results._crash ? '\n**Crash :** ' + results._crash : ''].join('\n');
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
  const clean = Object.fromEntries(Object.entries(results).filter(([k]) => !k.startsWith('_c') && k !== '_course'));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ok, note, results: clean }, null, 2));
  console.log(`\n${ok}/17 — note ${note}/10 → ${path.join(OUT, 'report.md')}`);
})();
