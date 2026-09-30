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

  var $ = function (id) { return document.getElementById(id); };
  var tabs = card.querySelectorAll('.tab');
  var calc = $('calc-form'), mad = $('mad-form'), done = $('done');
  var el = {
    dep: $('f-dep'), arr: $('f-arr'), date: $('f-date'), time: $('f-time'), bag: $('f-bag'), bagWrap: $('f-bag-wrap'),
    alert: $('q-alert'), quote: $('quote'), wait: $('q-wait'), box: $('q-box'), lines: $('q-lines'), total: $('q-total'),
    note: $('q-note'), meta: $('route-meta'), map: $('route-map'), mapIn: $('route-map-in')
  };

  var state = { mode: 'course', from: null, to: null, route: null, routeKey: '', seq: 0 };

  /* ---------- Onglets ---------- */
  function setMode(mode) {
    var from = state.mode;
    if (!done.hidden) resetAll(); // lien « Demander un devis » cliqué depuis l'écran de confirmation
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
    if (!isFleet) calc.setAttribute('aria-labelledby', 'tab-' + mode);
    renderPrice();
    // Retour depuis l'onglet flotte : la carte a pu être masquée (ou jamais mesurée) entre-temps.
    if (from === 'flotte' && !isFleet && state.route && !el.map.classList.contains('stale')) showMap(state.route.geometry);
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

  // Libellé du supplément bagage tiré de la constante unique de la grille.
  $('f-bag-price').textContent = '(+' + P.fmtEur(P.BAGAGE_EUR).replace(',00', '') + ' par bagage)';

  var today = P.todayParis();
  el.date.min = today;
  $('m-date').min = today;

  /* ---------- Adresses ---------- */
  FD.autocomplete(el.dep, $('f-dep-list'), {
    onSelect: function (p) { state.from = p; requestQuote(); },
    onClear: function () { state.from = null; staleQuote(); }
  });
  FD.autocomplete(el.arr, $('f-arr-list'), {
    onSelect: function (p) { state.to = p; requestQuote(); },
    onClear: function () { state.to = null; staleQuote(); }
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
    el.quote.hidden = true;
    el.alert.hidden = true;
    closeMap();
  }

  /* Adresse en cours de modification : le prix disparaît, la carte reste ouverte (atténuée)
     jusqu'au nouveau tracé, qui se redessine dans la même carte. */
  function staleQuote() {
    state.seq++;
    state.route = null;
    state.routeKey = '';
    el.alert.hidden = true;
    el.wait.hidden = true;
    renderPrice();
    if (el.map.classList.contains('open')) {
      el.map.classList.add('stale');
      if (window.FDMap) window.FDMap.pause();
    } else el.quote.hidden = true;
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
        state.route = { km: r.json.distanceKm, min: r.json.durationMin, geometry: r.json.geometry };
        renderPrice({ reveal: true });
        showMap(state.route.geometry);
      } else {
        state.route = null;
        closeMap();
        renderPrice();
        el.alert.textContent = (r.json && r.json.error && r.status === 400 ? r.json.error + '. ' : 'Calcul du prix indisponible pour le moment. ') +
          'Vous pouvez tout de même envoyer votre demande : Fast Driver vous communique le tarif.';
        el.alert.hidden = false;
      }
    });
  }

  /* Compteur du prix : défile de la valeur affichée vers la nouvelle. */
  var shown = 0, countRaf = 0;
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function countTo(target, ms) {
    cancelAnimationFrame(countRaf);
    var from = shown, start = performance.now();
    // Lecteurs d'écran : une seule annonce, le prix final (le compteur visuel n'est pas annoncé).
    $('q-live').textContent = 'Prix estimatif : ' + P.fmtEur(target);
    if (!ms || reducedMotion) { shown = target; el.total.textContent = P.fmtEur(target); return; }
    (function step(now) {
      var t = Math.min(1, (now - start) / ms), k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      shown = Math.round((from + (target - from) * k) * 100) / 100;
      el.total.textContent = P.fmtEur(shown);
      if (t < 1) countRaf = requestAnimationFrame(step);
    })(start);
  }

  /* opts.reveal : nouvel itinéraire → le total défile de 0 à sa valeur (600 ms), comme la pastille de la carte. */
  function renderPrice(opts) {
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
    state.total = price.total;
    if (opts && opts.reveal) {
      shown = 0;
      countTo(price.total, 600);
    } else {
      countTo(price.total, shown ? 400 : 0);
    }
    el.meta.querySelector('span').textContent = P.fmtKm(r.km) + ' km · environ ' + r.min + ' min';
    el.quote.hidden = false;
    el.box.hidden = el.note.hidden = el.meta.hidden = false;
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
      if (my !== state.seq || calc.hidden) return; // jamais d'initialisation dans un onglet masqué
      el.map.classList.remove('stale');
      el.map.classList.add('open');
      FDMap.show(el.mapIn, geometry, {
        km: state.route ? state.route.km : 0,
        min: state.route ? state.route.min : 0,
        onFail: closeMap
      });
    }).catch(closeMap);
  }
  function closeMap() {
    el.map.classList.remove('open', 'stale');
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

  function showBookingDone(data, res) {
    var rows = [['Départ', res.from || data.from], ['Arrivée', res.to || data.to], ['Prise en charge', res.when || data.date + ' ' + data.time]];
    if (data.mode === 'course') rows.push(['Bagages', data.bagages]);
    var priceText = res.price ? res.price.totalText : 'à confirmer';
    showDone(res, recapRows(rows) + '<div class="q-total"><span>Prix estimatif</span><b>' + FD.esc(priceText) + '</b></div>');
  }

  /* Lien WhatsApp : wa.me (fourni par le serveur) sur mobile, WhatsApp Web sur ordinateur. */
  function waUrl(wa) {
    if (!wa || !wa.text) return '';
    var W = window.FDWhatsApp;
    return W && W.isDesktop(navigator) ? W.link(wa.text, true) : wa.url;
  }

  /* Écran « Dernière étape » puis ouverture de WhatsApp avec le message construit par le serveur.
     window.location.href et non window.open : après un appel réseau, iOS bloque les fenêtres surgissantes.
     Le bouton « Ouvrir WhatsApp » (vrai lien, clic de l'utilisateur) relance le même lien si besoin.
     L'écran est gardé en sessionStorage : au retour depuis WhatsApp (bouton Précédent), il est réaffiché. */
  var SAVED = 'fd-derniere-etape', SAVED_MS = 30 * 60 * 1000;
  function showDone(res, recap) {
    var url = waUrl(res.whatsapp);
    renderDone(url, res.ref, recap);
    if (!url) return;
    try { sessionStorage.setItem(SAVED, JSON.stringify({ url: url, ref: res.ref, recap: recap, t: Date.now() })); } catch (e) { /* stockage indisponible */ }
    window.location.href = url;
  }
  function renderDone(url, ref, recap) {
    var wa = $('done-wa');
    done.querySelector('.done-ico').classList.toggle('wa', !!url);
    $('done-box').innerHTML = url ? recap : '';
    $('done-box').hidden = !url || !recap;
    if (url) {
      $('done-title').textContent = 'Dernière étape';
      $('done-text').innerHTML = 'Envoyez le message WhatsApp qui vient de s’ouvrir.<br>Fast Driver vous confirme ensuite votre réservation.' +
        '<span class="done-ref">Réservation ' + FD.esc(ref) + '</span>';
      wa.href = url;
      wa.hidden = false;
    } else {
      $('done-title').textContent = 'Demande envoyée';
      $('done-text').textContent = 'Merci, Fast Driver revient vers vous très vite.';
      wa.hidden = true;
    }
    openDone();
  }
  function restoreDone() {
    var st = null;
    try { st = JSON.parse(sessionStorage.getItem(SAVED) || 'null'); } catch (e) { /* stockage indisponible */ }
    if (!st || !st.url || !(Date.now() - st.t < SAVED_MS)) return;
    if (!/^https:\/\/(wa\.me|web\.whatsapp\.com)\//.test(st.url)) return;
    renderDone(st.url, st.ref, st.recap);
  }
  function forgetDone() { try { sessionStorage.removeItem(SAVED); } catch (e) { /* stockage indisponible */ } }

  /* ---------- Envoi Plusieurs véhicules ---------- */
  mad.addEventListener('submit', function (e) {
    e.preventDefault();
    FD.clearErrors(mad);
    var v = FD.values(mad);
    var extra = {
      date: v.date && v.date < P.todayParis() ? 'Cette date est déjà passée.' : '',
      heure_debut: v.date === P.todayParis() && v.heure_debut && v.heure_debut <= P.nowParisHm() ? 'Cette heure est déjà passée.' : ''
    };
    if (FD.showErrors(mad, FD.check(mad, extra))) return;
    var data = FD.antispam(v, mad);
    busy(mad, true);
    FD.post('/api/mise-a-disposition', data).then(function (r) {
      busy(mad, false);
      if (r.status === 200 && r.json.ok) {
        var rc = r.json.recap;
        return showDone(r.json, rc ? recapRows([['Véhicules', rc.vehicules], ['Date', rc.date], ['Horaires', rc.horaires]]) : '');
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

  function resetAll() {
    forgetDone();
    calc.reset();
    mad.reset();
    el.dep.dispatchEvent(new Event('input'));
    el.arr.dispatchEvent(new Event('input'));
    state.from = state.to = null;
    clearQuote();
    FD.clearErrors(calc);
    FD.clearErrors(mad);
    card.querySelector('.tabs').hidden = false;
    done.hidden = true;
  }
  $('done-new').addEventListener('click', function () { resetAll(); setMode(state.mode); });

  setMode('course');
  restoreDone();
  // Retour depuis WhatsApp avec une page restaurée du cache (bfcache) : l'écran est déjà là ; sinon on le recharge.
  window.addEventListener('pageshow', function (e) { if (e.persisted && done.hidden) restoreDone(); });
})();
