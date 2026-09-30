const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 768, height: 1024 } })).newPage();
  await p.goto('http://localhost:4175/#reserver');
  await p.fill('#c-tel', '06 12 34 56 78'); await p.fill('#c-email', 'pas-un-mail'); await p.fill('#c-prenom', 'Camille');
  await p.click('#resa-go');
  const r = await p.evaluate(() => {
    const pair = (a, b) => { const x = document.querySelector(a).getBoundingClientRect(), y = document.querySelector(b).getBoundingClientRect(); return { dTop: Math.abs(x.top - y.top), dBottom: Math.abs(x.bottom - y.bottom) }; };
    return { telEmail: pair('#c-tel', '#c-email'), prenomNom: pair('#c-prenom', '#c-nom'), emailErr: document.querySelector('[data-field=email]').classList.contains('invalid'), telErr: document.querySelector('[data-field=tel]').classList.contains('invalid') };
  });
  console.log(JSON.stringify(r));
  await b.close();
})();
