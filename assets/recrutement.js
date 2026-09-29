/* Fast Driver 75 — formulaire de candidature chauffeur (/recrutement). */
(function () {
  'use strict';
  var FD = window.FD;
  var form = document.getElementById('rec-form'), done = document.getElementById('rec-done');
  if (!form || !FD) return;

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    FD.clearErrors(form);
    if (FD.showErrors(form, FD.check(form))) return;
    var data = FD.antispam(FD.values(form), form);
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    FD.post('/api/recrutement', data).then(function (r) {
      btn.disabled = false;
      if (r.status === 200 && r.json.ok) {
        document.getElementById('rec-done-text').textContent = 'Merci ' + data.prenom + '. Fast Driver revient vers vous rapidement.';
        form.hidden = true;
        done.hidden = false;
        done.focus({ preventScroll: true });
        done.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (r.json && r.json.errors) return FD.showErrors(form, r.json.errors, r.json.error);
      form.querySelector('.form-err').textContent = (r.json && r.json.error) || 'Envoi impossible pour le moment. Réessayez dans un instant.';
    });
  });
})();
