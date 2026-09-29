'use strict';

function env(name, fallback) {
  var v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

/* Le mode mock n'existe qu'en local : ignoré sur tout déploiement Vercel. */
function isMock() {
  if (process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview') return false;
  return process.env.MOCK_EXTERNAL === '1';
}

module.exports = { env: env, isMock: isMock };
