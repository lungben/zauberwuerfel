/*
 * color-scheme.js — Farbzuordnung der sechs Flächen.
 *
 * Die Würfel-Logik arbeitet ausschließlich mit Flächen-Indizes
 * (0=U 1=R 2=F 3=D 4=L 5=B). Farben sind reine Anzeige und frei wählbar;
 * die Solvertexte verwenden die zugehörigen Farbnamen.
 */
(function (global) {
  'use strict';
  var ZW = (global.ZW = global.ZW || {});
  var C = ZW.Cube;

  var STORE_KEY = 'zauberwuerfel.farbschema';

  // Voreinstellung: würfeltypisches Schema, weiß unten / gelb oben
  var PRESETS = {
    'Standard (weiß/unten)': ['#ffd500', '#ff7a00', '#00a651', '#ffffff', '#d22630', '#0051ba'],
    'Standard (weiß/oben)': ['#ffffff', '#d22630', '#00a651', '#ffd500', '#ff7a00', '#0051ba'],
    'Japanisch': ['#ffd500', '#0051ba', '#ffffff', '#d22630', '#00a651', '#ff7a00'],
    'Monochrom': ['#111111', '#333333', '#555555', '#888888', '#bbbbbb', '#ffffff'],
    'Pastell': ['#ffe066', '#ffad9e', '#9ff5c0', '#f4f4f4', '#ff8fa3', '#9ec9ff']
  };

  // Farbnamen für die Erklärtexte (nach Farbton sortiert).
  // Unbunte Farben (weiß, grau, schwarz) werden vorher über Helligkeit und
  // Sättigung erkannt, deshalb beginnt die Tabelle direkt mit Rot.
  var NAME_TABLE = [
    [345, 360, 'rot'], [0, 15, 'rot'], [15, 40, 'orange'], [40, 68, 'gelb'],
    [68, 165, 'grün'], [165, 195, 'türkis'], [195, 250, 'blau'],
    [250, 290, 'violett'], [290, 345, 'pink']
  ];

  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: h, s: s, l: l };
  }
  function colorName(hex) {
    var c = hexToRgb(hex);
    var hsl = rgbToHsl(c.r, c.g, c.b);
    if (hsl.l > 0.86 && hsl.s < 0.25) return 'weiß';
    if (hsl.l < 0.14) return 'schwarz';
    if (hsl.s < 0.16) return hsl.l < 0.45 ? 'grau' : 'hellgrau';
    if (hsl.l > 0.9) return 'weiß';
    for (var i = 0; i < NAME_TABLE.length; i++) {
      var lo = NAME_TABLE[i][0], hi = NAME_TABLE[i][1], h = hsl.h;
      if (lo <= hi ? (h >= lo && h < hi) : (h >= lo || h < hi)) return NAME_TABLE[i][2];
    }
    return 'bunt';
  }

  var current = PRESETS['Standard (weiß/unten)'].slice();

  function normalize(hex) {
    return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : '#808080';
  }

  function set(hexList) {
    current = [];
    for (var i = 0; i < 6; i++) current.push(normalize(hexList[i] || '#808080'));
    save();
    return current;
  }
  function get() { return current.slice(); }
  function names() {
    var out = [];
    for (var i = 0; i < 6; i++) out.push(colorName(current[i]));
    return out;
  }
  function save() {
    try { global.localStorage.setItem(STORE_KEY, JSON.stringify(current)); } catch (e) { /* egal */ }
  }
  function load() {
    try {
      var raw = global.localStorage.getItem(STORE_KEY);
      if (raw) {
        var arr = JSON.parse(raw);
        if (arr && arr.length === 6) current = arr.map(normalize);
      }
    } catch (e) { /* egal */ }
    return current.slice();
  }

  // Kontrastreiche Schrift/Balkenfarbe für UI-Badges
  function textColorFor(hex) {
    var c = hexToRgb(hex);
    var lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
    return lum > 0.6 ? '#101010' : '#ffffff';
  }

  ZW.Scheme = {
    PRESETS: PRESETS,
    get: get,
    set: set,
    names: names,
    load: load,
    save: save,
    colorName: colorName,
    textColorFor: textColorFor,
    faces: C.FACES
  };
})(typeof window !== 'undefined' ? window : this);
