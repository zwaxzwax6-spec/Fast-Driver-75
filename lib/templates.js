'use strict';

/* E-mails HTML simples (tableaux, styles inline) + alternative texte brut. */

var PROD_LOGO = 'https://fast-driver-75.fr/assets/logo.png';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escMulti(s) { return esc(s).replace(/\r?\n/g, '<br>'); }

function mapsUrl(from, to) {
  return 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(from) +
    '&destination=' + encodeURIComponent(to) + '&travelmode=driving';
}

function button(b, primary) {
  var bg = primary ? '#141414' : '#FFFFFF';
  var fg = primary ? '#FFFFFF' : '#141414';
  return '<a href="' + esc(b.href) + '" style="display:inline-block;margin:0 8px 8px 0;padding:12px 22px;border-radius:999px;' +
    'background:' + bg + ';color:' + fg + ';border:1.5px solid #141414;font-weight:700;font-size:14px;text-decoration:none;font-family:Arial,Helvetica,sans-serif">' +
    esc(b.label) + '</a>';
}

function rowsHtml(rows) {
  return rows.filter(function (r) { return r[1] !== '' && r[1] != null; }).map(function (r, i) {
    return '<tr>' +
      '<td style="padding:10px 12px;border-top:' + (i ? '1px solid #E6E6E6' : '0') + ';font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#595959;font-weight:700;width:38%;vertical-align:top">' + esc(r[0]) + '</td>' +
      '<td style="padding:10px 12px;border-top:' + (i ? '1px solid #E6E6E6' : '0') + ';font-size:15px;color:#141414;vertical-align:top">' + escMulti(r[1]) + '</td>' +
      '</tr>';
  }).join('');
}

function priceHtml(price) {
  if (!price) return '';
  if (price.unavailable) {
    return '<p style="margin:18px 0 0;padding:14px 16px;background:#F4F4F4;border-radius:14px;font-size:15px;color:#141414"><b>Prix : à confirmer</b> (calcul indisponible au moment de la demande)</p>';
  }
  var lines = price.lines.map(function (l) {
    return '<tr><td style="padding:6px 12px;font-size:14px;color:#595959">' + esc(l.label) + '</td>' +
      '<td style="padding:6px 12px;font-size:14px;color:#141414;text-align:right;white-space:nowrap">' + esc(l.amountText) + '</td></tr>';
  }).join('');
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;background:#F4F4F4;border-radius:14px">' +
    lines +
    '<tr><td style="padding:12px;border-top:1px solid #DADADA;font-size:16px;font-weight:700;color:#141414">Prix estimatif</td>' +
    '<td style="padding:12px;border-top:1px solid #DADADA;font-size:20px;font-weight:800;color:#141414;text-align:right;white-space:nowrap">' + esc(price.totalText) + '</td></tr>' +
    '</table>';
}

function layout(o) {
  var buttons = (o.buttons || []).map(function (b, i) { return button(b, i === 0); }).join('');
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(o.subject) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#EFEFEF;font-family:Arial,Helvetica,sans-serif;color:#141414">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EFEFEF"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:22px;overflow:hidden">' +
    '<tr><td style="background:#141414;padding:22px 28px" align="left"><img src="' + esc(o.logoUrl || PROD_LOGO) + '" width="96" height="65" alt="Fast Driver 75" style="display:block;border:0;width:96px;height:auto"></td></tr>' +
    '<tr><td style="padding:28px">' +
    '<p style="margin:0;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#595959;font-weight:700">' + esc(o.kicker) + '</p>' +
    '<h1 style="margin:8px 0 0;font-size:24px;line-height:1.2;color:#141414">' + esc(o.title) + '</h1>' +
    (o.intro ? '<p style="margin:10px 0 0;font-size:15px;line-height:1.55;color:#595959">' + esc(o.intro) + '</p>' : '') +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border:1px solid #E6E6E6;border-radius:14px;border-collapse:separate">' +
    rowsHtml(o.rows) + '</table>' +
    priceHtml(o.price) +
    (o.note ? '<p style="margin:12px 0 0;font-size:13px;color:#595959">' + esc(o.note) + '</p>' : '') +
    (buttons ? '<div style="margin-top:22px">' + buttons + '</div>' : '') +
    '</td></tr>' +
    '<tr><td style="padding:18px 28px;border-top:1px solid #E6E6E6;font-size:12px;color:#6E6E6E">Fast Driver 75 · Taxi moto &amp; livraison express · Paris &amp; Île-de-France · 07 66 13 98 50</td></tr>' +
    '</table></td></tr></table></body></html>';
}

function text(o) {
  var out = [o.title, ''];
  if (o.intro) out.push(o.intro, '');
  o.rows.forEach(function (r) {
    if (r[1] === '' || r[1] == null) return;
    var v = String(r[1]);
    out.push(r[0] + ' : ' + (v.indexOf('\n') !== -1 ? '\n  ' + v.replace(/\r?\n/g, '\n  ') : v));
  });
  if (o.price) {
    out.push('');
    if (o.price.unavailable) out.push('Prix : à confirmer (calcul indisponible au moment de la demande)');
    else {
      o.price.lines.forEach(function (l) { out.push('  ' + l.label + ' : ' + l.amountText); });
      out.push('Prix estimatif : ' + o.price.totalText);
    }
  }
  if (o.note) out.push('', o.note);
  if (o.buttons && o.buttons.length) {
    out.push('');
    o.buttons.forEach(function (b) { out.push(b.label + ' : ' + b.href); });
  }
  out.push('', '--', 'Fast Driver 75 · Paris & Île-de-France · 07 66 13 98 50');
  return out.join('\n');
}

function render(o) { return { html: layout(o), text: text(o) }; }

module.exports = { render: render, mapsUrl: mapsUrl, esc: esc, PROD_LOGO: PROD_LOGO };
