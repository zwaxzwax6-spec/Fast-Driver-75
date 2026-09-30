const { chromium, devices } = require('playwright');
async function pick(p, sel, q, re) {
  await p.fill(sel, ''); await p.type(sel, q, { delay: 10 }); await p.waitForSelector(sel + '-list .ac-item');
  const it = p.locator(sel + '-list .ac-item'); const n = await it.count();
  for (let i = 0; i < n; i++) if (re.test(await it.nth(i).innerText())) return it.nth(i).click();
}
const fps = p => p.evaluate(() => new Promise(ok => { const ts = [], t0 = performance.now(); (function g(n) { ts.push(n); if (n - t0 < 2500) requestAnimationFrame(g); else ok(((ts.length - 1) / ((ts.at(-1) - ts[0]) / 1000)).toFixed(1)); })(t0); }));
(async () => {
  const b = await chromium.launch();
  for (const [name, ctxo] of [['iPhone 390 dpr3', { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }], ['1440 dpr3', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 }]]) {
    const p = await (await b.newContext(ctxo)).newPage();
    await p.goto('http://localhost:4175/#reserver', { waitUntil: 'load' });
    await p.evaluate(() => document.getElementById('resa-card').scrollIntoView());
    console.log(name, '· page au repos :', await fps(p), 'i/s');
    await pick(p, '#f-dep', '160 rue de Rivoli', /75001/); await pick(p, '#f-arr', "Aeroport d'Orly", /94310/);
    await p.waitForSelector('#route-map.open');
    await p.evaluate(() => document.getElementById('route-map').scrollIntoView({ block: 'center' }));
    await p.waitForFunction(() => document.getElementById('route-map-in').dataset.anim === 'loop', null, { timeout: 20000 });
    await p.waitForTimeout(300);
    console.log(name, '· boucle moto   :', await fps(p), 'i/s');
    await p.context().close();
  }
  await b.close();
})();
