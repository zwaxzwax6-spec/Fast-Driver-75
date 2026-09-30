const { chromium } = require('playwright');
async function pick(p, sel, q, re) {
  await p.fill(sel, ''); await p.type(sel, q, { delay: 10 }); await p.waitForSelector(sel + '-list .ac-item');
  const it = p.locator(sel + '-list .ac-item'); const n = await it.count();
  for (let i = 0; i < n; i++) if (re.test(await it.nth(i).innerText())) return it.nth(i).click();
}
const VARIANTS = {
  'tel quel': '',
  'sans backdrop-filter': '.fd-pill{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',
  'sans ombres des points': '.fd-spark i{box-shadow:none!important}',
  'sans filtre gris des tuiles': '.route-map .fd-tiles{filter:none!important}',
  'sans will-change': '.fd-spark,.fd-moto{will-change:auto!important}',
};
(async () => {
  const b = await chromium.launch();
  for (const dpr of [1, 3]) for (const [name, css] of Object.entries(VARIANTS)) {
    const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr })).newPage();
    await p.goto('http://localhost:4175/#reserver');
    if (css) await p.addStyleTag({ content: css });
    await pick(p, '#f-dep', '160 rue de Rivoli', /75001/); await pick(p, '#f-arr', "Aeroport d'Orly", /94310/);
    await p.locator('#route-map').scrollIntoViewIfNeeded();
    await p.waitForFunction(() => document.getElementById('route-map-in').dataset.anim === 'loop', null, { timeout: 15000 });
    const f = await p.evaluate(() => new Promise(ok => { const ts = [], t0 = performance.now(); (function g(n) { ts.push(n); if (n - t0 < 2500) requestAnimationFrame(g); else ok(((ts.length - 1) / ((ts.at(-1) - ts[0]) / 1000)).toFixed(1)); })(t0); }));
    console.log(`dpr ${dpr} · ${name.padEnd(28)} ${f} i/s`);
    await p.context().close();
  }
  await b.close();
})();
