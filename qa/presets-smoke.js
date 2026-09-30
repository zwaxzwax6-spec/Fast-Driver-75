const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } })).newPage();
  await p.goto('http://localhost:4175/#reserver');
  for (const q of ['CDG T2E', 'Aéroport Charles de Gaulle', 'Lyon', 'Beauvais', 'gare']) {
    await p.fill('#f-arr', ''); await p.type('#f-arr', q, { delay: 10 });
    await p.waitForTimeout(1400);
    const items = await p.locator('#f-arr-list .ac-item').evaluateAll(els => els.map(e => (e.classList.contains('ac-preset') ? '★ ' : '') + e.innerText.replace(/\n/g, ' / ')));
    console.log(`« ${q} » → msg="${await p.innerText('#f-arr-err')}"\n   ` + items.slice(0, 11).join('\n   '));
    if (q === 'Aéroport Charles de Gaulle') await p.locator('#resa-card').screenshot({ path: '../test-output/anim-smoke/presets.png' });
  }
  await b.close();
})();
