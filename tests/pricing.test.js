const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/pricing.js');

test('C4 grille officielle', () => {
  assert.equal(P.computePrice({ mode: 'course', km: 6 }).total, 30);
  assert.equal(P.computePrice({ mode: 'colis', km: 10 }).total, 30);
  assert.equal(P.computePrice({ mode: 'course', km: 15 }).total, 40);
  assert.equal(P.computePrice({ mode: 'colis', km: 15 }).total, 39);
  assert.equal(P.computePrice({ mode: 'course', km: 15, bagages: 1, night: true }).total, 55);
  assert.equal(P.computePrice({ mode: 'colis', km: 12.3 }).total, 34.14);
});

test('distance arrondie à 0,1 km avant calcul', () => {
  assert.equal(P.roundKm(12.34), 12.3);
  assert.equal(P.roundKm(12.35), 12.4);
  assert.equal(P.computePrice({ mode: 'colis', km: 12.34 }).km, 12.3);
  assert.equal(P.computePrice({ mode: 'colis', km: 12.34 }).total, 34.14);
});

test('lignes de détail', () => {
  const r = P.computePrice({ mode: 'course', km: 15, bagages: 2, night: true });
  assert.deepEqual(r.lines.map(l => l.amount), [30, 10, 5, 5, 10]);
  assert.equal(r.total, 60);
});

test('bagages ignorés pour les colis, bornés 0..3', () => {
  assert.equal(P.computePrice({ mode: 'colis', km: 5, bagages: 3 }).total, 30);
  assert.throws(() => P.computePrice({ mode: 'course', km: 5, bagages: 4 }));
  assert.throws(() => P.computePrice({ mode: 'course', km: -1 }));
  assert.throws(() => P.computePrice({ mode: 'velo', km: 5 }));
});

test('pas d’erreur de flottant', () => {
  assert.equal(P.computePrice({ mode: 'colis', km: 10.1 }).total, 30.18);
  assert.equal(P.computePrice({ mode: 'course', km: 33.3 }).total, 76.6);
});

test('fmtEur', () => {
  assert.equal(P.fmtEur(34.14), '34,14 €');
  assert.equal(P.fmtEur(30), '30,00 €');
});

test('heure de Paris -> UTC, été et hiver', () => {
  assert.equal(P.parisWallToUtc('2026-07-01', '02:00').toISOString(), '2026-07-01T00:00:00.000Z');
  assert.equal(P.parisWallToUtc('2026-12-01', '02:00').toISOString(), '2026-12-01T01:00:00.000Z');
  assert.equal(P.parisWallToUtc('2026-10-25', '12:00').toISOString(), '2026-10-25T11:00:00.000Z');
});

test('C6 règle nuit : 24 h à l’avance', () => {
  const now = new Date('2026-09-30T10:00:00Z'); // 12h00 à Paris
  const soon = P.checkPickup('2026-10-01', '02:00', now); // dans 14 h
  assert.equal(soon.night, true);
  assert.equal(soon.error, 'nuit24h');
  const later = P.checkPickup('2026-10-02', '02:00', now); // dans 38 h
  assert.equal(later.night, true);
  assert.equal(later.error, null);
  const day = P.checkPickup('2026-09-30', '15:00', now);
  assert.equal(day.night, false);
  assert.equal(day.error, null);
  assert.equal(P.checkPickup('2026-09-30', '07:59', now).error, 'passe');
  assert.equal(P.checkPickup('2026-10-05', '07:59', now).night, true);
  assert.equal(P.checkPickup('2026-10-05', '08:00', now).night, false);
  assert.equal(P.checkPickup('2026-10-05', '00:00', now).night, true);
  assert.equal(P.checkPickup('bad', '25:00', now).error, 'invalide');
});

test('codes postaux IDF', () => {
  for (const cp of ['75001', '77000', '78000', '91000', '92100', '93200', '94000', '95000']) assert.ok(P.isIdfPostcode(cp));
  for (const cp of ['59000', '60000', '7500', '', null, '2A004']) assert.ok(!P.isIdfPostcode(cp));
});
