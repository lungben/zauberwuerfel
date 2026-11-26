/*
 * solver-lbl.js — Löser nach der Anfängermethode, mit Schritt-für-Schritt-Erklärung.
 *
 * Phasen (untere Farbe = Weiß, obere Farbe = Gelb; die Farben sind austauschbar,
 * die Texte folgen der Farbwahl in ZW.Scheme):
 *   1 Kreuz unten                 4 Kreuz oben
 *   2 Ecken der unteren Ebene     5 Ecken der oberen Ebene drehen
 *   3 Mittelkanten                6 Steine der oberen Ebene tauschen
 *
 * Phasen 1–5 stellen immer einen einzelnen Stein fertig und verwenden Suchen,
 * die die schon fertigen Steine nachweislich unangetastet lassen (geprüft über
 * die Übergangstabellen der Stein-Koordinaten, nicht durch Ausprobieren).
 * Phase 6 sucht die kürzeste Vertauschung innerhalb der Untergruppe G1.
 */
(function (global) {
  'use strict';
  var ZW = (global.ZW = global.ZW || {});
  var C = ZW.Cube;
  var S = ZW.SolverCommon;
  var CORNER = S.CORNER, EDGE = S.EDGE;

  var BOTTOM_EDGES = [5, 4, 7, 6];     // DF, DR, DB, DL
  var BOTTOM_CORNERS = [4, 5, 6, 7];   // DFR, DLF, DBL, DRB
  var MIDDLE_EDGES = [8, 9, 10, 11];   // FR, FL, BL, BR
  var TOP_EDGES = [0, 1, 2, 3];
  var TOP_CORNERS = [0, 1, 2, 3];

  /* Bekannte Algorithmen, damit die Texte Namen verwenden können. */
  var ALG_NAMES = {
    "R U R' U'": 'die rechte Palette',
    "R U2 R' U' R U' R'": 'Anti-Sune',
    "R U R' U R U2 R'": 'Sune',
    "F R U R' U' F'": 'der Balken',
    "F U R U' R' F'": 'der Winkel',
    "U R U' R' U' F' U F": 'der Einwurf nach rechts',
    "U' L' U L U F U' F'": 'der Einwurf nach links',
    "R U R' U' R' F R2 U' R' U' R U R' F'": 'T-Perm',
    "R U' R U R U R U' R' U' R2": 'U-Perm im Uhrzeigersinn',
    "R U R' U R U R' U' R' U' R2": 'U-Perm gegen den Uhrzeigersinn'
  };
  function algName(moves) {
    var str = S.seqKey(moves);
    if (ALG_NAMES[str]) return ALG_NAMES[str];
    for (var key in ALG_NAMES) if (str.indexOf(key) >= 0) return ALG_NAMES[key];
    return null;
  }

  /* ------------------------------------------------------------- Benennung */

  function schemeNames() { return ZW.Scheme ? ZW.Scheme.names() : C.COLOR_NAME; }
  function colorOf(faceIdx) { return schemeNames()[faceIdx]; }
  function pieceLabel(kind, id) {
    var cn = schemeNames();
    var faces = kind === CORNER ? C.CORNER_HOME_FACES[id] : C.EDGE_HOME_FACES[id];
    return (kind === CORNER ? 'Ecke ' : 'Kante ') +
      faces.map(function (f) { return cn[f]; }).join('/') +
      ' (' + faces.map(function (f) { return C.FACES[f]; }).join('') + ')';
  }

  function movesOf(letters) {
    var out = [];
    for (var i = 0; i < letters.length; i++) {
      out.push(C.moveIndex(letters[i], 1), C.moveIndex(letters[i], 2), C.moveIndex(letters[i], 3));
    }
    return out;
  }
  var ALL_MOVES = movesOf(['U', 'R', 'F', 'D', 'L', 'B']);
  var TOP_MOVES = movesOf(['U', 'F', 'R']);
  // Alphabet für einen Stein: U-Drehungen plus die Flächen des Steins
  // (beim Kreuz auch die untere Fläche, sonst nicht: die fertige Ebene darf nicht aufgehen)
  function alphabetFor(kind, id, allowD) {
    var faces = kind === CORNER ? C.CORNER_HOME_FACES[id] : C.EDGE_HOME_FACES[id];
    var letters = ['U'];
    for (var i = 0; i < faces.length; i++) {
      var L = C.FACES[faces[i]];
      if (L !== 'U' && (allowD || L !== 'D') && letters.indexOf(L) < 0) letters.push(L);
    }
    if (letters.length < 3) letters = ['U', 'F', 'R'];
    return movesOf(letters.slice(0, 3));
  }

  /* Makros für die obere Ebene: sie werden über die Lagen der Steine der
     oberen Ebene verkettet, damit alle Steine dieser Ebene gleichzeitig
     richtig gedreht werden. */
  function keepOkList(st, keepList) {
    for (var i = 0; i < keepList.length; i++) {
      if (!S.pieceSatisfied(st, keepList[i].kind, keepList[i].id, keepList[i].mode)) return false;
    }
    return true;
  }

  var MACRO_USE = Object.create(null);
  function usableMacros(phase, keepList, macroLen) {
    var key = phase.n + '|' + macroLen + '|' +
      keepList.map(function (k) { return k.kind + k.id + (k.mode || 'home'); }).join(',');
    if (MACRO_USE[key]) return MACRO_USE[key];
    var lib = S.macroLib({
      alphabet: TOP_MOVES, len: macroLen, keep: keepList,
      target: { kind: phase.kind, id: phase.pieces[0], mode: 'orient' },
      pull: false, maxNodes: 500000, maxFound: 4000
    });
    var out = [];
    for (var i = 0; i < lib.length; i++) {
      if (lib[i].moves.length && lib[i].orientSafe) out.push(lib[i].moves);
    }
    out.sort(function (a, b) { return a.length - b.length; });
    MACRO_USE[key] = out;
    return out;
  }

  /**
   * Zugfolge für eine Orientierungsphase: verkettete Macros, die die fertigen
   * Ebenen erhalten, gesucht über die Lagen der Steine der oberen Ebene.
   */
  function orientPlan(phase, st, keepList) {
    var lib = usableMacros(phase, keepList, phase.macroLen);
    if (!lib.length) return null;
    var ids = phase.pieces, n = ids.length, kind = phase.kind, i;
    var tests = [], table = S.stepTable(kind), start = [];
    for (i = 0; i < n; i++) {
      tests.push(S.goalTest(kind, ids[i], 'orient'));
      start.push(S.pieceCoord(st, kind, ids[i]));
    }
    function keyOf(v) {
      var s = '';
      for (var k = 0; k < n; k++) s += String.fromCharCode(v[k]);
      return s;
    }
    function goalReached(v) {
      for (var k = 0; k < n; k++) if (!tests[k](v[k])) return false;
      return true;
    }
    var startKey = keyOf(start);
    var dist = Object.create(null), prev = Object.create(null);
    dist[startKey] = 0;
    var heap = [{ v: start, d: 0 }], popped = 0;

    while (heap.length && popped < 4000) {
      heap.sort(function (a, b) { return a.d - b.d; });
      var cur = heap.shift();
      popped++;
      var ck = keyOf(cur.v);
      if (cur.d > dist[ck]) continue;
      if (goalReached(cur.v)) {
        var chain = [], at = ck;
        while (at !== startKey) {
          if (!prev[at]) return null;
          chain.push(prev[at].macro);
          at = prev[at].p;
          if (chain.length > 6) return null;
        }
        chain.reverse();
        return S.concatSeq(chain);
      }
      for (var m = 0; m < lib.length; m++) {
        var moves = lib[m], nv = cur.v.slice();
        for (var q = 0; q < moves.length; q++) {
          for (var k2 = 0; k2 < n; k2++) nv[k2] = table[moves[q]][nv[k2]];
        }
        var nk = keyOf(nv), nd = cur.d + moves.length;
        if (!(nk in dist) || nd < dist[nk]) {
          dist[nk] = nd;
          prev[nk] = { p: ck, macro: moves };
          heap.push({ v: nv, d: nd });
        }
      }
    }
    return null;
  }

  /* --------------------------------------------------------------- Phasen */

  function pieces(list, kind, mode) {
    var o = [];
    for (var i = 0; i < list.length; i++) o.push({ kind: kind, id: list[i], mode: mode });
    return o;
  }
  var L1L2 = pieces(BOTTOM_EDGES.concat(MIDDLE_EDGES), EDGE, 'home')
    .concat(pieces(BOTTOM_CORNERS, CORNER, 'home'));
  var TOP_ORIENTED = pieces(TOP_EDGES, EDGE, 'orient');

  var PHASES = [
    {
      n: 1, kind: EDGE, mode: 'home', pieces: BOTTOM_EDGES,
      pieceAlphabet: true, allowD: true, macroLen: 6,
      keep: function (done) { return pieces(done, EDGE, 'home'); },
      intro: function () {
        return 'Phase 1 · Kreuz unten — Wir legen zuerst das Kreuz der unteren Farbe (' +
          colorOf(3) + ') an. Jede Kante bekommt ihre eigene Zugfolge; schon fertige ' +
          'Kanten bleiben dabei stehen.';
      },
      observe: function (st, id) { return wherePiece(st, EDGE, id); }
    },
    {
      n: 2, kind: CORNER, mode: 'home', pieces: BOTTOM_CORNERS,
      pieceAlphabet: true, macroLen: 7,
      keep: function (done) {
        return pieces(BOTTOM_EDGES, EDGE, 'home').concat(pieces(done, CORNER, 'home'));
      },
      intro: function () {
        return 'Phase 2 · Ecken der unteren Ebene — Jetzt kommen die vier Ecken mit der ' +
          'unteren Farbe. Wir holen die Ecke mit einer Drehung der oberen Ebene über ihre ' +
          'Lücke und setzen sie mit der Palette ein. Das Kreuz bleibt stehen.';
      },
      observe: function (st, id) { return wherePiece(st, CORNER, id); }
    },
    {
      n: 3, kind: EDGE, mode: 'home', pieces: MIDDLE_EDGES,
      pieceAlphabet: true, macroLen: 8,
      keep: function (done) {
        return pieces(BOTTOM_EDGES, EDGE, 'home')
          .concat(pieces(BOTTOM_CORNERS, CORNER, 'home'))
          .concat(pieces(done, EDGE, 'home'));
      },
      intro: function () {
        return 'Phase 3 · Mittlere Ebene — Nun die vier Mittelkanten. Wir stellen die ' +
          'Seitenfarbe der Kante neben den passenden Mittelstein und schieben sie mit dem ' +
          'Einwurf nach rechts oder links. Die untere Ebene bleibt geschlossen.';
      },
      observe: function (st, id) { return wherePiece(st, EDGE, id); }
    },
    {
      n: 4, kind: EDGE, mode: 'orient', pieces: TOP_EDGES,
      alphabet: TOP_MOVES, macroLen: 8,
      keep: function (done) { return L1L2.concat(pieces(done, EDGE, 'orient')); },
      keepHard: L1L2,
      intro: function () {
        return 'Phase 4 · Kreuz oben — Oben entsteht das Kreuz der oberen Farbe (' +
          colorOf(0) + '). Wir erkennen den Fall (Punkt, Winkel oder Balken) und wenden den ' +
          'passenden Kurzzug an. Die fertigen Ebenen darunter bleiben heil.';
      },
      observe: function (st) { return topPattern(st); }
    },
    {
      n: 5, kind: CORNER, mode: 'orient', pieces: TOP_CORNERS,
      alphabet: TOP_MOVES, macroLen: 8,
      keep: function () { return L1L2.concat(TOP_ORIENTED); },
      keepHard: L1L2.concat(TOP_ORIENTED),
      intro: function () {
        return 'Phase 5 · Ecken der oberen Ebene drehen — Jetzt richten wir die Ecken aus, bis ' +
          'überall die obere Farbe (' + colorOf(0) + ') oben ist. Wir arbeiten mit Sune und ' +
          'Anti-Sune; das Kreuz oben bleibt dabei erhalten.';
      },
      observe: function (st) { return orientCountText(st, CORNER, TOP_CORNERS); }
    },
    {
      n: 6, kind: null, mode: 'perm', pieces: TOP_CORNERS.concat(TOP_EDGES),
      intro: function () {
        return 'Phase 6 · Steine der oberen Ebene tauschen — Zuletzt werden die Steine der ' +
          'oberen Ebene vertauscht: erst die Ecken, dann die Kanten. Der Würfel ist gelöst, ' +
          'sobald alle Steine an ihrer Heimat sitzen.';
      },
      observe: function () { return ''; }
    }
  ];

  /* ------------------------------------------------------- Phasen-Zustand */

  function pieceOk(st, phase, id) { return S.pieceSatisfied(st, phase.kind, id, phase.mode); }
  function phaseDone(st, phase) {
    for (var i = 0; i < phase.pieces.length; i++) if (!pieceOk(st, phase, phase.pieces[i])) return false;
    return true;
  }
  function doneList(st, phase) {
    var o = [];
    for (var i = 0; i < phase.pieces.length; i++) if (pieceOk(st, phase, phase.pieces[i])) o.push(phase.pieces[i]);
    return o;
  }
  // offene Steine, nach Distanz zum Ziel sortiert (einfache zuerst)
  function pendingList(st, phase) {
    var out = [];
    for (var i = 0; i < phase.pieces.length; i++) {
      var id = phase.pieces[i];
      if (pieceOk(st, phase, id)) continue;
      var d = S.dist(phase.kind, id, phase.mode)[S.pieceCoord(st, phase.kind, id)];
      out.push({ id: id, dist: d < 0 ? 99 : d });
    }
    out.sort(function (a, b) { return a.dist - b.dist; });
    return out;
  }

  /* --------------------------------------------------------------- Texte */

  function wherePiece(st, kind, id) {
    var at = kind === CORNER ? S.findCorner(st, id) : S.findEdge(st, id);
    if (!at) return '';
    var names = kind === CORNER ? C.CORNER_NAME : C.EDGE_NAME;
    var layer = at.pos < 4 ? 'oberen' : (at.pos < 8 ? 'unteren' : 'mittleren');
    var twist = kind === CORNER ? C.TWIST_AT[at.pos][id][at.rot] : C.FLIP_AT[at.pos][id][at.rot];
    return 'Sie liegt in der ' + layer + ' Ebene an Position ' + names[at.pos] +
      (twist === 0 ? ' und ist richtig gedreht.' : ' und ist verdreht.');
  }
  function topPattern(st) {
    var on = [];
    for (var i = 0; i < TOP_EDGES.length; i++) if (S.isOrientedEdge(st, TOP_EDGES[i])) on.push(TOP_EDGES[i]);
    if (on.length === 0) return 'Oben sehen wir einen Punkt.';
    if (on.length === 2) {
      var adj = (on[0] === 0 && on[1] === 1) || (on[0] === 1 && on[1] === 2) ||
                (on[0] === 2 && on[1] === 3) || (on[0] === 3 && on[1] === 0);
      return adj ? 'Oben sehen wir einen Winkel.' : 'Oben sehen wir einen Balken.';
    }
    return 'Oben fehlt nur noch eine Kante.';
  }
  function orientCountText(st, kind, ids) {
    var n = 0;
    for (var i = 0; i < ids.length; i++) n += S.pieceSatisfied(st, kind, ids[i], 'orient') ? 1 : 0;
    return n + ' von ' + ids.length + ' Steinen zeigen bereits nach oben.';
  }

  function stepText(phase, before, id, moves) {
    var alg = algName(moves);
    var txt = id === null
      ? phase.observe(before) + ' Zugfolge: ' + S.seqKey(moves)
      : pieceLabel(phase.kind, id) + '. ' + phase.observe(before, id) + ' Zugfolge: ' + S.seqKey(moves);
    if (alg) txt += ' — das ist ' + alg + '.';
    return txt;
  }

  /* -------------------------------------------------------------- Lösung */

  /**
   * @param state aktueller Würfelzustand
   * @param opts  {debug:boolean}
   * @returns {ok, steps:[{move,phase,title,text,alg,piece}], notes:[], error}
   */
  function solve(state, opts) {
    opts = opts || {};
    var st = state.clone();
    var steps = [], notes = [];

    function addInfo(text) { steps.push({ move: null, text: text }); }
    function addMoves(moves, meta) {
      for (var i = 0; i < moves.length; i++) {
        steps.push({
          move: C.MOVE_NAMES[typeof moves[i] === 'number' ? moves[i] : C.moveIndexOf(moves[i])],
          phase: meta.phase, title: meta.title, text: i === 0 ? meta.text : '',
          alg: S.seqKey(moves), piece: meta.piece, kind: meta.kind, id: meta.id
        });
      }
    }

    for (var pi = 0; pi < PHASES.length; pi++) {
      var phase = PHASES[pi];
      if (phase.mode === 'perm') {
        if (phaseDone(st, phase) && C.isSolved(st)) continue;
        addInfo(phase.intro());
        if (!ZW.TwoPhase || !ZW.TwoPhase.tables.fullReady) {
          return { ok: false, steps: steps, notes: notes, error: 'Die Vertauschungs-Suche ist noch nicht bereit.' };
        }
        if (!ZW.TwoPhase.inG1(st)) {
          return { ok: false, steps: steps, notes: notes, error: 'Der Würfel ist nicht im erwarteten Zustand für Phase 6.' };
        }
        var path6 = ZW.TwoPhase.solvePermutation(st, 24, 20000000);
        if (path6 === null) {
          var gc6 = ZW.TwoPhase.g1Coords(st);
          return { ok: false, steps: steps, notes: notes, error: 'Die letzte Ebene konnte nicht getauscht ' +
            'werden (cp=' + gc6.cp + ' ep=' + gc6.ep + ' sp=' + gc6.sp +
            ' h=' + ZW.TwoPhase.phase2Heuristic(gc6) + '). Offen: ' + notHomeList(st) };
        }
        if (path6.length) {
          var txt6 = 'Es fehlen noch ' + countNotHome(st, CORNER, TOP_CORNERS) + ' Ecken und ' +
            countNotHome(st, EDGE, TOP_EDGES) + ' Kanten an ihrer Heimat. Wir tauschen sie mit ' +
            path6.length + ' Zügen: ' + S.seqKey(path6);
          var nm6 = algName(path6);
          if (nm6) txt6 += ' — das ist ' + nm6 + '.';
          addMoves(path6, { phase: phase.n, title: 'Phase 6', text: txt6, piece: 'obere Ebene' });
          S.applySeq(st, path6);
        }
        continue;
      }

      if (phaseDone(st, phase)) continue;
      addInfo(phase.intro());

      var guard = 0;
      while (!phaseDone(st, phase)) {
        if (++guard > 12) {
          return { ok: false, steps: steps, notes: notes, error: 'Phase ' + phase.n + ' kommt nicht voran.' };
        }
        var before = st.clone();
        var seq = null, targetId = null, label = '';

        if (phase.mode === 'orient') {
          seq = orientPlan(phase, st, phase.keepHard);
          if (seq !== null) {
            var chk = st.clone();
            S.applySeq(chk, seq);
            if (!keepOkList(chk, phase.keepHard) || !phaseDone(chk, phase)) seq = null;
          }
          if (seq !== null) {
            label = phase.n === 4 ? 'Kreuz der oberen Ebene' : 'Ecken der oberen Ebene';
            if (opts.debug) notes.push('P' + phase.n + ' obere Ebene: ' + S.seqKey(seq));
          }
        }

        if (seq === null) {
          var pending = pendingList(st, phase);
          if (!pending.length) break;
          targetId = pending[0].id;
          var keepList = phase.keep(doneList(st, phase));
          var goal = { kind: phase.kind, id: targetId, mode: phase.mode };
          var alph = phase.pieceAlphabet ? alphabetFor(phase.kind, targetId, phase.allowD) : phase.alphabet;

          seq = S.piecePlan(st, {
            piece: goal, keep: keepList, alphabet: alph, macroLen: phase.macroLen
          });
          if (seq === null && alph !== ALL_MOVES) {
            // breiter: alle Züge erlauben
            seq = S.piecePlan(st, {
              piece: goal, keep: keepList, alphabet: ALL_MOVES, macroLen: phase.macroLen
            });
            if (seq !== null && opts.debug) notes.push('P' + phase.n + ' (breit) ' + S.seqKey(seq));
          }
          if (seq === null) {
            return { ok: false, steps: steps, notes: notes, error: 'Für ' + pieceLabel(phase.kind, targetId) +
              ' wurde keine schonende Zugfolge gefunden.' };
          }
          if (!seq.length) continue;
          label = pieceLabel(phase.kind, targetId);
          if (opts.debug) notes.push('P' + phase.n + ' ' + label + ': ' + S.seqKey(seq));

          // Sicherheitsnetz: wirkt die Zugfolge wirklich wie geplant?
          var check = st.clone();
          S.applySeq(check, seq);
          if (!S.pieceSatisfied(check, phase.kind, targetId, phase.mode)) {
            return { ok: false, steps: steps, notes: notes, error: 'Interne Suche: Zugfolge passt nicht zum Ziel.' };
          }
        }

        addMoves(seq, {
          phase: phase.n, title: 'Phase ' + phase.n,
          text: stepText(phase, before, targetId, seq), piece: label,
          kind: phase.kind, id: targetId
        });
        S.applySeq(st, seq);
      }
    }

    var ok = C.isSolved(st);
    return { ok: ok, steps: steps, notes: notes, finalState: st, error: ok ? null : 'Der Würfel ist am Ende nicht gelöst.' };
  }

  function countNotHome(st, kind, ids) {
    var n = 0;
    for (var i = 0; i < ids.length; i++) if (!S.pieceAtHome(st, kind, ids[i])) n++;
    return n;
  }
  function notHomeList(st) {
    var out = [], ids = TOP_CORNERS.concat(TOP_EDGES);
    for (var i = 0; i < ids.length; i++) {
      var kind = i < TOP_CORNERS.length ? CORNER : EDGE;
      if (S.pieceAtHome(st, kind, ids[i])) continue;
      var at = kind === CORNER ? S.findCorner(st, ids[i]) : S.findEdge(st, ids[i]);
      out.push(ids[i] + '@' + (at ? at.pos : '?'));
    }
    return out.length ? out.join(' ') : 'alle Steine an Heimat';
  }

  ZW.SolverLBL = {
    solve: solve,
    phases: PHASES,
    pieceLabel: pieceLabel,
    bottomEdges: BOTTOM_EDGES, bottomCorners: BOTTOM_CORNERS, middleEdges: MIDDLE_EDGES,
    topEdges: TOP_EDGES, topCorners: TOP_CORNERS
  };
})(typeof window !== 'undefined' ? window : this);
