// Light / dark / system switch for the static mockups. The choice is kept per browser only.
(function () {
  var KEY = 'property-health-theme';
  function apply(theme) {
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    var buttons = document.querySelectorAll('[data-theme-set]');
    for (var i = 0; i < buttons.length; i += 1) {
      var value = buttons[i].getAttribute('data-theme-set');
      buttons[i].setAttribute('aria-pressed', String(value === (theme || 'auto')));
    }
  }
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (error) { saved = null; }
  apply(saved);
  document.addEventListener('DOMContentLoaded', function () { apply(saved); });
  document.addEventListener('click', function (event) {
    var button = event.target.closest ? event.target.closest('[data-theme-set]') : null;
    if (!button) return;
    var value = button.getAttribute('data-theme-set');
    saved = value === 'auto' ? null : value;
    apply(saved);
    try {
      if (saved) localStorage.setItem(KEY, saved); else localStorage.removeItem(KEY);
    } catch (error) { /* private mode: the switch still works for this page */ }
  });
})();
