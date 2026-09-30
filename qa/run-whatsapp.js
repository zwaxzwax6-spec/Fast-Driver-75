/* Recette « Réserver via WhatsApp » : W1–W6.
   Preview (vrais ORS + Resend, jeton OIDC fourni par la CLI, jamais affiché) :
     QA_BASE=https://<preview>.vercel.app vc env run -- node qa/run-whatsapp.js <iteration>
   Local (serveur de dev en mock, e-mails écrits dans test-output/emails) :
     QA_BASE=http://127.0.0.1:3100 node qa/run-whatsapp.js local
   Production (smoke, AUCUN formulaire envoyé : /api/booking est intercepté et simulé) :
     QA_BASE=https://fast-driver-75.fr QA_PROD=1 node qa/run-whatsapp.js prod
   WebKit (W3) : charger d'abord les bibliothèques système extraites (voir wkenv.sh).
   Aucune conversation WhatsApp n'est jamais ouverte : toute navigation vers wa.me / whatsapp.com
   est notée puis bloquée au niveau du contexte navigateur (fenêtres surgissantes comprises). */
'use strict';
const { chromium, webkit, devices } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, '..');
const P = require(path.join(SITE, 'assets/pricing.js'));
const WA = require(path.join(SITE, 'assets/whatsapp.js'));
const ITER = process.argv[2] || '1';
const OUT = path.join(SITE, 'test-output', 'qa', 'whatsapp-iter-' + ITER);
const BASE = (process.env.QA_BASE || '').replace(/\/$/, '');
const HOST = new URL(BASE).host;
const LOCAL = /^(127\.0\.0\.1|localhost)(:|$)/.test(HOST);
const PROD = process.env.QA_PROD === '1';
const TOKEN = process.env.VERCEL_OIDC_TOKEN;
const RESEND = process.env.RESEND_API_KEY;
const FROM_DOMAIN = '@fast-driver-75.fr';
const RUN = 'QA' + Date.now().toString(36).slice(-6);
if (!BASE || (!LOCAL && !PROD && (!TOKEN || !RESEND))) { console.error('QA_BASE (+ VERCEL_OIDC_TOKEN et RESEND_API_KEY sur une preview) requis'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const results = {};
function record(id, pass, value) {
  results[id] = { pass: !!pass, value };
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} — ${value}`);
}
const shot = name => path.join(OUT, name);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WA_HOST = /(^|\.)(wa\.me|whatsapp\.com)$/;
const decode = u => { const x = new URL(u); return { base: x.origin + x.pathname, phone: x.searchParams.get('phone'), text: x.searchParams.get('text') }; };

function hfetch(url, opts = {}) {
  const h = { ...(opts.headers || {}) };
  if (TOKEN && new URL(url).host === HOST) h['x-vercel-trusted-oidc-idp-token'] = TOKEN;
  return fetch(url, { ...opts, headers: h });
}
const post = (u, b) => hfetch(BASE + u, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(b) })
  .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) }));

/* ---------- E-mails : Resend (preview) ou fichiers du mock (local) ---------- */
let lastResend = 0;
async function resend(p) {
  const wait = 650 - (Date.now() - lastResend);
  if (wait > 0) await sleep(wait);
  lastResend = Date.now();
  const r = await fetch('https://api.resend.com' + p, { headers: { Authorization: 'Bearer ' + RESEND } });
  if (r.status === 429) { await sleep(1500); return resend(p); }
  return r.json();
}
const parseTs = s => Date.parse(String(s).replace(' ', 'T').replace(/\+00$/, 'Z'));
async function mailsSince(since, marker) {
  if (LOCAL) {
    const dir = path.join(SITE, 'test-output', 'emails');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.json') && fs.statSync(path.join(dir, f)).mtimeMs >= since)
      .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
      .filter(m => [m.subject, m.to.join(','), m.html, m.text].join('\n').includes(marker))
      .map(m => ({ ...m, last_event: 'delivered (mock)' }));
  }
  const list = await resend('/emails?limit=100');
  const out = [];
  for (const e of (list.data || []).filter(e => String(e.from).includes(FROM_DOMAIN) && parseTs(e.created_at) >= since)) {
    const d = await resend('/emails/' + e.id);
    if ([d.subject, (d.to || []).join(','), d.html, d.text].join('\n').includes(marker)) out.push(d);
  }
  return out;
}
async function waitMails(since, marker, n, timeoutMs = 150000) {
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
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + daysAhead * 864e5));
}
const fr = iso => iso.split('-').reverse().join('/');

async function newContext(browser, kind) {
  const opts = kind === 'iphone'
    ? { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
  const ctx = await browser.newContext({ ...opts, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  ctx.waNav = [];
  ctx.popups = 0;
  await ctx.route('**/*', route => {
    const req = route.request();
    const u = new URL(req.url());
    if (WA_HOST.test(u.host)) {
      ctx.waNav.push({ url: req.url(), nav: req.isNavigationRequest(), t: Date.now() });
      // 204 : la navigation est annulée sans page d'erreur, la page du site reste affichée.
      return route.fulfill({ status: 204, body: '' });
    }
    if (TOKEN && u.host === HOST) return route.continue({ headers: { ...req.headers(), 'x-vercel-trusted-oidc-idp-token': TOKEN } });
    return route.fallback();
  });
  ctx.on('page', () => { ctx.popups++; });
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', e => page.errors.push(String(e)));
  if (PROD) {
    // Production : aucune demande réellement envoyée. Réponse simulée, construite comme le serveur.
    await page.route(/\/api\/(booking|mise-a-disposition)$/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(page.fakeReply) }));
  }
  return page;
}
async function pickAddress(page, sel, query, matchRe) {
  await page.fill(sel, '');
  await page.type(sel, query, { delay: 15 });
  await page.waitForSelector(`${sel}-list .ac-item:not(.ac-preset)`, { timeout: 15000 });
  const items = page.locator(`${sel}-list .ac-item`);
  const n = await items.count();
  for (let i = 0; i < n; i++) if (matchRe.test(await items.nth(i).innerText())) { await items.nth(i).click(); return; }
  throw new Error('aucune suggestion ' + matchRe + ' pour ' + query);
}
const clientMail = tag => `delivered+${RUN.toLowerCase()}-${tag}@resend.dev`;

/* Texte attendu, reconstruit ici indépendamment du serveur à partir des champs saisis et du prix recalculé. */
function expectedBooking(ref, f, res) {
  const lines = ['Bonjour Fast Driver, je souhaite réserver :', 'Réservation ' + ref, 'Service : ' + (f.mode === 'colis' ? 'Colis' : 'Course'),
    'Départ : ' + res.from, 'Arrivée : ' + res.to, `Date : ${fr(f.date)} à ${f.time.replace(':', 'h')}`];
  if (f.mode === 'course') lines.push('Bagages : ' + f.bagages);
  lines.push(`Distance : ${res.km != null ? P.fmtKm(res.km) + ' km' : 'à confirmer'} · Prix estimatif : ${res.price ? P.fmtEur(res.price.total) : 'à confirmer'}`);
  lines.push(`Nom : ${f.prenom} ${f.nom} · Tél : 06 12 34 56 78`);
  if (f.commentaire) lines.push('Commentaire : ' + f.commentaire);
  return lines.join('\n');
}
function expectedMad(ref, f) {
  return ['Bonjour Fast Driver, je souhaite réserver :', 'Réservation ' + ref, 'Service : Mise à disposition',
    'Nombre de véhicules : ' + f.nb, 'Date : ' + fr(f.date), `Horaires : de ${f.hd.replace(':', 'h')} à ${f.hf.replace(':', 'h')}`,
    'Lieu : ' + f.lieu, 'Durée : ' + f.duree, 'Type de prestation : ' + f.type, 'Société : ' + f.societe,
    `Nom : ${f.prenom} ${f.nom} · Tél : 06 12 34 56 78`, 'Commentaire : ' + f.details].join('\n');
}

/* Parcours UI Course/Colis : renvoie ce qui a été capturé (réponse API, navigation WhatsApp, écran). */
async function uiBooking(ctx, mode, tag) {
  const p = await newPage(ctx);
  await p.goto(BASE + '/#reserver', { waitUntil: 'load' });
  await p.addStyleTag({ content: '.rv{opacity:1!important;transform:none!important}' });
  if (mode === 'colis') await p.click('.tab[data-mode=colis]');
  const f = { mode, date: parisDate(3), time: '14:30', bagages: mode === 'course' ? '1' : '0', prenom: 'Camille', nom: 'Martin ' + RUN + '-' + tag, commentaire: mode === 'course' ? 'Casque taille M' : '' };
  await pickAddress(p, '#f-dep', '160 rue de Rivoli', /75001/);
  await pickAddress(p, '#f-arr', '300 rue de Vaugirard', /75015/);
  await p.fill('#f-date', f.date); await p.fill('#f-time', f.time);
  if (mode === 'course') await p.selectOption('#f-bag', f.bagages);
  await p.fill('#c-prenom', f.prenom); await p.fill('#c-nom', f.nom);
  await p.fill('#c-tel', '06 12 34 56 78'); await p.fill('#c-email', clientMail(tag));
  if (f.commentaire) await p.fill('#c-com', f.commentaire);
  await p.waitForSelector('#q-box:not([hidden])', { timeout: 25000 });
  const label = (await p.innerText('#resa-go')).trim();
  const icon = await p.locator('#resa-go svg').count();
  const q = await p.evaluate(() => document.querySelector('#route-meta span').textContent);
  const km = parseFloat(q.replace(',', '.'));
  const ui = { from: await p.inputValue('#f-dep'), to: await p.inputValue('#f-arr'), km, price: P.computePrice({ mode, km, bagages: +f.bagages, night: false }) };
  await sleep(3200); // anti-spam : > 3 s sur la page
  if (PROD) {
    const { from, to, price } = ui;
    const ref = 'FD-TEST';
    const text = expectedBooking(ref, f, ui);
    p.fakeReply = { ok: true, ref, from, to, when: fr(f.date) + ' à 14h30', price: { total: price.total, totalText: P.fmtEur(price.total) }, whatsapp: { text, url: WA.link(text, false) } };
  }
  const before = ctx.waNav.length, popupsBefore = ctx.popups;
  const respP = p.waitForResponse(r => /\/api\/booking$/.test(r.url()), { timeout: 30000 });
  const t0 = Date.now();
  await p.click('#resa-go');
  const resp = await respP;
  const json = await resp.json().catch(() => ({}));
  await p.waitForSelector('#done:not([hidden])', { timeout: 20000 });
  for (let i = 0; i < 40 && ctx.waNav.length === before; i++) await sleep(100);
  await sleep(600);
  const nav = ctx.waNav.slice(before);
  const screen = {
    title: await p.innerText('#done-title'), text: await p.innerText('#done-text'),
    btnVisible: await p.isVisible('#done-wa'), btnText: (await p.innerText('#done-wa').catch(() => '')).trim(), btnHref: await p.getAttribute('#done-wa', 'href')
  };
  return { p, f, ui, json, nav, t0, popups: ctx.popups - popupsBefore, screen, label, icon, errors: p.errors };
}

(async () => {
  const t0mail = Date.now() - 10000;
  const wk = await webkit.launch();
  const cr = await chromium.launch();
  const refs = [];
  try {
    /* ============ W1 (unitaire) ============ */
    if (!PROD) {
      let unit = '';
      try { unit = execSync('node --test tests/', { cwd: SITE, encoding: 'utf8' }); } catch (e) { unit = String(e.stdout || ''); }
      const w1 = ['W1 course', 'W1 colis', 'W1 mise à disposition'].map(n => new RegExp('^ok \\d+ - ' + n, 'm').test(unit));
      const pass = +(/# pass (\d+)/.exec(unit) || [])[1], fail = +(/# fail (\d+)/.exec(unit) || [])[1];
      results._unit = { w1, pass, fail };
    }

    /* ============ Course : iPhone 390 WebKit (W3, W5, W1 bout en bout) ============ */
    const ictx = await newContext(wk, 'iphone');
    const c = await uiBooking(ictx, 'course', 'course');
    if (c.json.ref) refs.push(['Course', c.json.ref, c.f.nom]);
    const cNav = c.nav.filter(n => n.nav);
    const expectC = c.json.ref ? expectedBooking(c.json.ref, c.f, c.ui) : '';
    const dC = cNav[0] ? decode(cNav[0].url) : {};
    await c.p.locator('#resa-card').screenshot({ path: shot('W-confirmation-course-iphone-390.png') });
    await c.p.screenshot({ path: shot('W-confirmation-course-iphone-390-ecran.png') });

    // W5 : « Ouvrir WhatsApp » relance le même lien (vrai clic → fenêtre ouverte par l'utilisateur)
    const beforeBtn = ictx.waNav.length;
    await c.p.click('#done-wa');
    for (let i = 0; i < 40 && ictx.waNav.length === beforeBtn; i++) await sleep(100);
    const again = ictx.waNav.slice(beforeBtn).filter(n => n.nav);
    const popupsBtn = ictx.popups - 1; // la page du parcours
    // Retour depuis WhatsApp sans cache : la page se recharge, l'écran « Dernière étape » doit revenir.
    await c.p.reload({ waitUntil: 'load' });
    const back = await c.p.waitForSelector('#done:not([hidden])', { timeout: 8000 }).then(async () => ({
      title: await c.p.innerText('#done-title'), href: await c.p.getAttribute('#done-wa', 'href'), ref: await c.p.innerText('.done-ref')
    }), () => null);
    const backOk = back && back.title === 'Dernière étape' && back.href === (cNav[0] || {}).url && back.ref.includes(c.json.ref);
    record('W5', c.screen.btnVisible && c.screen.btnText === 'Ouvrir WhatsApp' && c.screen.btnHref === (cNav[0] || {}).url && again.length >= 1 && again[0].url === (cNav[0] || {}).url && popupsBtn === 0 && backOk,
      `bouton visible: ${c.screen.btnVisible ? 'oui' : 'non'} « ${c.screen.btnText} » · href = lien ouvert automatiquement: ${c.screen.btnHref === (cNav[0] || {}).url ? 'oui' : 'non'} · clic → navigation WhatsApp interceptée: ${again.length} (${again[0] ? decode(again[0].url).base : '—'}, même lien: ${again[0] && again[0].url === (cNav[0] || {}).url ? 'oui' : 'non'}, même onglet: ${popupsBtn === 0 ? 'oui' : 'non'}) · retour sur le site : écran « ${back ? back.title : 'absent'} » réaffiché avec ${back ? back.ref : '—'}: ${backOk ? 'oui' : 'NON'}`);

    const cOk = cNav.length === 1 && dC.base === 'https://wa.me/33766139850' && dC.text === expectC;
    record('W3', cOk && c.popups === 0 && !c.errors.some(e => /popup|blocked|window\.open/i.test(e)) && /^Dernière étape$/.test(c.screen.title) && /^Envoyez le message WhatsApp qui vient de s’ouvrir\./.test(c.screen.text),
      `WebKit ${wk.version()} iPhone 13 à 390 px · navigation principale vers ${dC.base || 'AUCUNE'} ${cNav[0] ? (cNav[0].t - c.t0) + ' ms après le clic' : ''} · fenêtres surgissantes: ${c.popups} · écran: « ${c.screen.title} » / « ${c.screen.text.split('\n')[0]} » · erreurs console: ${c.errors.length}`);
    fs.writeFileSync(shot('W-texte-whatsapp-course.txt'), dC.text || '');

    /* ============ Colis : ordinateur 1440 Chromium (lien WhatsApp Web) ============ */
    const dctx = await newContext(cr, 'desktop');
    const k = await uiBooking(dctx, 'colis', 'colis');
    if (k.json.ref) refs.push(['Colis', k.json.ref, k.f.nom]);
    const kNav = k.nav.filter(n => n.nav);
    const dK = kNav[0] ? decode(kNav[0].url) : {};
    const expectK = k.json.ref ? expectedBooking(k.json.ref, k.f, k.ui) : '';
    await k.p.locator('#resa-card').screenshot({ path: shot('W-confirmation-colis-1440.png') });
    const kOk = kNav.length === 1 && dK.base === 'https://web.whatsapp.com/send' && dK.phone === '33766139850' && dK.text === expectK;

    /* ============ Mise à disposition : iPhone 390 WebKit ============ */
    const m = { nb: '4', type: 'événement', date: parisDate(10), hd: '18:00', hf: '23:30', lieu: 'Pavillon Ledoyen, Paris 8e', duree: '5 heures 30', details: 'Navettes invités ' + RUN, prenom: 'Léa', nom: 'Bernard ' + RUN + '-mad', societe: 'Agence Lumière' };
    const mp = await newPage(ictx);
    await mp.goto(BASE + '/', { waitUntil: 'load' });
    await mp.addStyleTag({ content: '.rv{opacity:1!important;transform:none!important}' });
    await mp.click('[data-open-tab=flotte]');
    await sleep(600);
    await mp.fill('#m-nb', m.nb); await mp.selectOption('#m-type', m.type); await mp.fill('#m-date', m.date);
    await mp.fill('#m-hd', m.hd); await mp.fill('#m-hf', m.hf); await mp.fill('#m-lieu', m.lieu);
    await mp.fill('#m-duree', m.duree); await mp.fill('#m-details', m.details);
    await mp.fill('#m-prenom', m.prenom); await mp.fill('#m-nom', m.nom); await mp.fill('#m-tel', '06 12 34 56 78');
    await mp.fill('#m-email', clientMail('mad')); await mp.fill('#m-soc', m.societe);
    const madLabel = (await mp.innerText('#mad-go')).trim();
    await sleep(3200);
    if (PROD) { const text = expectedMad('FD-TEST', m); mp.fakeReply = { ok: true, ref: 'FD-TEST', whatsapp: { text, url: WA.link(text, false) } }; }
    const mb = ictx.waNav.length;
    const mResP = mp.waitForResponse(r => /\/api\/mise-a-disposition$/.test(r.url()), { timeout: 30000 });
    await mp.click('#mad-go');
    const mJson = await (await mResP).json().catch(() => ({}));
    await mp.waitForSelector('#done:not([hidden])', { timeout: 20000 });
    for (let i = 0; i < 40 && ictx.waNav.length === mb; i++) await sleep(100);
    await sleep(600);
    if (mJson.ref) refs.push(['Mise à dispo', mJson.ref, m.nom]);
    const mNav = ictx.waNav.slice(mb).filter(n => n.nav);
    const dM = mNav[0] ? decode(mNav[0].url) : {};
    const mOk = mNav.length === 1 && dM.base === 'https://wa.me/33766139850' && mJson.ref && dM.text === expectedMad(mJson.ref, m);
    await mp.locator('#resa-card').screenshot({ path: shot('W-confirmation-mise-a-dispo-iphone-390.png') });
    fs.writeFileSync(shot('W-texte-whatsapp-mise-a-dispo.txt'), dM.text || '');
    fs.writeFileSync(shot('W-texte-whatsapp-colis.txt'), dK.text || '');

    const u = results._unit;
    record('W1', (PROD || (u.w1.every(Boolean) && u.fail === 0)) && cOk && kOk && mOk,
      (PROD ? '' : `tests unitaires W1 course/colis/mise à dispo: ${u.w1.map(x => x ? 'ok' : 'KO').join('/')} (npm test ${u.pass}/${u.pass + u.fail}) · `) +
      `bout en bout, lien décodé = texte attendu : Course (wa.me, iPhone) ${cOk ? 'oui' : 'NON'} · Colis (WhatsApp Web, 1440) ${kOk ? 'oui' : 'NON'} · Mise à dispo (wa.me, iPhone) ${mOk ? 'oui' : 'NON'}` +
      ` · boutons « ${c.label} » / « ${madLabel} », icône WhatsApp: ${c.icon ? 'oui' : 'non'}`);

    // Capture du texte WhatsApp généré (rendu bulle)
    const bp = await newPage(ictx);
    await bp.setContent(`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body id="w" style="margin:0;background:#efeae2;font:15px/1.4 -apple-system,Helvetica,Arial,sans-serif;padding:18px">
      <div style="font-size:12px;color:#54656f;margin-bottom:8px">Aperçu du message prérempli (lien intercepté, jamais envoyé) · vers +33 7 66 13 98 50</div>
      <div style="max-width:330px;margin-left:auto;background:#d9fdd3;border-radius:10px 0 10px 10px;padding:8px 10px;white-space:pre-wrap;box-shadow:0 1px .5px rgba(0,0,0,.13)" id="b"></div></body>`);
    await bp.evaluate(t => { document.getElementById('b').textContent = t; }, dC.text || '');
    await bp.locator('#w').screenshot({ path: shot('W-texte-whatsapp-course-390.png') });
    await bp.evaluate(t => { document.getElementById('b').textContent = t; }, dM.text || '');
    await bp.locator('#w').screenshot({ path: shot('W-texte-whatsapp-mise-a-dispo-390.png') });

    if (!PROD) {
      /* ============ W2 : prix falsifié ============ */
      const quote = c.ui.price;
      const fake = await post('/api/booking', {
        mode: 'course', from: '160 Rue de Rivoli 75001 Paris', to: '300 Rue de Vaugirard 75015 Paris', date: parisDate(3), time: '14:30', bagages: '1',
        prenom: 'Camille', nom: 'Martin ' + RUN + '-W2', tel: '0612345678', email: clientMail('w2'), commentaire: '', website: '', elapsed: 8000,
        price: 1, total: 1, totalText: '1,00 €', distanceKm: 0.1, km: 0.1
      });
      const fText = fake.json.whatsapp ? decode(fake.json.whatsapp.url).text : '';
      if (fake.json.ref) refs.push(['Course prix falsifié', fake.json.ref, 'Martin ' + RUN + '-W2']);
      const fKm = kmFrom(fText);
      const want = fKm != null ? P.computePrice({ mode: 'course', km: fKm, bagages: 1, night: false }).total : NaN;
      record('W2', fake.status === 200 && fake.json.price && fake.json.price.total === want && fText.includes('Prix estimatif : ' + P.fmtEur(want)) && !/\b1,00|0,1 km/.test(fText) && quote && Math.abs(quote.total - want) < 0.001,
        `POST avec price=1, totalText « 1,00 € », km=0,1 → message « ${(fText.split('\n').find(l => l.startsWith('Distance')) || '—')} » · prix serveur ${fake.json.price ? P.fmtEur(fake.json.price.total) : '—'} = grille pour ${fKm != null ? P.fmtKm(fKm) : '?'} km + 1 bagage (${P.fmtEur(want)}) = prix de l’UI ${quote ? P.fmtEur(quote.total) : '—'}`);

      /* ============ W6 : anti-spam, validation, erreurs inline ============ */
      const spam = [];
      for (const ep of ['/api/booking', '/api/mise-a-disposition']) {
        spam.push(await post(ep, { mode: 'course', prenom: 'Spam ' + RUN, website: 'http://spam', elapsed: 9000 }));
        spam.push(await post(ep, { mode: 'course', prenom: 'Spam ' + RUN, website: '', elapsed: 1200 }));
      }
      const bad = await post('/api/booking', { mode: 'course', from: '160 Rue de Rivoli 75001 Paris', to: '300 Rue de Vaugirard 75015 Paris', date: parisDate(3), time: '14:30', prenom: '', nom: 'X', tel: '12', email: 'x@', website: '', elapsed: 8000 });
      const vp = await newPage(ictx);
      await vp.goto(BASE + '/#reserver', { waitUntil: 'load' });
      await vp.addStyleTag({ content: '.rv{opacity:1!important;transform:none!important}' });
      const calls = [];
      vp.on('request', r => { if (/\/api\/(booking|mise-a-disposition)/.test(r.url())) calls.push(r.url()); });
      const nb = ictx.waNav.length;
      await vp.click('#resa-go');
      const inlC = await vp.locator('#calc-form .field.invalid').count();
      await vp.click('[data-open-tab=flotte]').catch(() => vp.click('.tab[data-mode=flotte]'));
      await vp.click('#mad-go');
      const inlM = await vp.locator('#mad-form .field.invalid').count();
      await vp.locator('#resa-card').screenshot({ path: shot('W6-erreurs-inline-390.png') });
      await sleep(800);
      const spamOk = spam.every(r => r.status === 200 && r.json.ok === true && !r.json.ref && !r.json.whatsapp);
      results._w6 = { spamOk, bad, inlC, inlM, calls: calls.length, nav: ictx.waNav.length - nb, spam };
    }

    /* ============ W4 : e-mails « delivered » avec le même FD-XXXX ============ */
    if (!PROD) {
      const all = await waitMails(t0mail, RUN, refs.length);
      const rows = refs.map(([l, ref, marker]) => {
        const mm = all.find(x => x.subject.includes(ref) && (x.to || []).some(t => t === 'delivered@resend.dev') && (x.html || '').includes(marker));
        return { l, ref, m: mm, ok: !!mm && /^delivered/.test(mm.last_event) && mm.text.includes(ref) };
      });
      const distinct = new Set(refs.map(r => r[1])).size === refs.length;
      record('W4', rows.length === 4 && rows.every(r => r.ok) && distinct,
        `numéros tous distincts: ${distinct ? 'oui' : 'NON'} · ` + rows.map(r => `${r.l}: ${r.ref} → « ${r.m ? r.m.subject.replace(new RegExp(' ?' + RUN + '\\S*', 'g'), '') : 'absent'} » (${r.m ? r.m.last_event : '—'})`).join(' · '));
      const spamMails = await mailsSince(t0mail, 'Spam ' + RUN);
      const w = results._w6;
      record('W6', w.spamOk && spamMails.length === 0 && w.bad.status === 400 && ['prenom', 'tel', 'email'].every(x => w.bad.json.errors && w.bad.json.errors[x]) && w.inlC >= 6 && w.inlM >= 8 && w.calls === 0 && w.nav === 0,
        `honeypot ×2 + envoi < 3 s ×2 → ${w.spam.map(r => r.status).join('/')}, sans numéro ni lien, e-mails: ${spamMails.length} · champs invalides → HTTP ${w.bad.status} (${Object.keys(w.bad.json.errors || {}).join(', ')}) · formulaires vides : ${w.inlC} erreurs inline (Course), ${w.inlM} (Plusieurs véhicules), requêtes envoyées: ${w.calls}, WhatsApp ouvert: ${w.nav} (C1–C20 et R1–R5 : recettes dédiées)`);
    } else {
      record('PROD', cOk && kOk && mOk && c.popups === 0 && c.screen.btnVisible,
        `réponse API simulée (aucun envoi) · liens interceptés décodés conformes : Course ${cOk ? 'oui' : 'NON'}, Colis ${kOk ? 'oui' : 'NON'}, Mise à dispo ${mOk ? 'oui' : 'NON'} · erreurs console: ${c.errors.length + k.errors.length}`);
    }
  } catch (e) {
    console.error('QA crash:', e);
    results._crash = String(e && e.stack || e);
  } finally {
    await wk.close();
    await cr.close();
  }
  const ORDER = PROD ? ['W1', 'W3', 'W5', 'PROD'] : ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'];
  const ok = ORDER.filter(k => results[k] && results[k].pass).length;
  const md = [`# Recette WhatsApp — itération ${ITER}`, '', `Cible : ${BASE}`, `Marqueur : ${RUN}`, `Numéros : ${refs.map(r => r[0] + ' ' + r[1]).join(' · ')}`, '',
    `**${ok}/${ORDER.length}**`, '', '| # | ✓ | Valeur mesurée |', '|---|---|---|',
    ...ORDER.map(k => `| ${k} | ${results[k] ? (results[k].pass ? '✅' : '❌') : '⚠️'} | ${results[k] ? results[k].value.replace(/\|/g, '/') : 'non mesuré'} |`),
    results._crash ? '\n**Crash :** ' + results._crash : ''].join('\n');
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
  console.log(`\n${ok}/${ORDER.length} → ${path.join(OUT, 'report.md')}`);
  process.exitCode = ok === ORDER.length ? 0 : 1;
})();

/* Distance lue dans le message (le serveur fait foi ; comparée ensuite à la grille). */
function kmFrom(text) {
  const m = /Distance : (\d+,\d) km/.exec(text || '');
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}
