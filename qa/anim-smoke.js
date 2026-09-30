const { chromium, devices } = require('playwright');
const OUT = '../test-output/anim-smoke/';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'fr-FR' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:4175/#reserver', { waitUntil: 'load' });
  await p.addStyleTag({ content: '.rv{opacity:1!important;transform:none!important}' });
  for (const [sel, q, re] of [['#f-dep', '160 rue de Rivoli', /75001/], ['#f-arr', 'Aeroport d\'Orly', /94310/]]) {
    await p.type(sel, q, { delay: 10 }); await p.waitForSelector(sel + '-list .ac-item');
    const items = p.locator(sel + '-list .ac-item'); const n = await items.count();
    for (let i = 0; i < n; i++) if (re.test(await items.nth(i).innerText())) { await items.nth(i).click(); break; }
  }
  const t0 = Date.now();
  for (const ms of [150, 500, 1100, 1700, 2200, 2700, 3600, 4800]) {
    await p.waitForTimeout(Math.max(0, ms - (Date.now() - t0)));
    await p.locator('#route-map').screenshot({ path: OUT + `t${ms}.png` });
    console.log(ms, await p.getAttribute('#route-map-in', 'data-anim'), await p.innerText('#q-total'), await p.locator('.fd-pill').innerText().catch(() => ''));
  }
  const box = await p.locator('.fd-moto-in').boundingBox();
  await p.screenshot({ path: OUT + 'moto-zoom.png', clip: { x: box.x - 12, y: box.y - 12, width: box.width + 24, height: box.height + 24 } });
  console.log('errors', errs);
  await b.close();
})();
