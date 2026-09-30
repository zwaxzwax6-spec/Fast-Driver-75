const { chromium, devices } = require('playwright');
async function pick(p, sel, q, re) {
  await p.fill(sel, ''); await p.type(sel, q, { delay: 10 }); await p.waitForSelector(sel + '-list .ac-item');
  const it = p.locator(sel + '-list .ac-item'); const n = await it.count();
  for (let i = 0; i < n; i++) if (re.test(await it.nth(i).innerText())) return it.nth(i).click();
}
(async () => {
  const b = await chromium.launch();
  for (const o of [{ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }, { viewport: { width: 1440, height: 900 } }]) {
    const p = await (await b.newContext(o)).newPage();
    await p.addInitScript(() => { window.__seq = []; const t0 = performance.now(), log = k => window.__seq.push(k + '@' + Math.round(performance.now() - t0));
      new MutationObserver(ms => ms.forEach(m => { const el = m.target;
        if (m.attributeName === 'data-anim') log('anim:' + el.dataset.anim);
        if (m.attributeName === 'class') { if (el.classList.contains('rm-in') && el.classList.contains('rm-shown') && !window.__s) { window.__s = 1; log('a'); }
          if (el.classList.contains('fd-pin') && el.classList.contains('on')) log(el.querySelector('.dot.g') ? 'b' : 'd');
          if (el.classList.contains('fd-pill') && el.classList.contains('on')) log('e'); } })).observe(document, { subtree: true, attributes: true, attributeFilter: ['class', 'data-anim'] }); });
    await p.goto('http://localhost:4175/#reserver');
    await pick(p, '#f-dep', '160 rue de Rivoli', /75001/);
    await p.evaluate(() => document.getElementById('f-bag-wrap').scrollIntoView({ block: 'start' }));
    await pick(p, '#f-arr', "Aeroport d'Orly", /94310/);
    await p.waitForFunction(() => document.getElementById('route-map-in').dataset.anim === 'loop', null, { timeout: 20000 });
    console.log(o.viewport.width, (await p.evaluate(() => window.__seq)).join(' → '));
    await p.context().close();
  }
  await b.close();
})();
