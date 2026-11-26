/* Kleine Test-Harness: fängt Fehler ab und rendert Ergebnisse als Text. */
(function (global) {
  'use strict';
  var out = [];
  var PAGESIZE = 40;

  function render() {
    var el = document.getElementById('out');
    if (!el) return;
    var start = parseInt((location.hash || '').split('-')[0], 10) || 0;
    var shown = out.slice(start, start + PAGESIZE);
    el.textContent = '=== Zeilen ' + (start + 1) + '-' + (start + shown.length) +
      ' von ' + out.length + ' ===\n' + shown.join('\n');
  }

  window.onerror = function (msg, src, line, col) {
    out.push('!!! FEHLER: ' + msg + ' @' + (src || '').split('/').pop() + ':' + line + ':' + col);
    render();
    return false;
  };

  global.T = {
    log: function (label, ok) {
      out.push((ok === true ? 'OK   ' : ok === false ? 'FAIL ' : '  ·  ') + label);
    },
    info: function (label) { out.push('  ·  ' + label); },
    done: render,
    render: render
  };
})(window);
