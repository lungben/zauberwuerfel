/*
 * solver-common.js — gemeinsame Bausteine für die Löser.
 *
 * Kernidee: Ein Stein (Ecke oder Kante) wird durch Position und globale Drehung
 * beschrieben; 24 solche Koordinaten sind je Stein erreichbar. Züge wirken auf
 * diese Koordinate unabhängig von allen anderen Steinen. Deshalb kann man
 *   - exakte Entfernungen einzelner Steine berechnen (Breitensuche),
 *   - Zugfolgen sammeln, die bestimmte Steine nachweislich in Ruhe lassen, und
 *   - aus solchen Folgen die kürzeste Kombination für einen Zielstein wählen.
 */
(function (global) {
  'use strict';
  var ZW = (global.ZW = global.ZW || {});
  var C = ZW.Cube;

  var CORNER = 'corner', EDGE = 'edge';

  function cIdx(pos, rot) { return pos * 24 + rot; }
  function cPos(idx) { return Math.floor(idx / 24); }
  function cRot(idx) { return idx % 24; }

  /* Übergangstabellen: Zug -> neue Stein-Koordinate.
     Nur Steine der gezogenen Ebene wandern und drehen sich; alle anderen
     bleiben unverändert, auch in ihrer Drehung. */
  var CORNER_STEP = [], EDGE_STEP = [];
  for (var m = 0; m < 18; m++) {
    var cs = new Int16Array(8 * 24), es = new Int16Array(12 * 24);
    var rm = C.MOVE_ROT[m];
    for (var p = 0; p < 8; p++) {
      var inLayer = C.CORNER_AFFECTED[m].indexOf(p) >= 0;
      for (var r = 0; r < 24; r++) {
        cs[cIdx(p, r)] = inLayer ? cIdx(C.CORNER_MOVE[m][p], C.ROT_MUL[rm][r]) : cIdx(p, r);
      }
    }
    for (var q = 0; q < 12; q++) {
      var eIn = C.EDGE_AFFECTED[m].indexOf(q) >= 0;
      for (var r2 = 0; r2 < 24; r2++) {
        es[cIdx(q, r2)] = eIn ? cIdx(C.EDGE_MOVE[m][q], C.ROT_MUL[rm][r2]) : cIdx(q, r2);
      }
    }
    CORNER_STEP.push(cs);
    EDGE_STEP.push(es);
  }
  function stepTable(kind) { return kind === CORNER ? CORNER_STEP : EDGE_STEP; }

  /* --------------------------------------------------------- Steine finden */

  function findCorner(st, cubie) {
    for (var p = 0; p < 8; p++) if (st.cp[p] === cubie) return { pos: p, rot: st.cr[p] };
    return null;
  }
  function findEdge(st, cubie) {
    for (var p = 0; p < 12; p++) if (st.ep[p] === cubie) return { pos: p, rot: st.er[p] };
    return null;
  }
  function pieceCoord(st, kind, id) {
    var at = kind === CORNER ? findCorner(st, id) : findEdge(st, id);
    return at ? cIdx(at.pos, at.rot) : -1;
  }
  function pieceAtHome(st, kind, id) { return pieceCoord(st, kind, id) === cIdx(id, 0); }
  function isOrientedCorner(st, id) {
    var at = findCorner(st, id);
    return !!(at && C.TWIST_AT[at.pos][id][at.rot] === 0);
  }
  function isOrientedEdge(st, id) {
    var at = findEdge(st, id);
    return !!(at && C.FLIP_AT[at.pos][id][at.rot] === 0);
  }
  function pieceSatisfied(st, kind, id, mode) {
    return mode === 'orient'
      ? (kind === CORNER ? isOrientedCorner(st, id) : isOrientedEdge(st, id))
      : pieceAtHome(st, kind, id);
  }

  /* ------------------------------------------------------- Distanztabellen */

  function bfsMultiSource(steps, size, goals) {
    var d = new Int8Array(size);
    for (var i = 0; i < size; i++) d[i] = -1;
    var queue = [];
    for (var g = 0; g < goals.length; g++) { d[goals[g]] = 0; queue.push(goals[g]); }
    for (var head = 0; head < queue.length; head++) {
      var cur = queue[head], nd = d[cur] + 1;
      for (var m2 = 0; m2 < 18; m2++) {
        var nx = steps[m2][cur];
        if (d[nx] < 0) { d[nx] = nd; queue.push(nx); }
      }
    }
    return d;
  }
  var HOME_DIST = Object.create(null), ORIENT_DIST = Object.create(null), COORDS = Object.create(null);
  function homeDist(kind, id) {
    var k = kind + id;
    if (!HOME_DIST[k]) HOME_DIST[k] = bfsMultiSource(stepTable(kind), (kind === CORNER ? 8 : 12) * 24, [cIdx(id, 0)]);
    return HOME_DIST[k];
  }
  function orientDist(kind, id) {
    var k = kind + id;
    if (!ORIENT_DIST[k]) {
      var positions = kind === CORNER ? 8 : 12, goals = [];
      for (var p = 0; p < positions; p++) {
        for (var r = 0; r < 24; r++) {
          var ok = kind === CORNER ? C.TWIST_AT[p][id][r] === 0 : C.FLIP_AT[p][id][r] === 0;
          if (ok) goals.push(cIdx(p, r));
        }
      }
      ORIENT_DIST[k] = bfsMultiSource(stepTable(kind), positions * 24, goals);
    }
    return ORIENT_DIST[k];
  }
  function dist(kind, id, mode) { return mode === 'orient' ? orientDist(kind, id) : homeDist(kind, id); }

  // die 24 Lagen, die ein Stein überhaupt einnehmen kann
  function coordSet(kind, id) {
    var k = kind + id;
    if (!COORDS[k]) {
      var d = homeDist(kind, id), out = [];
      for (var c = 0; c < d.length; c++) if (d[c] >= 0) out.push(c);
      COORDS[k] = out;
    }
    return COORDS[k];
  }

  /* ----------------------------------------------------------- Zugfolgen */

  function applySeq(st, seq) {
    for (var i = 0; i < seq.length; i++) {
      C.applyMoveIdx(st, typeof seq[i] === 'number' ? seq[i] : C.moveIndexOf(seq[i]));
    }
    return st;
  }
  function moveName(m) { return typeof m === 'number' ? C.MOVE_NAMES[m] : m; }
  function seqKey(seq) {
    var names = [];
    for (var i = 0; i < seq.length; i++) names.push(moveName(seq[i]));
    return names.join(' ');
  }
  function concatSeq(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) for (var j = 0; j < list[i].length; j++) out.push(list[i][j]);
    return out;
  }
  function applyMovesToCoord(kind, seq, coord) {
    var tab = stepTable(kind);
    for (var i = 0; i < seq.length; i++) coord = tab[seq[i]][coord];
    return coord;
  }
  // Zug nie direkt auf derselben Fläche; R L R -> R R
  function moveAllowed(mv, last, secondLast) {
    if (last < 0) return true;
    var f = C.MOVE_FACE[mv];
    if (C.MOVE_FACE[last] === f) return false;
    if (secondLast >= 0 && C.OPPOSITE_FACE[C.MOVE_FACE[last]] === f && C.MOVE_FACE[secondLast] === f) return false;
    return true;
  }

  function goalTest(kind, id, mode) {
    if (mode === 'orient') {
      var tab = kind === CORNER ? C.TWIST_AT : C.FLIP_AT;
      return function (coord) { return tab[cPos(coord)][id][cRot(coord)] === 0; };
    }
    var home = cIdx(id, 0);
    return function (coord) { return coord === home; };
  }

  /* ------------------------------------------------ Macro-Bibliothek */

  var MACRO_CACHE = Object.create(null);

  /**
   * Zugfolgen über einem Alphabet, die die keep-Steine in Ruhe lassen.
   * Doppelt wirkende Folgen werden auf die kürzeste reduziert (gleiche Wirkung
   * auf alle Lagen des Zielsteins).
   *
   * cfg = {
   *   alphabet: [Zug-Indizes],
   *   len:      maximale Länge einer Folge,
   *   keep:     [{kind, id, mode}]  geschützte Steine
   *   target:   {kind, id, mode}    Zielstein
   *   pull:     wenn true, muss jede Folge den Zielstein seinem Ziel nähern
   *   maxNodes: Höchstzahl geprüfter Knoten
   * }
   * @returns [{moves, orientSafe}]
   */
  function macroLib(cfg) {
    var keep = cfg.keep || [];
    var key = cfg.alphabet.join(',') + '|' + cfg.len + '|' + (cfg.pull ? 'p' : 'f') + '|' +
      cfg.target.kind + cfg.target.id + (cfg.target.mode || 'home') + '|' +
      keep.map(function (k) { return k.kind + k.id + (k.mode || 'home'); }).join(',');
    if (MACRO_CACHE[key]) return MACRO_CACHE[key];

    var items = [cfg.target].concat(keep);
    var n = items.length, i;
    var tables = [], dists = [], tests = [];
    for (i = 0; i < n; i++) {
      var mode = items[i].mode || 'home';
      tables.push(stepTable(items[i].kind));
      dists.push(dist(items[i].kind, items[i].id, mode));
      tests.push(goalTest(items[i].kind, items[i].id, mode));
    }
    var homeCoord = [];
    for (i = 0; i < n; i++) homeCoord.push(cIdx(items[i].id, 0));
    var cur = homeCoord.slice();

    // Wirkung auf die Lagen des Zielsteins, während der Suche mitgeführt
    var set = coordSet(cfg.target.kind, cfg.target.id);
    var m2 = set.length;
    var img = set.slice();
    function imgKey() {
      var s = '';
      for (var j = 0; j < m2; j++) s += String.fromCharCode(img[j]);
      return s;
    }

    var seen = Object.create(null), found = [], path = [];
    var maxNodes = cfg.maxNodes || 1200000, nodes = 0;
    var maxFound = cfg.maxFound || 40000;

    (function walk(remaining) {
      if (++nodes > maxNodes || found.length >= maxFound) return;
      if (path.length) {
        var ok = true;
        for (var k = 1; k < n; k++) if (!tests[k](cur[k])) { ok = false; break; }
        if (ok) {
          var ek = imgKey();
          if (!(ek in seen)) { seen[ek] = true; found.push(path.slice()); }
        }
      }
      if (remaining <= 0) return;
      for (var k2 = 1; k2 < n; k2++) if (dists[k2][cur[k2]] > remaining) return;
      if (cfg.pull && dists[0][cur[0]] > remaining) return;

      var saveCur = cur.slice(), saveImg = img.slice();
      for (var a = 0; a < cfg.alphabet.length; a++) {
        var mv = cfg.alphabet[a];
        if (!moveAllowed(mv, path.length ? path[path.length - 1] : -1,
                         path.length > 1 ? path[path.length - 2] : -1)) continue;
        for (var t = 0; t < n; t++) cur[t] = tables[t][mv][cur[t]];
        for (var j = 0; j < m2; j++) img[j] = tables[0][mv][img[j]];
        path.push(mv);
        walk(remaining - 1);
        path.pop();
        for (var t2 = 0; t2 < n; t2++) cur[t2] = saveCur[t2];
        for (var j2 = 0; j2 < m2; j2++) img[j2] = saveImg[j2];
      }
    })(cfg.len);

    found.sort(function (a, b) { return a.length - b.length; });

    // Folgen, die Steine im Orientierungsmodus wirklich schonen
    var orientKeep = keep.filter(function (k) { return k.mode === 'orient'; });
    var out = [];
    for (var f = 0; f < found.length; f++) {
      var safe = true;
      for (var oi = 0; oi < orientKeep.length && safe; oi++) {
        var ok2 = orientKeep[oi], set2 = coordSet(ok2.kind, ok2.id), test2 = goalTest(ok2.kind, ok2.id, 'orient');
        for (var s2 = 0; s2 < set2.length && safe; s2++) {
          if (test2(set2[s2]) && !test2(applyMovesToCoord(ok2.kind, found[f], set2[s2]))) safe = false;
        }
      }
      out.push({ moves: found[f], orientSafe: safe });
    }
    MACRO_CACHE[key] = out;
    return out;
  }

  /* ------------------------------------------------- Einsatz von Macros */

  /**
   * Zugfolge, die einen einzelnen Stein fertigstellt, ohne die keep-Steine zu
   * stören. Gewählt wird die kürzeste Folge aus zusammengesetzten Macros.
   *
   * cfg = {
   *   piece: {kind, id, mode}, keep: [{kind, id, mode}],
   *   alphabet: [Zug-Indizes], macroLen: number
   * }
   * @returns Zugfolge (Zug-Indizes) oder null
   */
  function piecePlan(state, cfg) {
    var piece = cfg.piece, keep = cfg.keep || [];
    var gTest = goalTest(piece.kind, piece.id, piece.mode);
    var from = pieceCoord(state, piece.kind, piece.id);
    if (from < 0) return null;
    if (gTest(from)) return [];

    var set = coordSet(piece.kind, piece.id), nSet = set.length;
    var pos = Object.create(null);
    for (var i = 0; i < nSet; i++) pos[set[i]] = i;
    if (!(from in pos)) return null;

    var needOrient = hasKeepOrient(keep);
    var maxLen = (cfg.macroLen || 6) + 2;
    for (var len = 4; len <= maxLen; len++) {
      for (var pullTry = 0; pullTry < 2; pullTry++) {
        var lib = macroLib({
          alphabet: cfg.alphabet, len: len, keep: keep, target: piece,
          pull: pullTry === 0, maxNodes: 400000, maxFound: 6000
        });
        if (!lib.length) continue;
        var usable = [];
        for (var li = 0; li < lib.length && usable.length < 4000; li++) {
          var entry = lib[li];
          if (entry.moves.length === 0) continue;
          if (needOrient && !entry.orientSafe) continue;
          var act = new Int32Array(nSet);
          for (var s = 0; s < nSet; s++) act[s] = pos[applyMovesToCoord(piece.kind, entry.moves, set[s])];
          usable.push({ moves: entry.moves, act: act });
        }
        if (!usable.length) continue;
        var seq = shortestCombo(from, set, pos, gTest, usable);
        if (seq !== null) return seq;
      }
    }
    return null;
  }
  function hasKeepOrient(keep) {
    for (var i = 0; i < keep.length; i++) if (keep[i].mode === 'orient') return true;
    return false;
  }

  // kürzeste Verkettung von Macros, die den Zielstein ins Ziel bringt
  function shortestCombo(from, set, pos, gTest, usable) {
    var nSet = set.length;
    var best = new Float64Array(nSet), prevNode = new Int32Array(nSet),
          prevMacro = new Int32Array(nSet), done = new Uint8Array(nSet);
    for (var i = 0; i < nSet; i++) { best[i] = Infinity; prevNode[i] = -1; prevMacro[i] = -1; }
    var startIdx = pos[from];
    best[startIdx] = 0;

    for (var it = 0; it < nSet; it++) {
      var pick = -1;
      for (var j = 0; j < nSet; j++) if (!done[j] && (pick < 0 || best[j] < best[pick])) pick = j;
      if (pick < 0 || best[pick] === Infinity) break;
      done[pick] = 1;
      for (var u = 0; u < usable.length; u++) {
        var to = usable[u].act[pick];
        var nd = best[pick] + usable[u].moves.length;
        if (nd < best[to]) { best[to] = nd; prevNode[to] = pick; prevMacro[to] = u; }
      }
    }
    // bestes Ziel wählen
    var goalIdx = -1;
    for (var g = 0; g < nSet; g++) {
      if (!gTest(set[g]) || best[g] === Infinity) continue;
      if (goalIdx < 0 || best[g] < best[goalIdx]) goalIdx = g;
    }
    if (goalIdx < 0) return null;
    var chain = [];
    for (var at = goalIdx; at !== startIdx; at = prevNode[at]) {
      if (prevNode[at] < 0) return null;
      chain.push(usable[prevMacro[at]].moves);
      if (chain.length > 8) return null;
    }
    chain.reverse();
    return concatSeq(chain);
  }

  ZW.SolverCommon = {
    CORNER: CORNER, EDGE: EDGE,
    CORNER_STEP: CORNER_STEP, EDGE_STEP: EDGE_STEP,
    cIdx: cIdx, cPos: cPos, cRot: cRot, stepTable: stepTable, coordSet: coordSet,
    findCorner: findCorner, findEdge: findEdge,
    pieceCoord: pieceCoord, pieceAtHome: pieceAtHome,
    isOrientedCorner: isOrientedCorner, isOrientedEdge: isOrientedEdge,
    pieceSatisfied: pieceSatisfied,
    homeDist: homeDist, orientDist: orientDist, dist: dist,
    applySeq: applySeq, applyMovesToCoord: applyMovesToCoord,
    seqKey: seqKey, moveName: moveName, concatSeq: concatSeq,
    goalTest: goalTest,
    macroLib: macroLib, piecePlan: piecePlan,
    clearCache: function () { MACRO_CACHE = Object.create(null); }
  };
})(typeof window !== 'undefined' ? window : this);
