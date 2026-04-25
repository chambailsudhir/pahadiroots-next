/* ── 5 Pahadi Roots — Global Theme System ───────────────────────── */
/* Loaded in <head> — applies theme before paint to avoid flash.     */
/* Works on ALL pages. Syncs via localStorage so switching on any    */
/* page persists site-wide.                                          */
(function() {
  var DEFAULT_THEME = 'pahadi';
  var THEMES = ['pahadi','dukan','saffron','midnight','valley'];

  function applyTheme(theme) {
    if (!theme || THEMES.indexOf(theme) === -1) theme = DEFAULT_THEME;
    /* Apply to <html> immediately — safe even before <body> exists */
    document.documentElement.setAttribute('data-theme', theme);
    if (document.body) document.body.setAttribute('data-theme', theme);
    try { localStorage.setItem('pr_theme', theme); } catch(e) {}
    /* Sync .theme-opt active states */
    document.querySelectorAll('.theme-opt').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });
  }

  function openThemeSwitcher() {
    var p = document.getElementById('themeSwitcherPanel');
    if (p) p.classList.toggle('open');
  }
  function closeThemeSwitcher() {
    var p = document.getElementById('themeSwitcherPanel');
    if (p) p.classList.remove('open');
  }

  /* Close panel when clicking outside */
  document.addEventListener('click', function(e) {
    var wrap = document.querySelector('.theme-switcher-wrap');
    if (wrap && !wrap.contains(e.target)) closeThemeSwitcher();
  });

  /* ── READ SAVED THEME & APPLY IMMEDIATELY ────────────────────── */
  var saved;
  try { saved = localStorage.getItem('pr_theme'); } catch(e) {}
  var activeTheme = saved || DEFAULT_THEME;

  /* Apply to <html> right now (prevents flash of wrong theme) */
  document.documentElement.setAttribute('data-theme', activeTheme);

  /* Apply to <body> + sync buttons once DOM is ready */
  function onBodyReady() {
    if (document.body) document.body.setAttribute('data-theme', activeTheme);
    document.querySelectorAll('.theme-opt').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.theme === activeTheme);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onBodyReady);
  } else {
    onBodyReady();
  }

  /* Expose globally for onclick handlers and main.js */
  window.applyTheme        = applyTheme;
  window.openThemeSwitcher  = openThemeSwitcher;
  window.closeThemeSwitcher = closeThemeSwitcher;
})();
