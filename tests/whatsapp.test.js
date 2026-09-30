const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Ref = require(path.join(ROOT, 'lib/reference.js'));
const WA = require(path.join(ROOT, 'assets/whatsapp.js'));

const REF_RE = /^FD-[0-9A-HJKMNP-TV-Z]{4}$/;

test('numéro de réservation : format FD-XXXX (alphabet sans I, L, O, U)', () => {
  const r = Ref.createRef(Date.parse('2026-10-01T12:00:00Z'));
  assert.match(r, REF_RE);
});

test('numéro de réservation : unique pour chaque minute pendant environ 2 ans (bijection)', () => {
  const seen = new Set();
  const start = Ref.EPOCH_MS;
  for (let m = 0; m < Ref.CYCLE_MIN; m++) seen.add(Ref.codeForMinute(m));
  assert.equal(seen.size, Ref.CYCLE_MIN);
  assert.ok(Ref.CYCLE_MIN * 60000 >= 720 * 24 * 3600e3, 'cycle ≥ 720 jours');
  assert.ok(start <= Date.parse('2026-10-01T00:00:00Z'));
});

test('numéro de réservation : deux demandes dans la même minute ont deux numéros différents', () => {
  const g = Ref.generator();
  const now = Date.parse('2026-10-01T12:00:10Z');
  const refs = [g(now), g(now), g(now + 1000), g(now + 60000)];
  assert.equal(new Set(refs).size, refs.length);
  refs.forEach(r => assert.match(r, REF_RE));
});

test('numéro de réservation : consécutifs mais pas visiblement séquentiels', () => {
  const a = Ref.codeForMinute(1000), b = Ref.codeForMinute(1001);
  let same = 0;
  for (let i = 0; i < 4; i++) if (a[i] === b[i]) same++;
  assert.ok(same <= 2, a + ' / ' + b);
});

test('lien WhatsApp : wa.me sur mobile, WhatsApp Web sur ordinateur, texte encodé', () => {
  const text = 'Bonjour Fast Driver, je souhaite réserver :\nRéservation FD-AB12\nPrix estimatif : 35,00 € & plus ?';
  const m = new URL(WA.link(text, false));
  assert.equal(m.origin + m.pathname, 'https://wa.me/33766139850');
  assert.equal(m.searchParams.get('text'), text);
  const d = new URL(WA.link(text, true));
  assert.equal(d.origin + d.pathname, 'https://web.whatsapp.com/send');
  assert.equal(d.searchParams.get('phone'), '33766139850');
  assert.equal(d.searchParams.get('text'), text);
});

test('détection ordinateur : iPhone, Android et iPad (UA Mac tactile) = mobile', () => {
  assert.equal(WA.isDesktop({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', maxTouchPoints: 5 }), false);
  assert.equal(WA.isDesktop({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36', maxTouchPoints: 5 }), false);
  assert.equal(WA.isDesktop({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', maxTouchPoints: 5 }), false);
  assert.equal(WA.isDesktop({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', maxTouchPoints: 0 }), true);
  assert.equal(WA.isDesktop({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128 Safari/537.36', maxTouchPoints: 0 }), true);
});
