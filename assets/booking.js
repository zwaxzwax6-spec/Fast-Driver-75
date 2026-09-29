/* Fast Driver 75 — carte de réservation : Course | Colis | Plusieurs véhicules.
   Le prix affiché est indicatif ; /api/booking recalcule tout côté serveur. */
(function () {
  'use strict';

  var card = document.getElementById('resa-card');
  if (!card || !window.FD || !window.FDPricing) return;
  var FD = window.FD, P = window.FDPricing;

  var LEAFLET = {
    css: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
    cssSri: 'sha512-h9FcoyWjHcOcmEVkxOfTLnmZFWIH0iZhZT1H2TbOq55xssQGEJHEaIm+PgoUaZbRvQTNTluNOEfb1ZRy6D3BOw==',
    js: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
    jsSri: 'sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g=='
  };
  var WA = 'https://wa.me/33766139850';

  var $ = function (id) { return document.getElementById(id); };
  var tabs = card.querySelectorAll('.tab');
  var calc = $('calc-form'), mad = $('mad-form'), done = $('done');
  var el = {
    dep: $('f-dep'), arr: $('f-arr'), date: $('f-date'), time: $('f-time'), bag: $('f-bag'), bagWrap: $('f-bag-wrap'),
    alert: $('q-alert'), quote: $('quote'), wait: $('q-wait'), box: $('q-box'), lines: $('q-lines'), total: $('q-total'),
    note: $('q-note'), meta: $('route-meta'), map: $('route-map'), mapIn: $('route-map-in')
  };

  var state = { mode: 'course', from: null, to: null, route: null, routeKey: '', seq: 0, failed: false };

  /* ---------- Onglets ---------- */
  function setMode(mode) {
    state.mode = mode;
    tabs.forEach(function (t) {
      var on = t.dataset.mode === mode;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    var isFleet = mode === 'flotte';
    done.hidden = true;
    calc.hidden = isFleet;
    mad.hidden = !isFleet;
    el.bagWrap.hidden = mode !== 'course';
    el.bag.disabled = mode !== 'course';
    renderPrice();
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { setMode(t.dataset.mode); });
    t.addEventListener('keydown', function (e) {
      var k = e.key, n = tabs.length, j = -1;
      if (k === 'ArrowRight') j = (i + 1) % n;
      else if (k === 'ArrowLeft') j = (i - 1 + n) % n;
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); setMode(t.dataset.mode); return; }
      if (j >= 0) { e.preventDefault(); tabs[j].focus(); setMode(tabs[j].dataset.mode); }
    });
  });
  document.querySelectorAll('[data-open-tab]').forEach(function (a) {
    a.addEventListener('click', function () { setMode(a.dataset.openTab); });
  });

  var today = FD.todayParis();
  el.date.min = today;
  $('m-date').min = today;

  /* ---------- Adresses ---------- */
  FD.autocomplete(el.dep, $('f-dep-list'), {
    onSelect: function (p) { state.from = p; requestQuote(); },
    onClear: function () { state.from = null; clearQuote(); }
  });
  FD.autocomplete(el.arr, $('f-arr-list'), {
    onSelect: function (p) { state.to = p; requestQuote(); },
    onClear: function () { state.to = null; clearQuote(); }
  });

  /* ---------- Date / heure : règle de nuit ---------- */
  function pickup() {
    if (!el.date.value || !el.time.value) return { night: false, error: null, incomplete: true };
    return P.checkPickup(el.date.value, el.time.value);
  }
  function onWhen() {
    var pk = pickup();
    var msg = pk.error ? P.PICKUP_MESSAGES[pk.error] : '';
    FD.setError(calc, 'time', msg);
    renderPrice();
  }
  el.date.addEventListener('change', onWhen);
  el.time.addEventListener('change', onWhen);
  el.bag.addEventListener('change', renderPrice);

  /* ---------- Devis ---------- */
  function clearQuote() {
    state.seq++;
    state.route = null;
    state.routeKey = '';
    state.failed = false;
    el.quote.hidden = true;
    el.alert.hidden = true;
    closeMap();
  }

  function requestQuote() {
    if (!state.from || !state.to) return;
    var key = [state.from.lon, state.from.lat, state.to.lon, state.to.lat].join(',');
    if (key === state.routeKey && state.route) { renderPrice(); return; }
    state.routeKey = key;
    var my = ++state.seq;
    el.quote.hidden = false;
    el.alert.hidden = true;
    el.wait.hidden = false;
    FD.post('/api/quote', {
      mode: state.mode === 'colis' ? 'colis' : 'course',
      from: { lon: state.from.lon, lat: state.from.lat },
      to: { lon: state.to.lon, lat: state.to.lat }
    }).then(function (r) {
      if (my !== state.seq) return;
      el.wait.hidden = true;
      if (r.status === 200 && r.json.ok) {
        state.failed = false;
        state.route = { km: r.json.distanceKm, min: r.json.durationMin, geometry: r.json.geometry };
        renderPrice();
        showMap(state.route.geometry);
      } else {
        state.route = null;
        state.failed = true;
        closeMap();
        renderPrice();
        el.alert.textContent = (r.json && r.json.error && r.status === 400 ? r.json.error + '. ' : 'Calcul du prix indisponible pour le moment. ') +
          'Vous pouvez tout de même envoyer votre demande : Fast Driver vous communique le tarif.';
        el.alert.hidden = false;
      }
    });
  }

  function renderPrice() {
    var r = state.route;
    if (!r || state.mode === 'flotte') {
      el.box.hidden = el.note.hidden = el.meta.hidden = true;
      return;
    }
    var pk = pickup();
    var price = P.computePrice({ mode: state.mode, km: r.km, bagages: Number(el.bag.value || 0), night: pk.night });
    el.lines.innerHTML = price.lines.map(function (l) {
      return '<div class="q-line"><span>' + FD.esc(l.label) + '</span><b>' + P.fmtEur(l.amount) + '</b></div>';
    }).join('');
    el.total.textContent = P.fmtEur(price.total);
    el.meta.querySelector('span').textContent = P.fmtKm(r.km) + ' km · environ ' + r.min + ' min';
    el.quote.hidden = false;
    el.box.hidden = el.note.hidden = el.meta.hidden = false;
    state.price = price;
  }

  /* ---------- Carte (Leaflet en lazy load, au premier calcul uniquement) ---------- */
  var mapLoading = null;
  function loadCss(href, sri) {
    return new Promise(function (ok, ko) {
      var l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = href; l.integrity = sri; l.crossOrigin = 'anonymous';
      l.onload = ok; l.onerror = ko;
      document.head.appendChild(l);
    });
  }
  function loadJs(src, sri) {
    return new Promise(function (ok, ko) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      if (sri) { s.integrity = sri; s.crossOrigin = 'anonymous'; }
      s.onload = ok; s.onerror = ko;
      document.head.appendChild(s);
    });
  }
  function loadMap() {
    if (!mapLoading) {
      mapLoading = Promise.all([loadCss(LEAFLET.css, LEAFLET.cssSri), loadJs(LEAFLET.js, LEAFLET.jsSri)])
        .then(function () { return window.FDMap || loadJs('/assets/route-map.js'); })
        .then(function () { return window.FDMap; });
      mapLoading.catch(function () { mapLoading = null; });
    }
    return mapLoading;
  }
  function showMap(geometry) {
    var my = state.seq;
    loadMap().then(function (FDMap) {
      if (my !== state.seq) return;
      el.map.classList.add('open');
      FDMap.show(el.mapIn, geometry, { onFail: closeMap });
    }).catch(closeMap);
  }
  function closeMap() {
    el.map.classList.remove('open');
    if (window.FDMap) window.FDMap.stop();
  }

  /* ---------- Envoi Course / Colis ---------- */
  function busy(form, on) {
    var b = form.querySelector('button[type=submit]');
    b.disabled = on;
    b.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  calc.addEventListener('submit', function (e) {
    e.preventDefault();
    FD.clearErrors(calc);
    var pk = pickup();
    var extra = {
      from: state.from ? '' : (el.dep.value.trim() ? 'Choisissez l’adresse de départ dans la liste.' : 'Champ obligatoire.'),
      to: state.to ? '' : (el.arr.value.trim() ? 'Choisissez l’adresse d’arrivée dans la liste.' : 'Champ obligatoire.'),
      time: pk.error && !pk.incomplete && pk.error !== 'invalide' ? P.PICKUP_MESSAGES[pk.error] : ''
    };
    var errors = FD.check(calc, extra);
    if (FD.showErrors(calc, errors)) return;

    var v = FD.values(calc);
    var data = FD.antispam({
      mode: state.mode, from: state.from.label, to: state.to.label, date: v.date, time: v.time,
      bagages: state.mode === 'course' ? v.bagages : '0',
      prenom: v.prenom, nom: v.nom, tel: v.tel, email: v.email, commentaire: v.commentaire
    }, calc);
    busy(calc, true);
    FD.post('/api/booking', data).then(function (r) {
      busy(calc, false);
      if (r.status === 200 && r.json.ok) return showBookingDone(data, r.json);
      if (r.json && r.json.errors) return FD.showErrors(calc, r.json.errors, r.json.error);
      calc.querySelector('.form-err').textContent = (r.json && r.json.error) || 'Envoi impossible pour le moment. Réessayez dans un instant.';
    });
  });

  function recapRows(rows) {
    return rows.map(function (r) {
      return '<div class="q-line"><span>' + FD.esc(r[0]) + '</span><b>' + FD.esc(r[1]) + '</b></div>';
    }).join('');
  }

  function frWhen(date, time) {
    var d = date.split('-');
    return d[2] + '/' + d[1] + '/' + d[0] + ' à ' + time.replace(':', 'h');
  }

  function showBookingDone(data, res) {
    var when = frWhen(data.date, data.time);
    var priceText = res.price ? res.price.totalText : 'à confirmer';
    $('done-title').textContent = 'Demande envoyée';
    $('done-text').textContent = 'Merci ' + data.prenom + '. Fast Driver vous confirme votre ' +
      (data.mode === 'colis' ? 'livraison' : 'course') + ' et le tarif définitif très vite.';
    var rows = [['Départ', res.from || data.from], ['Arrivée', res.to || data.to], ['Prise en charge', when]];
    if (data.mode === 'course') rows.push(['Bagages', data.bagages]);
    $('done-box').innerHTML = recapRows(rows) +
      '<div class="q-total"><span>Prix estimatif</span><b>' + FD.esc(priceText) + '</b></div>';
    $('done-box').hidden = false;
    var lines = [
      'Bonjour Fast Driver,',
      'Je viens d’envoyer une demande ' + (data.mode === 'colis' ? 'de livraison de colis' : 'de course taxi moto') + ' depuis le site :',
      '- Départ : ' + (res.from || data.from),
      '- Arrivée : ' + (res.to || data.to),
      '- Quand : ' + when
    ];
    if (data.mode === 'course') lines.push('- Bagages : ' + data.bagages);
    lines.push('- Prix estimatif : ' + priceText.replace(' ', ' '), '- Nom : ' + data.prenom + ' ' + data.nom, 'Merci !');
    var wa = $('done-wa');
    wa.href = WA + '?text=' + encodeURIComponent(lines.join('\n'));
    wa.hidden = false;
    openDone();
  }

  /* ---------- Envoi Plusieurs véhicules ---------- */
  mad.addEventListener('submit', function (e) {
    e.preventDefault();
    FD.clearErrors(mad);
    var v = FD.values(mad);
    var extra = { date: v.date && v.date < FD.todayParis() ? 'Cette date est déjà passée.' : '' };
    if (FD.showErrors(mad, FD.check(mad, extra))) return;
    var data = FD.antispam(v, mad);
    busy(mad, true);
    FD.post('/api/mise-a-disposition', data).then(function (r) {
      busy(mad, false);
      if (r.status === 200 && r.json.ok) {
        $('done-title').textContent = 'Demande envoyée';
        $('done-text').textContent = 'Nous revenons vers vous avec un devis personnalisé.';
        $('done-box').hidden = true;
        $('done-wa').hidden = true;
        return openDone();
      }
      if (r.json && r.json.errors) return FD.showErrors(mad, r.json.errors, r.json.error);
      mad.querySelector('.form-err').textContent = (r.json && r.json.error) || 'Envoi impossible pour le moment. Réessayez dans un instant.';
    });
  });

  function openDone() {
    calc.hidden = mad.hidden = true;
    card.querySelector('.tabs').hidden = true;
    done.hidden = false;
    done.focus({ preventScroll: true });
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('done-new').addEventListener('click', function () {
    calc.reset();
    mad.reset();
    el.dep.dispatchEvent(new Event('input'));
    el.arr.dispatchEvent(new Event('input'));
    state.from = state.to = null;
    clearQuote();
    FD.clearErrors(calc);
    FD.clearErrors(mad);
    card.querySelector('.tabs').hidden = false;
    setMode(state.mode);
  });

  setMode('course');
})();
