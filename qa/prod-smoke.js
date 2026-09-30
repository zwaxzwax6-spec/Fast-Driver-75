const { chromium, devices } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, '..', 'test-output', 'qa', 'prod-smoke') + path.sep;
require('fs').mkdirSync(OUT, { recursive: true });
const PROD = 'https://fast-driver-75.fr';
async function pick(p, sel, q, re) {
  await p.fill(sel, ''); await p.type(sel, q, { delay: 15 }); await p.waitForSelector(sel + '-list .ac-item', { timeout: 15000 });
  const it = p.locator(sel + '-list .ac-item'); const n = await it.count();
  for (let i = 0; i < n; i++) if (re.test(await it.nth(i).innerText())) return it.nth(i).click();
  throw new Error('suggestion introuvable : ' + q);
}
(async () => {
  const b = await chromium.launch();
  const res = {};
  for (const [w, o] of [[390, { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }], [1440, { viewport: { width: 1440, height: 900 } }]]) {
    const ctx = await b.newContext({ ...o, locale: 'fr-FR', timezoneId: 'Europe/Paris', recordVideo: { dir: OUT, size: o.viewport } });
    const p = await ctx.newPage();
    const errs = [], forms = [];
    p.on('console', m => m.type() === 'error' && errs.push(m.text()));
    p.on('pageerror', e => errs.push(String(e)));
    p.on('request', r => { if (/\/api\/(booking|recrutement|mise-a-disposition)/.test(r.url())) forms.push(r.url()); });
    await p.goto(PROD + '/', { waitUntil: 'networkidle', timeout: 60000 });
    await p.evaluate(() => document.getElementById('reserver').scrollIntoView());
    await pick(p, '#f-dep', '160 rue de Rivoli', /75001/);
    await p.evaluate(() => document.getElementById('f-bag-wrap').scrollIntoView({ block: 'start' }));
    await pick(p, '#f-arr', 'CDG T2E', /Terminal 2E[\s\S]*Dépose/);
    await p.waitForSelector('#q-box:not([hidden])', { timeout: 20000 });
    await p.waitForSelector('#route-map.open path.fd-seg', { timeout: 20000 });
    await p.waitForFunction(() => document.getElementById('route-map-in').dataset.anim === 'loop', null, { timeout: 20000 });
    await p.waitForTimeout(1500);
    const meta = (await p.innerText('#route-meta')).replace(/\s+/g, ' ');
    const price = await p.innerText('#q-total');
    const motoVisible = await p.waitForFunction(() => +getComputedStyle(document.querySelector('.fd-moto')).opacity > 0.5, null, { timeout: 6000 }).then(() => true, () => false);
    await p.locator('#resa-card').screenshot({ path: OUT + `prod-calculateur-cdg-t2e-${w}.png` });
    await p.waitForTimeout(3000);
    await p.goto(PROD + '/recrutement', { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    await p.screenshot({ path: OUT + `prod-recrutement-${w}.png` });
    res[w] = { meta, price, motoVisible, errors: errs, formRequests: forms.length };
    await p.close();
    await p.video().saveAs(OUT + `prod-animation-${w}.webm`); // sûr une fois la page fermée
    await ctx.close();
  }
  const st = async u => (await fetch(PROD + u, { redirect: 'follow' })).status;
  res.recrutement = await st('/recrutement'); res.logo = await st('/assets/logo.png');
  console.log(JSON.stringify(res, null, 1));
  await b.close();
})();
