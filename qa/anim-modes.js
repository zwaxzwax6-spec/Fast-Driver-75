const { chromium } = require('playwright');
async function pick(p, sel, q, re) {
  await p.fill(sel, ''); await p.type(sel, q, { delay: 10 }); await p.waitForSelector(sel + '-list .ac-item');
  const it = p.locator(sel + '-list .ac-item'); const n = await it.count();
  for (let i = 0; i < n; i++) if (re.test(await it.nth(i).innerText())) return it.nth(i).click();
  throw new Error('no ' + q);
}
(async () => {
  const b = await chromium.launch();
  // 1) changement d'adresse
  let p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { window.__s = []; const t0 = performance.now(); new MutationObserver(ms => ms.forEach(m => { if (m.attributeName === 'data-anim') window.__s.push(m.target.dataset.anim + '@' + Math.round(performance.now() - t0)); })).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-anim'] }); });
  await p.goto('http://localhost:4175/#reserver'); await p.addStyleTag({ content: '.rv{opacity:1!important;transform:none!important}' });
  await pick(p, '#f-dep', '160 rue de Rivoli', /75001/); await pick(p, '#f-arr', '300 rue de Vaugirard', /75015/);
  await p.waitForFunction(() => document.getElementById('route-map-in').dataset.anim === 'loop');
  const id1 = await p.evaluate(() => document.getElementById('route-map-in')._leaflet_id);
  await pick(p, '#f-arr', "Aeroport d'Orly", /94310/);
  await p.waitForFunction(() => document.getElementById('route-map-in').dataset.anim === 'loop', null, { timeout: 15000 });
  console.log('retrace:', (await p.evaluate(() => window.__s)).join(' → '), '| même carte:', id1 === await p.evaluate(() => document.getElementById('route-map-in')._leaflet_id), '| segs:', await p.locator('path.fd-seg').count());
  // 2) reduced-motion
  p = await (await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })).newPage();
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:4175/#reserver');
  await pick(p, '#f-dep', '160 rue de Rivoli', /75001/); await pick(p, '#f-arr', "Aeroport d'Orly", /94310/);
  await p.waitForSelector('#route-map.open path.fd-seg'); await p.waitForTimeout(600);
  const r = await p.evaluate(() => ({ anim: document.getElementById('route-map-in').dataset.anim, allShown: [...document.querySelectorAll('path.fd-seg')].every(e => e.style.opacity === '1.000'), pill: document.querySelector('.fd-pill').textContent, total: document.getElementById('q-total').textContent, moto: document.querySelector('.fd-moto').style.transform }));
  await p.waitForTimeout(1000);
  console.log('reduced:', JSON.stringify(r), '| moto immobile:', r.moto === await p.evaluate(() => document.querySelector('.fd-moto').style.transform));
  await p.locator('#route-map').screenshot({ path: '../test-output/anim-smoke/reduced.png' });
  console.log('errors', errs);
  await b.close();
})();
