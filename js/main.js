/*
 * main.js — App starten und die Bausteine verbinden.
 */
(function (global) {
  'use strict';
  var ZW = (global.ZW = global.ZW || {});

  function start() {
    var app = new ZW.App();
    try {
      app.init();
      app.setMode('lbl');
      ZW.app = app;
    } catch (e) {
      report(e);
    }
  }

  // Statt einer leeren Seite lieber zeigen, was kaputt ist.
  function report(e) {
    var banner = document.getElementById('banner');
    if (!banner) return;
    banner.textContent = 'Interner Fehler: ' + (e && e.message ? e.message : e);
    banner.classList.remove('versteckt');
  }
  window.addEventListener('error', function (ev) { report(ev.error || ev.message); });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : this);
