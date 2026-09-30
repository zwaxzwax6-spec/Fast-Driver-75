/* Fast Driver 75 — outils partagés des formulaires (accueil + recrutement).
   Validation inline, anti-spam, envoi JSON, autocomplétion API Adresse. */
(function () {
  'use strict';

  var FD = window.FD = window.FD || {};
  // Délai de remplissage mesuré sur la page (horloge monotone, indépendante de l'heure du téléphone).
  var loadedAt = window.performance && performance.now ? performance.now() : Date.now();
  FD.elapsed = function () { return Math.round((window.performance && performance.now ? performance.now() : Date.now()) - loadedAt); };

  var EMAIL_RE = /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
  var PHONE_RE = /^(?:\+33|0033|0)[1-9]\d{8}$/;

  FD.isEmail = function (v) { return EMAIL_RE.test(v); };
  FD.isPhone = function (v) { return PHONE_RE.test(v.replace(/[\s.\-()]/g, '')); };

  FD.values = function (form) {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (el.name && !el.disabled) out[el.name] = el.value.trim();
    });
    return out;
  };

  /* Règles déclaratives côté client (le serveur revalide tout). */
  FD.check = function (form, extra) {
    var errors = {};
    Array.prototype.forEach.call(form.querySelectorAll('input[name],select[name],textarea[name]'), function (el) {
      if (el.closest('.hp') || el.disabled || el.closest('[hidden]')) return;
      var v = el.value.trim();
      if (el.required && !v) { errors[el.name] = 'Champ obligatoire.'; return; }
      if (!v) return;
      if (el.type === 'email' && !FD.isEmail(v)) errors[el.name] = 'Adresse e-mail invalide.';
      if (el.type === 'tel' && !FD.isPhone(v)) errors[el.name] = 'Numéro de téléphone français invalide.';
      if (el.type === 'number' && (+v < +el.min || +v > +el.max || !/^\d+$/.test(v))) {
        errors[el.name] = 'Entre ' + el.min + ' et ' + el.max + '.';
      }
    });
    if (extra) Object.keys(extra).forEach(function (k) { if (extra[k] && !errors[k]) errors[k] = extra[k]; });
    return errors;
  };

  FD.clearErrors = function (form) {
    form.querySelectorAll('.field.invalid').forEach(function (f) { f.classList.remove('invalid'); });
    form.querySelectorAll('[aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });
    form.querySelectorAll('.f-err').forEach(function (p) { p.textContent = ''; });
    var fe = form.querySelector('.form-err');
    if (fe) fe.textContent = '';
  };

  FD.setError = function (form, name, msg) {
    var f = form.querySelector('.field[data-field="' + name + '"]');
    if (!f) return false;
    f.classList.toggle('invalid', !!msg);
    var p = f.querySelector('.f-err');
    if (p) {
      p.textContent = msg || '';
      if (!p.id) p.id = 'err-' + (form.id || 'f') + '-' + name;
    }
    var input = f.querySelector('input,select,textarea');
    if (input) {
      if (msg) {
        input.setAttribute('aria-invalid', 'true');
        if (p && p.id) input.setAttribute('aria-describedby', p.id);
      } else input.removeAttribute('aria-invalid');
    }
    return true;
  };

  /* Affiche les erreurs ; renvoie true s'il y en a. Focus sur la première. */
  FD.showErrors = function (form, errors, fallback) {
    var names = Object.keys(errors || {});
    var unplaced = [];
    names.forEach(function (n) { if (!FD.setError(form, n, errors[n])) unplaced.push(errors[n]); });
    var fe = form.querySelector('.form-err');
    if (fe) fe.textContent = unplaced.length ? unplaced[0] : (names.length ? (fallback || 'Certains champs sont à corriger.') : '');
    var first = form.querySelector('.field.invalid input, .field.invalid select, .field.invalid textarea');
    if (first) first.focus({ preventScroll: false });
    return names.length > 0;
  };

  FD.post = function (url, data) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, json: j }; });
    }, function () {
      return { status: 0, json: { ok: false, error: 'Connexion impossible. Vérifiez votre réseau et réessayez.' } };
    });
  };

  FD.antispam = function (data, form) {
    var hp = form.querySelector('input[name="website"]');
    data.website = hp ? hp.value : '';
    data.elapsed = FD.elapsed();
    return data;
  };

  FD.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* ---------- Bouton WhatsApp flottant : ne recouvre jamais un formulaire ----------
     Masqué (fondu 200 ms) quand un champ a le focus, quand un formulaire est à l'écran sur mobile,
     et, sur grand écran, dès qu'il chevaucherait un formulaire. Réapparaît ensuite. */
  (function fabGuard() {
    var fab = document.querySelector('.fab');
    var zones = [].slice.call(document.querySelectorAll('[data-fab-avoid]'));
    if (!fab || !zones.length) return;
    var mobile = window.matchMedia('(max-width: 880px)');
    var onScreen = [], focused = false, ticking = false;
    function shown(z) { return !z.hidden && !z.closest('[hidden]'); }
    function overlaps(z) {
      var f = fab.getBoundingClientRect(), r = z.getBoundingClientRect();
      return r.left < f.right + 12 && r.right > f.left - 12 && r.top < f.bottom + 12 && r.bottom > f.top - 12;
    }
    function update() {
      ticking = false;
      var hide = focused ||
        (mobile.matches ? onScreen.some(shown) : zones.some(function (z) { return shown(z) && overlaps(z); }));
      fab.classList.toggle('fab-off', hide);
    }
    function schedule() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var i = onScreen.indexOf(e.target);
        if (e.isIntersecting && i === -1) onScreen.push(e.target);
        if (!e.isIntersecting && i !== -1) onScreen.splice(i, 1);
      });
      schedule();
    });
    zones.forEach(function (z) { io.observe(z); });
    var FIELD = 'input:not([type=hidden]),select,textarea';
    document.addEventListener('focusin', function (e) { if (e.target.matches && e.target.matches(FIELD)) { focused = true; schedule(); } });
    document.addEventListener('focusout', function () {
      // Passage d'un champ au suivant : on attend le nouveau focus avant de décider.
      setTimeout(function () { var a = document.activeElement; focused = !!(a && a.matches && a.matches(FIELD)); schedule(); }, 0);
    });
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    // Changement d'onglet / écran de confirmation : les zones changent de visibilité sans défiler.
    new MutationObserver(schedule).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
    schedule();
  })();

  /* ---------- Autocomplétion API Adresse (gratuite, sans clé) ---------- */
  var API = 'https://api-adresse.data.gouv.fr/search/';
  function isIdf(cp) { return window.FDPricing.isIdfPostcode(cp); } // règle unique, partagée avec le serveur
  FD.OUTSIDE_MSG = 'Adresse hors Île-de-France';

  /* opts.onSelect(place) — place = {label, lon, lat, postcode} ; opts.onClear() quand le texte change. */
  FD.autocomplete = function (input, list, opts) {
    var timer = null, ctrl = null, items = [], active = -1, seq = 0;
    var field = input.closest('.field');
    var err = field.querySelector('.f-err');

    function setMsg(msg) {
      field.classList.toggle('invalid', !!msg);
      err.textContent = msg || '';
      if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    }
    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }
    /* Élément de liste unifié : { label, main, sub, postcode, lon, lat, preset } */
    function fromApi(f) {
      var p = f.properties;
      return { label: p.label, main: p.type === 'municipality' ? p.city : p.name, sub: p.postcode + ' ' + p.city,
        postcode: p.postcode, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
    }
    function fromPreset(p) {
      return { label: p.label, main: p.name, sub: 'Dépose-minute · ' + p.postcode + ' ' + p.city,
        postcode: p.postcode, lon: p.lon, lat: p.lat, preset: p.id };
    }
    function render(list_) {
      items = list_;
      list.innerHTML = '';
      if (!list_.length) { close(); return; }
      list_.forEach(function (it, i) {
        var li = document.createElement('li');
        li.className = 'ac-item' + (it.preset ? ' ac-preset' : '');
        li.id = list.id + '-' + i;
        li.setAttribute('role', 'option');
        li.innerHTML = FD.esc(it.main) + '<small>' + FD.esc(it.sub) + '</small>';
        li.addEventListener('mousedown', function (e) { e.preventDefault(); });
        li.addEventListener('click', function () { choose(i); });
        list.appendChild(li);
      });
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      // Mobile (clavier ouvert) : si la liste dépasse l'écran visible, on remonte le champ sous la navbar.
      var vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      var lr = list.getBoundingClientRect();
      if (lr.bottom > vh) {
        var top = input.getBoundingClientRect().top - 96;
        if (top > 0) window.scrollBy({ top: Math.min(top, lr.bottom - vh + 12), behavior: 'smooth' });
      }
    }
    function highlight(i) {
      var lis = list.querySelectorAll('.ac-item');
      lis.forEach(function (li, k) { li.classList.toggle('act', k === i); li.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
      active = i;
      if (lis[i]) { input.setAttribute('aria-activedescendant', lis[i].id); lis[i].scrollIntoView({ block: 'nearest' }); }
    }
    function choose(i) {
      var it = items[i];
      if (!it) return;
      // Annule toute recherche en attente : elle rouvrirait la liste sur l'adresse choisie.
      clearTimeout(timer);
      seq++;
      if (ctrl) ctrl.abort();
      input.value = it.label;
      input.dataset.chosen = it.label;
      close();
      setMsg('');
      opts.onSelect({ label: it.label, postcode: it.postcode, lon: it.lon, lat: it.lat, preset: it.preset || null });
    }
    function search(q) {
      if (ctrl) ctrl.abort();
      ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var my = ++seq;
      // Aéroports, gares, La Défense : destinations pré-réglées (dépose-minute) proposées EN PREMIER.
      var presets = window.FDPlaces ? window.FDPlaces.match(q, 8).map(fromPreset) : [];
      if (presets.length) { render(presets); setMsg(''); }
      var url = API + '?autocomplete=1&limit=10&lat=48.8566&lon=2.3522&q=' + encodeURIComponent(q);
      fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) { return r.json(); }).then(function (j) {
        if (my !== seq) return;
        var all = (j && j.features) || [];
        var ok = all.filter(function (f) { return isIdf(f.properties.postcode); }).slice(0, 5).map(fromApi);
        render(presets.concat(ok));
        // Meilleure correspondance hors zone : on le dit (sauf si une destination pré-réglée correspond),
        // tout en proposant les adresses IDF proches.
        // Hors zone aussi quand la saisie est exactement une commune hors Île-de-France
        // (« Beauvais » : des lieux-dits franciliens du même nom passent devant la ville).
        var n = window.FDPlaces ? window.FDPlaces.norm : function (x) { return String(x).toLowerCase(); };
        var city = all.some(function (f) {
          return f.properties.type === 'municipality' && !isIdf(f.properties.postcode) && n(f.properties.name) === n(q);
        });
        // Une commune hors zone saisie telle quelle est toujours signalée (« Lyon » : message + Gare de Lyon proposée).
        setMsg(city || (!presets.length && all.length && !isIdf(all[0].properties.postcode)) ? FD.OUTSIDE_MSG : '');
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        if (!presets.length) close();
      });
    }

    input.addEventListener('input', function () {
      var q = input.value.trim();
      if (input.dataset.chosen && input.dataset.chosen !== input.value) {
        delete input.dataset.chosen;
        opts.onClear();
      }
      setMsg('');
      clearTimeout(timer);
      if (q.length < 3) { close(); return; }
      timer = setTimeout(function () { search(q); }, 250);
    });
    input.addEventListener('keydown', function (e) {
      if (list.hidden) return;
      var n = items.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % n); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight((active - 1 + n) % n); }
      else if (e.key === 'Enter') { if (active >= 0) { e.preventDefault(); choose(active); } }
      else if (e.key === 'Escape') { close(); }
    });
    input.addEventListener('blur', function () { setTimeout(close, 150); });

    return {
      reset: function () { input.value = ''; delete input.dataset.chosen; close(); setMsg(''); }
    };
  };
})();
