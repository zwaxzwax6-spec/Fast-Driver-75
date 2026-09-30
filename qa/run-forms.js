/* Recette responsive des formulaires : R1–R5 mesurés au navigateur (390, 430, 768 px) sur les 4 formulaires.
   Usage : QA_BASE=<url> [vc env run --] node qa/run-forms.js <dossier>   (jeton OIDC seulement pour une preview)
   → test-output/qa/<dossier>/{forms-report.md, forms-*.png} */
'use strict';
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, '..');
const BASE = (process.env.QA_BASE || 'https://fast-driver-75.fr').replace(/\/$/, '');
const HOST = new URL(BASE).host;
const TOKEN = process.env.VERCEL_OIDC_TOKEN;
const OUT = path.join(SITE, 'test-output', 'qa', process.argv[2] || 'forms');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const WIDTHS = {
  390: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
  430: { ...devices['iPhone 13'], viewport: { width: 430, height: 932 } },
  768: { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
};
const FORMS = [
  { id: 'course', url: '/#reserver', sel: '#calc-form', card: '#resa-card' },
  { id: 'colis', url: '/#reserver', sel: '#calc-form', card: '#resa-card', tab: 'colis' },
  { id: 'plusieurs-vehicules', url: '/#reserver', sel: '#mad-form', card: '#resa-card', tab: 'flotte' },
  { id: 'recrutement', url: '/recrutement', sel: '#rec-form', card: '#rec-form' }
];

async function open(browser, w, form) {
  const ctx = await browser.newContext({ ...WIDTHS[w], locale: 'fr-FR' });
  if (TOKEN) await ctx.route('**/*', r => new URL(r.request().url()).host === HOST
    ? r.continue({ headers: { ...r.request().headers(), 'x-vercel-trusted-oidc-idp-token': TOKEN } }) : r.fallback());
  const p = await ctx.newPage();
  await p.goto(BASE + form.url, { waitUntil: 'networkidle', timeout: 60000 });
  await p.addStyleTag({ content: '.rv{opacity:1!important;transform:none!important;transition:none!important}' });
  if (form.tab) await p.click(`.tab[data-mode=${form.tab}]`);
  await sleep(300);
  return p;
}

/* Mesures statiques dans la page (R1, R2, R3, R5). */
const MEASURE = (sel) => {
  const form = document.querySelector(sel);
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden]') && !e.closest('.hp'); };
  const ctrl = f => f.querySelector('input:not([type=hidden]),select,textarea');
  // R1 : lignes à 2 colonnes réellement côte à côte
  const rows = [];
  form.querySelectorAll('.row2').forEach(row => {
    const fs = [...row.children].filter(f => f.classList.contains('field') && vis(f));
    if (fs.length !== 2) return;
    const a = ctrl(fs[0]).getBoundingClientRect(), b = ctrl(fs[1]).getBoundingClientRect();
    if (b.left < a.right) return; // empilés (une colonne)
    rows.push({ fields: fs.map(f => f.dataset.field).join('+'), dTop: Math.abs(a.top - b.top), dBottom: Math.abs(a.bottom - b.bottom) });
  });
  // R2 : libellés sur une seule ligne (nombre de lignes du texte)
  const labels = [...form.querySelectorAll('.field label')].filter(vis).map(l => {
    const range = document.createRange(); range.selectNodeContents(l);
    const tops = new Set([...range.getClientRects()].filter(r => r.width > 0 && r.height > 9).map(r => Math.round(r.top)));
    return { text: l.textContent.trim(), lines: tops.size };
  });
  // R3 : aucun placeholder / texte tronqué
  const cv = document.createElement('canvas').getContext('2d');
  const trunc = [...form.querySelectorAll('input[placeholder],select')].filter(vis).filter(e => !['date', 'time'].includes(e.type)).map(e => {
    const cs = getComputedStyle(e);
    cv.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = e.tagName === 'SELECT' ? e.options[e.selectedIndex].text : e.placeholder;
    const avail = e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const need = cv.measureText(text).width;
    return { name: e.name || e.id, text, need: Math.round(need), avail: Math.round(avail), scroll: e.scrollWidth <= e.clientWidth, ok: e.scrollWidth <= e.clientWidth && need <= avail + 0.5 };
  });
  // Champs natifs date/heure : leur contenu (jj/mm/aaaa, --:--, icône) ne doit pas déborder.
  [...form.querySelectorAll('input[type=date],input[type=time]')].filter(vis).forEach(e => {
    const cs = getComputedStyle(e);
    cv.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = e.type === 'date' ? 'mm/dd/yyyy' : '--:-- --';
    const need = cv.measureText(text).width + 22; // + icône du sélecteur natif
    const avail = e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    trunc.push({ name: e.name, text, need: Math.round(need), avail: Math.round(avail), ok: e.scrollWidth <= e.clientWidth && need <= avail + 0.5 });
  });
  // R5 : marges gauche/droite du formulaire, pas de scroll horizontal
  const r = form.getBoundingClientRect(), vw = document.documentElement.clientWidth;
  return { rows, labels, trunc, margins: { left: r.left, right: vw - r.right }, hscroll: document.documentElement.scrollWidth - vw };
};

/* R4 : bouton WhatsApp flottant contre tous les champs et le bouton d'envoi, en parcourant le formulaire. */
async function fabCheck(p, sel) {
  const hits = [];
  const probe = () => p.evaluate(sel => {
    const fab = document.querySelector('.fab'), cs = getComputedStyle(fab);
    const shown = cs.visibility !== 'hidden' && +cs.opacity > 0.02;
    if (!shown) return { shown, hits: [] };
    const f = fab.getBoundingClientRect(), out = [];
    document.querySelectorAll(sel + ' input:not([tabindex="-1"]),' + sel + ' select,' + sel + ' textarea,' + sel + ' button[type=submit]').forEach(e => {
      if (e.closest('[hidden]') || e.closest('.hp')) return;
      const r = e.getBoundingClientRect();
      if (!r.width) return;
      const ix = Math.max(0, Math.min(f.right, r.right) - Math.max(f.left, r.left)), iy = Math.max(0, Math.min(f.bottom, r.bottom) - Math.max(f.top, r.top));
      if (ix * iy > 0) out.push((e.name || e.id || e.type) + ' ' + Math.round(ix * iy) + ' px²');
    });
    return { shown, hits: out };
  }, sel);
  const box = await p.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY }; }, sel);
  const vh = await p.evaluate(() => innerHeight);
  let shownSteps = 0;
  for (let y = Math.max(0, box.top - vh); y <= box.bottom; y += 90) {
    await p.evaluate(y => window.scrollTo(0, y), y);
    await sleep(260);
    const r = await probe();
    if (r.shown) shownSteps++;
    r.hits.forEach(h => hits.push(`défilement ${Math.round(y)} px : ${h}`));
  }
  // Focus sur chaque champ (clavier ouvert sur mobile)
  const names = await p.evaluate(sel => [...document.querySelectorAll(sel + ' input:not([tabindex="-1"]),' + sel + ' select,' + sel + ' textarea')].filter(e => !e.closest('[hidden]')).map((e, i) => { e.dataset.qaIdx = i; return i; }), sel);
  for (const i of names) {
    await p.evaluate(({ sel, i }) => { const e = document.querySelector(`${sel} [data-qa-idx="${i}"]`); e.scrollIntoView({ block: 'center' }); e.focus(); }, { sel, i });
    await sleep(260);
    (await probe()).hits.forEach(h => hits.push(`focus : ${h}`));
  }
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  return { hits, shownSteps };
}

(async () => {
  const browser = await chromium.launch();
  const R = { R1: [], R2: [], R3: [], R4: [], R5: [] };
  const lines = [];
  for (const w of [390, 430, 768]) for (const form of FORMS) {
    const p = await open(browser, w, form);
    await p.locator(form.sel).scrollIntoViewIfNeeded();
    const m = await p.evaluate(MEASURE, form.sel);
    const tag = `${form.id} ${w}px`;
    m.rows.forEach(r => R.R1.push({ tag, ok: r.dTop < 0.5 && r.dBottom < 0.5, v: `${r.fields} Δhaut ${r.dTop.toFixed(1)} / Δbas ${r.dBottom.toFixed(1)} px` }));
    if (w < 560) m.labels.forEach(l => R.R2.push({ tag, ok: l.lines === 1, v: `« ${l.text} » ${l.lines} ligne(s)` }));
    m.trunc.forEach(t => R.R3.push({ tag, ok: t.ok, v: `${t.name} « ${t.text} » ${t.need}/${t.avail} px` }));
    R.R5.push({ tag, ok: Math.abs(m.margins.left - m.margins.right) <= 1 && m.hscroll <= 0, v: `marges ${m.margins.left.toFixed(1)} / ${m.margins.right.toFixed(1)} px, scroll horizontal ${m.hscroll} px` });
    if (w === 390) {
      await p.locator(form.card).scrollIntoViewIfNeeded();
      await p.locator(form.card).screenshot({ path: path.join(OUT, `forms-${form.id}-390.png`) });
      // Vue écran « bas du formulaire » : là où le bouton flottant gênait
      await p.evaluate(sel => { const e = document.querySelector(sel + ' button[type=submit]'); e.scrollIntoView({ block: 'end' }); window.scrollBy(0, 40); }, form.sel);
      await sleep(300);
      await p.screenshot({ path: path.join(OUT, `forms-${form.id}-390-ecran-bas.png`) });
    }
    const f = await fabCheck(p, form.sel);
    R.R4.push({ tag, ok: f.hits.length === 0, v: f.hits.length ? f.hits.slice(0, 3).join(' | ') : `aucun chevauchement (bouton visible sur ${f.shownSteps} positions)` });
    await p.context().close();
  }
  await browser.close();

  const res = {};
  for (const k of ['R1', 'R2', 'R3', 'R4', 'R5']) {
    const bad = R[k].filter(x => !x.ok);
    res[k] = { pass: R[k].length > 0 && bad.length === 0, n: R[k].length, bad };
    lines.push(`${res[k].pass ? 'PASS' : 'FAIL'} ${k} — ${R[k].length - bad.length}/${R[k].length} conformes` + (bad.length ? ' · ' + bad.slice(0, 6).map(b => `${b.tag} : ${b.v}`).join(' · ') : ''));
  }
  const md = [`# Formulaires responsive — ${BASE}`, '', ...lines.map(l => '- ' + l), '', '## Détail', '',
    ...['R1', 'R2', 'R3', 'R4', 'R5'].flatMap(k => [`### ${k}`, ...R[k].map(x => `- ${x.ok ? '✅' : '❌'} ${x.tag} — ${x.v}`), ''])].join('\n');
  fs.writeFileSync(path.join(OUT, 'forms-report.md'), md);
  fs.writeFileSync(path.join(OUT, 'forms-report.json'), JSON.stringify(res, null, 1));
  lines.forEach(l => console.log(l));
  if (Object.values(res).some(r => !r.pass)) process.exitCode = 1;
})();
