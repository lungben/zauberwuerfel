/*
 * solver-twophase.js — Kociemba-Zwei-Phasen-Suche („Profi-Modus“) und der
 * darauf aufbauende Permutations-Löser für die letzte Ebene.
 *
 * Phase 1: alle Steine orientieren, E-Slice-Kanten in die Mitte bringen
 *          (Koordinaten twist, flip, slice)  ->  Untergruppe G1
 * Phase 2: nur noch Vertauschen mit U U2 D D2 R2 L2 F2 B2
 *          (Koordinaten cp, ep, sp)          ->  gelöst
 *
 * Die Tabellen werden im Hauptthread in kleinen Schritten aufgebaut, damit die
 * Oberfläche responsiv bleibt (kein Web Worker: funktioniert auch per
 * Doppelklick ohne Server).
 */
(function (global) {
  'use strict';
  var ZW = (global.ZW = global.ZW || {});
  var C = ZW.Cube;

  var TW_N = 2187, FL_N = 2048, SE_N = 495, CP_N = 40320, EP_N = 40320, SP_N = 24;
  var UNKNOWN = 255;

  // G1-Erzeuger: U U2 D D2 R2 L2 F2 B2
  var G1_MOVES = [
    C.moveIndex('U', 1), C.moveIndex('U', 2),
    C.moveIndex('D', 1), C.moveIndex('D', 2),
    C.moveIndex('R', 2), C.moveIndex('L', 2),
    C.moveIndex('F', 2), C.moveIndex('B', 2)
  ];

  var T = {
    basicReady: false,
    fullReady: false,
    twMove: null, flMove: null, seMove: null,
    cpMove: null, epMove: null, spMove: null,   // je G1-Zug (Index 0..7)
    prCp: null, prEp: null, prSp: null,
    prTwSe: null, prFlSe: null, prCpSp: null, prEpSp: null
  };

  /* ------------------------------------------------- Permutations-Code */

  var FACTS = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];

  function decodePerm(idx, size) {
    var out = [], pool = [], i;
    for (i = 0; i < size; i++) pool.push(i);
    for (i = 0; i < size; i++) {
      var f = FACTS[size - 1 - i];
      var d = Math.floor(idx / f);
      idx -= d * f;
      out.push(pool.splice(d, 1)[0]);
    }
    return out;
  }
  function encodePerm(p, size) {
    var idx = 0;
    for (var i = 0; i < size; i++) {
      var smaller = 0;
      for (var j = i + 1; j < size; j++) if (p[j] < p[i]) smaller++;
      idx += smaller * FACTS[size - 1 - i];
    }
    return idx;
  }

  /**
   * Übergangstabelle einer Permutations-Koordinate für die G1-Züge.
   * subset: die Positionen, die die Koordinate beschreibt (z. B. 0..7 = U/D-Kanten)
   * Ergebnis: 8 Tabellen (je G1-Zug) mit je permCount Einträgen.
   */
  function buildPermTable(posMove, baseIdx, subset) {
    var size = subset.length;
    var permCount = FACTS[size];
    var where = {};
    for (var s = 0; s < size; s++) where[subset[s]] = s;
    var maps = [];
    for (var k = 0; k < baseIdx.length; k++) {
      var pm = new Int8Array(size);
      for (var i = 0; i < size; i++) pm[i] = where[posMove[baseIdx[k]][subset[i]]];
      maps.push(pm);
    }
    var out = new Uint16Array(baseIdx.length * permCount);
    var np = new Array(size);
    for (var idx = 0; idx < permCount; idx++) {
      var p = decodePerm(idx, size);
      for (var m = 0; m < baseIdx.length; m++) {
        var mp = maps[m];
        for (var j = 0; j < size; j++) np[mp[j]] = p[j];
        out[m * permCount + idx] = encodePerm(np, size);
      }
    }
    return out;
  }

  /**
   * Übergangstabelle einer Koordinatenfunktion durch BFS über echte Zustände.
   * Garantiert konsistent mit C.twistCoord / C.flipCoord / C.sliceCoord.
   */
  function buildCoordTable(coordFn, size) {
    var table = new Uint16Array(18 * size);
    var seen = new Uint8Array(size);
    var start = new C.State();
    var startCoord = coordFn(start);
    var queue = [start];
    seen[startCoord] = 1;
    var visited = 1;
    for (var head = 0; head < queue.length; head++) {
      var st = queue[head];
      var c = coordFn(st);
      for (var m = 0; m < 18; m++) {
        var t = st.clone();
        C.applyMoveIdx(t, m);
        var c2 = coordFn(t);
        table[m * size + c] = c2;
        if (!seen[c2]) { seen[c2] = 1; visited++; queue.push(t); }
      }
    }
    return { table: table, visited: visited, size: size };
  }

  /* chunkweiser Aufbau einer Pruning-Tabelle für ein Koordinatenpaar */
  function pairPruningJob(size1, table1, size2, table2, goal1, goal2, moveList1, moveList2) {
    var total = size1 * size2;
    var pr = new Uint8Array(total);
    for (var i = 0; i < total; i++) pr[i] = UNKNOWN;
    var goal = goal1 * size2 + goal2;
    pr[goal] = 0;
    var queue = new Int32Array(total);
    var head = 0, tail = 1;
    queue[0] = goal;
    return {
      table: pr,
      step: function (budget) {
        var end = Math.min(head + budget, tail);
        for (; head < end; head++) {
          var idx = queue[head], d = pr[idx] + 1;
          var c1 = Math.floor(idx / size2), c2 = idx % size2;
          for (var m = 0; m < moveList1.length; m++) {
            var n1 = table1[moveList1[m] * size1 + c1];
            var n2 = table2[moveList2[m] * size2 + c2];
            var nidx = n1 * size2 + n2;
            if (pr[nidx] === UNKNOWN) { pr[nidx] = d; queue[tail++] = nidx; }
          }
        }
        return head >= tail;
      },
      progress: function () { return tail / total; }
    };
  }

  /* --------------------------------------------------------- Aufbau */

  function buildBasic() {
    var a = buildCoordTable(C.twistCoord, TW_N);
    var b = buildCoordTable(C.flipCoord, FL_N);
    var c = buildCoordTable(C.sliceCoord, SE_N);
    T.twMove = a.table;
    T.flMove = b.table;
    T.seMove = c.table;
    T.basicReady = true;
    return { twist: a.visited, flip: b.visited, slice: c.visited };
  }

  function buildFull(onProgress, done, sync) {
    var all = [];
    for (var i = 0; i < 18; i++) all.push(i);
    var jobs = [
      { name: 'Orientierung', job: pairPruningJob(TW_N, T.twMove, SE_N, T.seMove, 0, C.SOLVED_SE, all, all) },
      { name: 'Orientierung', job: pairPruningJob(FL_N, T.flMove, SE_N, T.seMove, 0, C.SOLVED_SE, all, all) },
      { name: 'Vertauschung', job: pairPruningJob(CP_N, T.cpMove, SP_N, T.spMove, C.SOLVED_CP, C.SOLVED_SP, g1Idx(), g1Idx()) },
      { name: 'Vertauschung', job: pairPruningJob(EP_N, T.epMove, SP_N, T.spMove, C.SOLVED_EP, C.SOLVED_SP, g1Idx(), g1Idx()) }
    ];
    var out = [null, null, null, null];
    var ji = 0;

    function runChunk() {
      while (ji < jobs.length) {
        var finished = jobs[ji].job.step(120000);
        if (onProgress) {
          var frac = (ji + jobs[ji].job.progress()) / jobs.length;
          onProgress(jobs[ji].name, Math.round(frac * 100));
        }
        if (!finished) {
          if (sync) continue;
          setTimeout(runChunk, 0);
          return;
        }
        out[ji] = jobs[ji].job.table;
        ji++;
      }
      T.prTwSe = out[0];
      T.prFlSe = out[1];
      T.prCpSp = out[2];
      T.prEpSp = out[3];
      T.fullReady = true;
      if (done) done();
    }
    runChunk();
  }
  function g1Idx() {
    var out = [];
    for (var i = 0; i < G1_MOVES.length; i++) out.push(i);
    return out;
  }

  function buildPermTables() {
    var ud = [0, 1, 2, 3, 4, 5, 6, 7];
    var slice = [8, 9, 10, 11];
    var corners = [0, 1, 2, 3, 4, 5, 6, 7];
    T.cpMove = buildPermTable(C.CORNER_MOVE, G1_MOVES, corners);
    T.epMove = buildPermTable(C.EDGE_MOVE, G1_MOVES, ud);
    T.spMove = buildPermTable(C.EDGE_MOVE, G1_MOVES, slice);
  }

  /* ------------------------------------------------------------ Suche */

  function faceOf(m) { return C.MOVE_FACE[m]; }
  function prune(m, path) {
    if (!path.length) return false;
    var f1 = faceOf(path[path.length - 1]);
    if (f1 === faceOf(m)) return true;
    if (path.length > 1) {
      var f2 = faceOf(path[path.length - 2]);
      if (C.OPPOSITE_FACE[f1] === faceOf(m) && f2 === faceOf(m)) return true;
    }
    return false;
  }

  function phase1Coords(st) {
    return { tw: C.twistCoord(st), fl: C.flipCoord(st), se: C.sliceCoord(st) };
  }
  function phase1H(c) {
    return Math.max(T.prTwSe[c.tw * SE_N + c.se], T.prFlSe[c.fl * SE_N + c.se]);
  }
  function phase1Done(c) { return c.tw === 0 && c.fl === 0 && c.se === C.SOLVED_SE; }
  function phase1Advance(c, m) {
    c.tw = T.twMove[m * TW_N + c.tw];
    c.fl = T.flMove[m * FL_N + c.fl];
    c.se = T.seMove[m * SE_N + c.se];
  }

  function searchPhase1(state, bound, budgetNodes) {
    var path = [];
    var nodes = { n: 0 };
    var start = phase1Coords(state);
    var ok = go(start, bound);
    return ok ? path.slice() : null;

    function go(c, b) {
      if (++nodes.n > budgetNodes) throw new Error('budget');
      if (phase1H(c) > b) return false;
      if (phase1Done(c)) return true;
      for (var m = 0; m < 18; m++) {
        if (prune(m, path)) continue;
        var c2 = { tw: c.tw, fl: c.fl, se: c.se };
        phase1Advance(c2, m);
        path.push(m);
        if (go(c2, b - 1)) return true;
        path.pop();
      }
      return false;
    }
  }

  function g1Coords(st) {
    return { cp: C.cornerPermIndex(st), ep: C.edgeUDPermIndex(st), sp: C.slicePermIndex(st) };
  }
  function inG1(st) {
    return C.twistCoord(st) === 0 && C.flipCoord(st) === 0 && C.sliceCoord(st) === C.SOLVED_SE;
  }
  function phase2H(c) {
    return Math.max(T.prCpSp[c.cp * SP_N + c.sp], T.prEpSp[c.ep * SP_N + c.sp]);
  }
  function phase2Done(c) {
    return c.cp === C.SOLVED_CP && c.ep === C.SOLVED_EP && c.sp === C.SOLVED_SP;
  }
  function phase2Advance(c, gi) {
    c.cp = T.cpMove[gi * CP_N + c.cp];
    c.ep = T.epMove[gi * EP_N + c.ep];
    c.sp = T.spMove[gi * SP_N + c.sp];
  }
  function pruneG1(gi, path) {
    if (!path.length) return false;
    var f1 = faceOf(G1_MOVES[path[path.length - 1]]);
    var f2 = faceOf(G1_MOVES[gi]);
    if (f1 === f2) return true;
    if (path.length > 1 && C.OPPOSITE_FACE[f1] === f2 &&
        faceOf(G1_MOVES[path[path.length - 2]]) === f2) return true;
    return false;
  }

  /**
   * Phase 2: reine Vertauschung innerhalb von G1.
   * @returns Zugfolge (Indizes in ZW.Cube.MOVE_NAMES) oder null
   */
  function solvePermutation(state, maxDepth, budgetNodes) {
    if (!T.basicReady || !T.prCpSp) return null;
    if (!inG1(state)) return null;
    var c = g1Coords(state);
    if (phase2Done(c)) return [];
    maxDepth = maxDepth || 20;
    // Phase 2 kann bis zu 18 Züge brauchen; IDA* mit den groben Tabellen
    // besucht dabei auch mal einige Millionen Knoten.
    budgetNodes = budgetNodes || 20000000;
    var path = [];
    var nodes = { n: 0 };
    for (var bound = phase2H(c); bound <= maxDepth; bound++) {
      path.length = 0;
      try {
        if (go(c, bound)) return path.map(function (gi) { return G1_MOVES[gi]; });
      } catch (e) {
        if (e.message === 'budget') return null;
        throw e;
      }
    }
    return null;

    function go(cc, b) {
      if (++nodes.n > budgetNodes) throw new Error('budget');
      if (phase2H(cc) > b) return false;
      if (phase2Done(cc)) return true;
      for (var gi = 0; gi < G1_MOVES.length; gi++) {
        if (pruneG1(gi, path)) continue;
        var c2 = { cp: cc.cp, ep: cc.ep, sp: cc.sp };
        phase2Advance(c2, gi);
        path.push(gi);
        if (go(c2, b - 1)) return true;
        path.pop();
      }
      return false;
    }
  }

  /**
   * Zwei-Phasen-Gesamtlösung.
   * Phase 1 wird mit wachsendem Suchtiefe gelöst; zu jeder gefundenen
   * Phase-1-Folge wird die Vertauschung (Phase 2) gesucht. Die erste
   * vollständige Lösung gewinnt (Phase 1 wächst von unten, ist also kurz).
   * @returns {moves:[Index...], phase1:number} oder null
   */
  function solve(state, opts) {
    opts = opts || {};
    if (!T.fullReady) return null;
    var maxP1 = opts.maxPhase1 || 16;
    var maxP2 = opts.maxPhase2 || 20;
    var budget = opts.nodeBudget || 3000000;
    var deadline = Date.now() + (opts.timeLimit || 4000);
    var start = phase1Coords(state);
    if (phase1Done(start)) {
      var only = solvePermutation(state, maxP2, budget);
      return only === null ? null : { moves: only, phase1: 0 };
    }
    var best = null;
    for (var bound = phase1H(start); bound <= maxP1; bound++) {
      if (Date.now() > deadline) break;
      if (best && bound >= best.length) break;
      var p1;
      try {
        p1 = searchPhase1(state, bound, budget);
      } catch (e) {
        if (e.message === 'budget') break;
        throw e;
      }
      if (!p1) continue;
      var st2 = state.clone();
      var i;
      for (i = 0; i < p1.length; i++) C.applyMoveIdx(st2, p1[i]);
      var p2 = solvePermutation(st2, maxP2, budget);
      if (p2 === null) continue;
      var total = p1.concat(p2);
      if (!best || total.length < best.length) best = { moves: total, phase1: p1.length };
      if (best) break;
    }
    return best;
  }

  ZW.TwoPhase = {
    tables: T,
    G1_MOVES: G1_MOVES,
    buildBasic: buildBasic,
    buildPermTables: buildPermTables,
    buildFull: buildFull,
    solvePermutation: solvePermutation,
    solve: solve,
    inG1: inG1,
    g1Coords: g1Coords,
    phase1Cost: function (st) { return phase1H(phase1Coords(st)); },
    phase2Heuristic: function (c) { return phase2H(c); },
    searchPhase1: function (st, bound, budget) { return searchPhase1(st, bound, budget); },
    phase1Coords: phase1Coords,
    phase1Done: phase1Done
  };
})(typeof window !== 'undefined' ? window : this);
