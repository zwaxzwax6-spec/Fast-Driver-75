const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await p.goto('http://localhost:4175/#reserver', { waitUntil: 'load' });
  await p.addStyleTag({ content: '.rv{opacity:1!important;transform:none!important}' });
  for (const [sel, q, re] of [['#f-dep', '160 rue de Rivoli', /75001/], ['#f-arr', 'Aeroport d\'Orly', /94310/]]) {
    await p.type(sel, q, { delay: 10 }); await p.waitForSelector(sel + '-list .ac-item');
    const items = p.locator(sel + '-list .ac-item'); const n = await items.count();
    for (let i = 0; i < n; i++) if (re.test(await items.nth(i).innerText())) { await items.nth(i).click(); break; }
  }
  await p.waitForFunction(() => document.getElementById('route-map-in').dataset.anim === 'loop');
  await p.waitForTimeout(2000);
  await p.locator('#route-map').scrollIntoViewIfNeeded();
  await p.waitForFunction(() => { const o = [...document.querySelectorAll('.fd-spark')].map(d => +d.style.opacity); const m = document.querySelector('.fd-moto-in').getBoundingClientRect(), b = document.getElementById('route-map').getBoundingClientRect(); return o[10] > 0.1 && Math.abs(m.y + 14 - (b.y + b.height / 2)) < 30; }, null, { timeout: 15000 });
  await p.waitForTimeout(0);
  const info = await p.evaluate(() => {
    const i = [...document.querySelectorAll('.fd-spark i')].map(e => e.getBoundingClientRect()), m = document.querySelector('.fd-moto-in').getBoundingClientRect();
    return { moto: [m.x + 14, m.y + 14].map(Math.round), sparks: i.slice(0, 14).map(r => [Math.round(r.x + 5), Math.round(r.y + 5)]), ops: [...document.querySelectorAll('.fd-spark')].map(d => d.style.opacity).join(',') };
  });
  console.log(JSON.stringify(info));
  await p.evaluate(() => { window.__raf = requestAnimationFrame; });
  await p.screenshot({ path: '../test-output/anim-smoke/trail-zoom.png', clip: { x: info.moto[0] - 110, y: info.moto[1] - 90, width: 220, height: 180 } });
  await p.locator('#route-map').screenshot({ path: '../test-output/anim-smoke/trail-map.png' });
  const mb = await p.locator('#route-map').boundingBox();
  console.log('map box', JSON.stringify(mb));
  await b.close();
})();
