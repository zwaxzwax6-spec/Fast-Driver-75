/* Fast Driver 75 — outils partagés des formulaires (accueil + recrutement).
   Validation inline, anti-spam, envoi JSON, autocomplétion API Adresse. */
(function () {
  'use strict';

  var FD = window.FD = window.FD || {};
  FD.t0 = Date.now();

  var EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;
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
    if (p) p.textContent = msg || '';
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
    data.t0 = FD.t0;
    return data;
  };

  FD.todayParis = function () {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  };

  FD.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* ---------- Autocomplétion API Adresse (gratuite, sans clé) ---------- */
  var API = 'https://api-adresse.data.gouv.fr/search/';
  var IDF = ['75', '77', '78', '91', '92', '93', '94', '95'];
  function isIdf(cp) { return typeof cp === 'string' && /^\d{5}$/.test(cp) && IDF.indexOf(cp.slice(0, 2)) !== -1; }
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
    function render(features, outside) {
      items = features;
      list.innerHTML = '';
      if (!features.length) { close(); return; }
      features.forEach(function (f, i) {
        var li = document.createElement('li');
        li.className = 'ac-item';
        li.id = list.id + '-' + i;
        li.setAttribute('role', 'option');
        var p = f.properties;
        var main = p.type === 'municipality' ? p.city : p.name;
        li.innerHTML = FD.esc(main) + '<small>' + FD.esc(p.postcode + ' ' + p.city) + '</small>';
        li.addEventListener('mousedown', function (e) { e.preventDefault(); });
        li.addEventListener('click', function () { choose(i); });
        list.appendChild(li);
      });
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
    function highlight(i) {
      var lis = list.querySelectorAll('.ac-item');
      lis.forEach(function (li, k) { li.classList.toggle('act', k === i); li.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
      active = i;
      if (lis[i]) { input.setAttribute('aria-activedescendant', lis[i].id); lis[i].scrollIntoView({ block: 'nearest' }); }
    }
    function choose(i) {
      var f = items[i];
      if (!f) return;
      var p = f.properties;
      input.value = p.label;
      input.dataset.chosen = p.label;
      close();
      setMsg('');
      opts.onSelect({ label: p.label, postcode: p.postcode, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
    }
    function search(q) {
      if (ctrl) ctrl.abort();
      ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var my = ++seq;
      var url = API + '?autocomplete=1&limit=10&lat=48.8566&lon=2.3522&q=' + encodeURIComponent(q);
      fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) { return r.json(); }).then(function (j) {
        if (my !== seq) return;
        var all = (j && j.features) || [];
        var ok = all.filter(function (f) { return isIdf(f.properties.postcode); }).slice(0, 5);
        render(ok);
        // Meilleure correspondance hors zone : on le dit, tout en proposant les adresses IDF proches.
        setMsg(all.length && !isIdf(all[0].properties.postcode) ? FD.OUTSIDE_MSG : '');
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        close();
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
