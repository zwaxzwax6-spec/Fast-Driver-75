'use strict';
/* Serveur local équivalent à `vercel dev` : fichiers statiques + cleanUrls + /api/*.js.
   Charge .env.local. Usage : node scripts/dev-server.js [port] */
var http = require('http');
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var ROOT = process.env.FD_ROOT ? path.resolve(process.env.FD_ROOT) : path.join(__dirname, '..');
var PORT = Number(process.argv[2] || process.env.PORT || 3000);

(function loadEnv() {
  var f = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(f)) return;
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach(function (line) {
    var m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  });
})();
process.env.VERCEL_ENV = process.env.VERCEL_ENV || 'development';

var TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
var BLOCKED = /^\/(\.|lib\/|scripts\/|tests\/|qa\/|test-output\/|node_modules\/|package)/;

http.createServer(function (req, res) {
  var url = new URL(req.url, 'http://localhost');
  var p = decodeURIComponent(url.pathname);

  if (p.indexOf('/api/') === 0) {
    var name = p.slice(5).replace(/[^a-z0-9-]/gi, '');
    var file = path.join(ROOT, 'api', name + '.js');
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
    delete require.cache[require.resolve(file)];
    return Promise.resolve(require(file)(req, res)).catch(function (e) { console.error(e); res.statusCode = 500; res.end(); });
  }

  // cleanUrls : /page.html -> /page (308), /page -> page.html
  if (/\.html$/.test(p)) {
    res.statusCode = 308;
    res.setHeader('Location', p === '/index.html' ? '/' : p.replace(/\.html$/, ''));
    return res.end();
  }
  if (p.length > 1 && p.endsWith('/')) { res.statusCode = 308; res.setHeader('Location', p.slice(0, -1)); return res.end(); }
  var target = p === '/' ? '/index.html' : (path.extname(p) ? p : p + '.html');
  var abs = path.join(ROOT, path.normalize(target));
  if (abs.indexOf(ROOT) !== 0 || BLOCKED.test(target) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  res.setHeader('Content-Type', TYPES[path.extname(abs)] || 'application/octet-stream');
  var gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && /html|javascript|css|json|svg/.test(res.getHeader('Content-Type'));
  if (gz) { res.setHeader('Content-Encoding', 'gzip'); fs.createReadStream(abs).pipe(zlib.createGzip()).pipe(res); }
  else fs.createReadStream(abs).pipe(res);
}).listen(PORT, function () {
  console.log('Fast Driver local : http://localhost:' + PORT + ' (mock=' + (process.env.MOCK_EXTERNAL === '1') + ')');
});
