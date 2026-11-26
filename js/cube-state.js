/*
 * cube-state.js — Würfel-Modell (3x3), vollständig geometrisch abgeleitet.
 *
 * Basis sind die 24 Drehungen des Würfels. Jeder Zug ist eine Drehung einer
 * Ebene; daraus folgen Facelet-Permutation, Cubie-Permutation und
 * Orientierung automatisch. Damit sind Anzeige, Mischen und beide Löser
 * garantiert konsistent.
 *
 * Flächen-/Farbreihenfolge (auch für die Kociemba-Koordinaten verwendet):
 *   0=U gelb, 1=R orange, 2=F grün, 3=D weiß, 4=L rot, 5=B blau
 * Das ist ein real übliches Farbschema, nur um 180° um die F-Achse gedreht:
 * dadurch liegt das weiße Kreuz unten und Gelb oben, wie in der
 * Anfängermethode üblich.
 *
 * Kein ES-Modul: alles hängt an window.ZW, damit die App per Doppelklick
 * (file://) in Chrome und Firefox läuft.
 */
(function (global) {
  'use strict';

  var ZW = (global.ZW = global.ZW || {});

  /* ------------------------------------------------------------- Vektoren */

  function V(x, y, z) { return { x: x, y: y, z: z }; }
  function add(a, b) { return V(a.x + b.x, a.y + b.y, a.z + b.z); }
  function sub(a, b) { return V(a.x - b.x, a.y - b.y, a.z - b.z); }
  function mul(a, s) { return V(a.x * s, a.y * s, a.z * s); }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function cross(a, b) {
    return V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }
  function keyOf(v) { return v.x + ',' + v.y + ',' + v.z; }

  var FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
  var FACE_INDEX = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
  // Gegenüberliegende Fläche: U<->D, R<->L, F<->B
  var OPPOSITE_FACE = [3, 4, 5, 0, 1, 2];
  var NORMAL = [V(0, 1, 0), V(1, 0, 0), V(0, 0, 1), V(0, -1, 0), V(-1, 0, 0), V(0, 0, -1)];
  // RIGHTV/DOWNV: Blickrichtung auf die Fläche von außen; u x v = -n
  var RIGHTV = [V(1, 0, 0), V(0, 0, -1), V(1, 0, 0), V(1, 0, 0), V(0, 0, 1), V(-1, 0, 0)];
  var DOWNV = [V(0, 0, 1), V(0, -1, 0), V(0, -1, 0), V(0, 0, -1), V(0, -1, 0), V(0, -1, 0)];

  var COLOR_HEX = ['#ffd500', '#ff7a00', '#00a651', '#ffffff', '#d22630', '#0051ba'];
  var COLOR_NAME = ['Gelb', 'Orange', 'Grün', 'Weiß', 'Rot', 'Blau'];
  var FACE_DE = { U: 'oben', D: 'unten', L: 'links', R: 'rechts', F: 'vorn', B: 'hinten' };

  // Cubie-Positionen und -Namen (Reihenfolge wie bei Kociemba)
  var CORNER_COORD = [
    V(1, 1, 1), V(-1, 1, 1), V(-1, 1, -1), V(1, 1, -1),
    V(1, -1, 1), V(-1, -1, 1), V(-1, -1, -1), V(1, -1, -1)
  ];
  var CORNER_NAME = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
  var EDGE_COORD = [
    V(1, 1, 0), V(0, 1, 1), V(-1, 1, 0), V(0, 1, -1),
    V(1, -1, 0), V(0, -1, 1), V(-1, -1, 0), V(0, -1, -1),
    V(1, 0, 1), V(-1, 0, 1), V(-1, 0, -1), V(1, 0, -1)
  ];
  var EDGE_NAME = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];
  var EDGE_HOME_FACES = EDGE_COORD.map(function (cc) {
    var out = [];
    for (var f = 0; f < 6; f++) if (dot(cc, NORMAL[f]) === 1) out.push(f);
    return out;
  });
  var CORNER_HOME_FACES = CORNER_COORD.map(function (cc) {
    var out = [];
    for (var f = 0; f < 6; f++) if (dot(cc, NORMAL[f]) === 1) out.push(f);
    return out;
  });

  /* ------------------------------------------------------- Drehungen (Gruppe) */

  // Matrix = Bilder der Basisvektoren {x, y, z}; M*v = x*v.x + y*v.y + z*v.z
  function applyM(M, v) { return add(add(mul(M.x, v.x), mul(M.y, v.y)), mul(M.z, v.z)); }
  function mulM(A, B) { return { x: applyM(A, B.x), y: applyM(A, B.y), z: applyM(A, B.z) }; }
  var IDENTITY = { x: V(1, 0, 0), y: V(0, 1, 0), z: V(0, 0, 1) };
  function keyM(M) { return keyOf(M.x) + '|' + keyOf(M.y) + '|' + keyOf(M.z); }

  // Drehung um -90° um die Einheitsachse n (im Uhrzeigersinn von außen gesehen)
  function quarterCW(n) {
    var col = function (b) { return sub(mul(n, dot(n, b)), cross(n, b)); };
    return { x: col(V(1, 0, 0)), y: col(V(0, 1, 0)), z: col(V(0, 0, 1)) };
  }
  // Drehung um +120° um eine Raumdiagonale (für die Eck-Orientierung)
  function thirdTurn(d) {
    var l = Math.sqrt(3);
    var u = V(d.x / l, d.y / l, d.z / l);
    var cos = -0.5, sin = Math.sqrt(3) / 2;
    var col = function (b) {
      var r = add(add(mul(b, cos), mul(cross(u, b), sin)), mul(u, dot(u, b) * (1 - cos)));
      return V(Math.round(r.x), Math.round(r.y), Math.round(r.z));
    };
    return { x: col(V(1, 0, 0)), y: col(V(0, 1, 0)), z: col(V(0, 0, 1)) };
  }

  var ROTATIONS = [IDENTITY];
  var ROT_INDEX = {};
  ROT_INDEX[keyM(IDENTITY)] = 0;
  (function buildRotations() {
    var gens = [quarterCW(V(1, 0, 0)), quarterCW(V(0, 1, 0)), quarterCW(V(0, 0, 1))];
    for (var i = 0; i < ROTATIONS.length; i++) {
      for (var g = 0; g < gens.length; g++) {
        var m = mulM(gens[g], ROTATIONS[i]);
        var k = keyM(m);
        if (!(k in ROT_INDEX)) { ROT_INDEX[k] = ROTATIONS.length; ROTATIONS.push(m); }
      }
    }
  })();
  var ROT_MUL = [];
  for (var ra = 0; ra < ROTATIONS.length; ra++) {
    ROT_MUL[ra] = [];
    for (var rb = 0; rb < ROTATIONS.length; rb++) {
      ROT_MUL[ra][rb] = ROT_INDEX[keyM(mulM(ROTATIONS[ra], ROTATIONS[rb]))];
    }
  }
  var ROT_INVERSE = ROTATIONS.map(function (M) {
    return ROT_INDEX[keyM({
      x: V(M.x.x, M.y.x, M.z.x), y: V(M.x.y, M.y.y, M.z.y), z: V(M.x.z, M.y.z, M.z.z)
    })];
  });

  /* ------------------------------------------------------------- Züge (18) */

  // Index = faceIdx*3 + (turns-1):  U U2 U' R R2 R' F F2 F' D D2 D' L L2 L' B B2 B'
  var MOVE_NAMES = [], MOVE_FACE = [], MOVE_TURNS = [], MOVE_AXIS = [], MOVE_ANGLE = [], MOVE_ROT = [];
  for (var mf = 0; mf < 6; mf++) {
    for (var mt = 1; mt <= 3; mt++) {
      MOVE_NAMES.push(FACES[mf] + (mt === 1 ? '' : mt === 2 ? '2' : "'"));
      MOVE_FACE.push(mf);
      MOVE_TURNS.push(mt);
      MOVE_AXIS.push(NORMAL[mf]);
      MOVE_ANGLE.push(-Math.PI / 2 * mt);
      var mm = IDENTITY, q = quarterCW(NORMAL[mf]);
      for (var k2 = 0; k2 < mt; k2++) mm = mulM(q, mm);
      MOVE_ROT.push(ROT_INDEX[keyM(mm)]);
    }
  }
  var MOVE_NAME_INDEX = {};
  for (var mn = 0; mn < 18; mn++) MOVE_NAME_INDEX[MOVE_NAMES[mn]] = mn;
  var MOVE_AXIS_INDEX = {};
  for (var ma = 0; ma < 18; ma++) MOVE_AXIS_INDEX[MOVE_NAMES[ma]] = MOVE_FACE[ma];

  function faceIndexOfVector(v) {
    for (var f = 0; f < 6; f++) if (dot(v, NORMAL[f]) === 1) return f;
    return -1;
  }

  /* ------------------------------------------ Facelets (54 Aufkleber) */

  function stickerIndex(face, offset) {
    var r = 1 + dot(offset, DOWNV[face]);
    var c = 1 + dot(offset, RIGHTV[face]);
    return face * 9 + r * 3 + c;
  }
  var STICKER_CENTER = [], STICKER_OFFSET = [];
  for (var sf = 0; sf < 6; sf++) {
    for (var row = 0; row < 3; row++) {
      for (var col = 0; col < 3; col++) {
        var off = add(mul(RIGHTV[sf], col - 1), mul(DOWNV[sf], row - 1));
        STICKER_CENTER.push(add(NORMAL[sf], off));
        STICKER_OFFSET.push(off);
      }
    }
  }
  var colorOfSticker = function (i) { return Math.floor(i / 9); };

  // PERM[m][i] = Zielindex des Aufklebers i
  var PERM = MOVE_ROT.map(function (rIdx, m) {
    var nrm = NORMAL[MOVE_FACE[m]], M = ROTATIONS[rIdx], p = new Int8Array(54);
    for (var i = 0; i < 54; i++) {
      var ctr = STICKER_CENTER[i];
      if (dot(ctr, nrm) !== 1) { p[i] = i; continue; }
      // Fläche aus der gedrehten Aufkleber-Normale, Zeile/Spalte aus dem Versatz
      var tf = faceIndexOfVector(applyM(M, NORMAL[Math.floor(i / 9)]));
      p[i] = stickerIndex(tf, applyM(M, STICKER_OFFSET[i]));
    }
    return p;
  });

  // FACELET_MAP[r][i] = Ziel-Facelet-Index des Aufklebers i unter Würfeldrehung r
  var FACELET_MAP = ROTATIONS.map(function (M) {
    var out = new Int8Array(54);
    for (var i = 0; i < 54; i++) {
      // Ziel-Fläche ist die gedrehte Fläche des Aufklebers; der gedrehte Versatz
      // wird in Zeile/Spalte dieser Fläche umgerechnet (funktioniert auch für
      // Eck-Aufkleber, deren Versatz diagonal ist).
      var tf = faceIndexOfVector(applyM(M, NORMAL[Math.floor(i / 9)]));
      out[i] = stickerIndex(tf, applyM(M, STICKER_OFFSET[i]));
    }
    return out;
  });

  /* ------------------------------------------------- Cubie-Ebene (8 + 12) */

  function coordToPos(list, v) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].x === v.x && list[i].y === v.y && list[i].z === v.z) return i;
    }
    return -1;
  }
  // Positions-Permutation je Zug: nur die Steine der betroffenen Ebene wandern,
  // alle anderen bleiben an ihrem Platz.
  var CORNER_MOVE = [], EDGE_MOVE = [];
  var CORNER_AFFECTED = [], EDGE_AFFECTED = [];
  for (var mc = 0; mc < 18; mc++) {
    var Mr = ROTATIONS[MOVE_ROT[mc]];
    var axis = NORMAL[MOVE_FACE[mc]];
    var carr = new Int8Array(8), earr = new Int8Array(12);
    var caff = [], eaff = [];
    for (var ci = 0; ci < 8; ci++) {
      if (dot(CORNER_COORD[ci], axis) === 1) {
        carr[ci] = coordToPos(CORNER_COORD, applyM(Mr, CORNER_COORD[ci]));
        caff.push(ci);
      } else carr[ci] = ci;
    }
    for (var ei = 0; ei < 12; ei++) {
      if (dot(EDGE_COORD[ei], axis) === 1) {
        earr[ei] = coordToPos(EDGE_COORD, applyM(Mr, EDGE_COORD[ei]));
        eaff.push(ei);
      } else earr[ei] = ei;
    }
    CORNER_MOVE.push(carr);
    EDGE_MOVE.push(earr);
    CORNER_AFFECTED.push(caff);
    EDGE_AFFECTED.push(eaff);
  }
  // Home-Aufkleber je Cubie (Facelet-Index im gelösten Zustand)
  var CORNER_HOME_STICKERS = CORNER_COORD.map(function (cc) {
    return CORNER_HOME_FACES[coordToPos(CORNER_COORD, cc)].map(function (f) {
      return stickerIndex(f, sub(cc, NORMAL[f]));
    });
  });
  var EDGE_HOME_STICKERS = EDGE_COORD.map(function (cc) {
    return EDGE_HOME_FACES[coordToPos(EDGE_COORD, cc)].map(function (f) {
      return stickerIndex(f, sub(cc, NORMAL[f]));
    });
  });

  /* ------------------------------------------------- Orientierung (Twist/Flip) */

  // Eck-Orientierung ("Drehen des Steins an seiner Stelle"):
  // t = Anzahl Drehungen um die eigene Raumdiagonale, bis die U/D-Farbe auf
  // der U-/D-Fläche der Position zeigt.
  var CORNER_UD_FACE = CORNER_HOME_FACES.map(function (fs) {
    for (var i = 0; i < fs.length; i++) if (fs[i] === 0 || fs[i] === 3) return fs[i];
    return -1;
  });
  // Q[pos][t] = t Drehungen um die Raumdiagonale der Position (gegen Uhrzeigersinn
  // von außen gesehen); Vorzeichen wird unten per Invarianten-Test festgelegt.
  function buildCornerTwistTables(sign) {
    var QT = CORNER_COORD.map(function (cc) {
      var base = thirdTurn(mul(cc, sign));
      var out = [IDENTITY, base, mulM(base, base)];
      return out.map(function (M) { return ROT_INDEX[keyM(M)]; });
    });
    var TW = []; // TW[cubie][rot] -> {t...} abhängig von der Position
    var table = []; // table[pos][cubie][rot] = twist
    for (var pos = 0; pos < 8; pos++) {
      table[pos] = [];
      var ud = (CORNER_COORD[pos].y === 1) ? V(0, 1, 0) : V(0, -1, 0);
      for (var cub = 0; cub < 8; cub++) {
        var hf = CORNER_UD_FACE[cub];
        var homeDir = NORMAL[hf];
        var row = [];
        for (var r = 0; r < 24; r++) {
          var v = applyM(ROTATIONS[r], homeDir);
          var t = -1;
          for (var k = 0; k < 3; k++) {
            if (keyOf(applyM(ROTATIONS[QT[pos][k]], v)) === keyOf(ud)) { t = k; break; }
          }
          row.push(t);
        }
        table[pos][cub] = row;
      }
    }
    void TW;
    return table;
  }
  var TWIST_AT = buildCornerTwistTables(1);
  var TWIST_AT_NEG = buildCornerTwistTables(-1);

  // Referenzflächen: U/D-Fläche einer Kante bzw. F/B-Fläche
  var EDGE_UD_HOME = EDGE_HOME_FACES.map(function (fs) {
    for (var i = 0; i < fs.length; i++) if (fs[i] === 0 || fs[i] === 3) return fs[i];
    return -1;
  });
  var EDGE_FB_HOME = EDGE_HOME_FACES.map(function (fs) {
    for (var i = 0; i < fs.length; i++) if (fs[i] === 2 || fs[i] === 5) return fs[i];
    return -1;
  });

  // Kanten-Orientierung (Flip) nach Kociemba: jeder Stein hat einen
  // Referenz-Aufkleber (U/D-Farbe bei U/D-Kanten, F/B-Farbe bei den Kanten der
  // Mittelebene). Flip 0 heißt: dieser Aufkleber liegt auf der Referenzfläche
  // der aktuellen Position (U/D-Fläche bei U/D-Positionen, F/B-Fläche in der
  // Mitte). Genau die 10 Züge U,U2,U',D,D2,D',R2,L2,F2,B2 lassen den Flip in
  // Ruhe; dadurch ist die Flip-Koordinate wohldefiniert und die Summe gerade.
  var FLIP_AT = (function () {
    var table = [];
    for (var pos = 0; pos < 12; pos++) {
      table[pos] = [];
      var refPos = pos < 8 ? EDGE_UD_HOME[pos] : EDGE_FB_HOME[pos];
      for (var cub = 0; cub < 12; cub++) {
        var refCub = cub < 8 ? EDGE_UD_HOME[cub] : EDGE_FB_HOME[cub];
        var row = [];
        for (var r = 0; r < 24; r++) {
          if (refCub < 0 || refPos < 0) { row.push(1); continue; }
          var d = applyM(ROTATIONS[r], NORMAL[refCub]);
          row.push(dot(d, NORMAL[refPos]) === 1 ? 0 : 1);
        }
        table[pos][cub] = row;
      }
    }
    return table;
  })();

  /* ------------------------------------------------------------------ State */

  function State() {
    this.cp = new Int8Array(8);
    this.cr = new Int8Array(8);
    this.ep = new Int8Array(12);
    this.er = new Int8Array(12);
    for (var i = 0; i < 8; i++) this.cp[i] = i;
    for (var j = 0; j < 12; j++) this.ep[j] = j;
  }
  State.prototype.clone = function () {
    var s = new State();
    s.cp.set(this.cp); s.cr.set(this.cr); s.ep.set(this.ep); s.er.set(this.er);
    return s;
  };
  function isSolved(st) {
    for (var i = 0; i < 8; i++) if (st.cp[i] !== i || st.cr[i] !== 0) return false;
    for (var j = 0; j < 12; j++) if (st.ep[j] !== j || st.er[j] !== 0) return false;
    return true;
  }
  function applyMoveIdx(st, m) {
    var cm = CORNER_MOVE[m], em = EDGE_MOVE[m], rm = MOVE_ROT[m];
    var ca = CORNER_AFFECTED[m], ea = EDGE_AFFECTED[m];
    var ncp = new Int8Array(st.cp), ncr = new Int8Array(st.cr);
    for (var i = 0; i < ca.length; i++) {
      var from = ca[i], to = cm[from];
      ncp[to] = st.cp[from];
      ncr[to] = ROT_MUL[rm][st.cr[from]];
    }
    var nep = new Int8Array(st.ep), ner = new Int8Array(st.er);
    for (var j = 0; j < ea.length; j++) {
      var from2 = ea[j], to2 = em[from2];
      nep[to2] = st.ep[from2];
      ner[to2] = ROT_MUL[rm][st.er[from2]];
    }
    st.cp = ncp; st.cr = ncr; st.ep = nep; st.er = ner;
    return st;
  }
  function moveIndexOf(name) {
    var idx = MOVE_NAME_INDEX[name];
    if (idx === undefined) throw new Error('Unbekannter Zug: ' + name);
    return idx;
  }
  // Zug-Index aus Flächenbuchstabe und Anzahl Drehungen (1, 2, 3)
  function moveIndex(faceLetter, turns) {
    var f = FACE_INDEX[faceLetter];
    if (f === undefined || turns < 1 || turns > 3) throw new Error('Ungültiger Zug: ' + faceLetter + turns);
    return f * 3 + (turns - 1);
  }
  function applyMoves(st, names) {
    for (var i = 0; i < names.length; i++) {
      applyMoveIdx(st, typeof names[i] === 'number' ? names[i] : moveIndexOf(names[i]));
    }
    return st;
  }
  function parseAlg(str) {
    var out = [];
    var toks = String(str).trim().split(/[\s,]+/);
    for (var i = 0; i < toks.length; i++) {
      var tok = toks[i];
      if (!tok) continue;
      var base = /^[URLFDB]/.exec(tok);
      if (!base) throw new Error('Ungültiger Zug: ' + tok);
      var suffix = tok.slice(1).replace(/’/, "'");
      if (suffix === '') out.push(base[0]);
      else if (suffix === '2') out.push(base[0] + '2');
      else if (suffix === "'") out.push(base[0] + "'");
      else throw new Error('Ungültiger Zug: ' + tok);
    }
    return out;
  }
  function invertMoves(names) {
    var out = [];
    for (var i = names.length - 1; i >= 0; i--) {
      var n = names[i];
      if (n.indexOf("'") >= 0) out.push(n[0]);
      else if (n.indexOf('2') >= 0) out.push(n);
      else out.push(n + "'");
    }
    return out;
  }
  function toFacelets(st) {
    var tmp = new Int8Array(54);
    function place(homeStickers, rot) {
      var map = FACELET_MAP[rot];
      for (var a = 0; a < homeStickers.length; a++) {
        tmp[map[homeStickers[a]]] = colorOfSticker(homeStickers[a]);
      }
    }
    for (var c = 0; c < 8; c++) place(CORNER_HOME_STICKERS[st.cp[c]], st.cr[c]);
    for (var e = 0; e < 12; e++) place(EDGE_HOME_STICKERS[st.ep[e]], st.er[e]);
    for (var f = 0; f < 6; f++) tmp[f * 9 + 4] = f;
    return tmp;
  }
  function cornerInfo(st, pos) {
    return { cubie: st.cp[pos], twist: TWIST_AT[pos][st.cp[pos]][st.cr[pos]] };
  }
  function edgeInfo(st, pos) {
    return { cubie: st.ep[pos], flip: FLIP_AT[pos][st.ep[pos]][st.er[pos]] };
  }

  /* --------------------------------------------- Kociemba-Koordinaten */

  var POW3 = [1, 3, 9, 27, 81, 243, 729];
  var POW2 = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
  function twistCoord(st) {
    var v = 0;
    for (var i = 0; i < 7; i++) v += TWIST_AT[i][st.cp[i]][st.cr[i]] * POW3[i];
    return v;
  }
  function twistSum(st) {
    var v = 0;
    for (var i = 0; i < 8; i++) v += TWIST_AT[i][st.cp[i]][st.cr[i]];
    return v % 3;
  }
  function flipCoord(st) {
    // 11 Kanten genügen: die 12. ist durch die gerade Flipsumme bestimmt
    var v = 0;
    for (var i = 0; i < 11; i++) v += FLIP_AT[i][st.ep[i]][st.er[i]] * POW2[i];
    return v;
  }
  function flipSum(st) {
    var v = 0;
    for (var i = 0; i < 12; i++) v += FLIP_AT[i][st.ep[i]][st.er[i]];
    return v % 2;
  }
  var COMB_MAP = (function () {
    var map = new Int32Array(1 << 12);
    for (var i = 0; i < map.length; i++) map[i] = -1;
    var idx = 0;
    for (var mask = 0; mask < (1 << 12); mask++) {
      var cnt = 0;
      for (var b = 0; b < 12; b++) if (mask & (1 << b)) cnt++;
      if (cnt === 4) map[mask] = idx++;
    }
    return map;
  })();
  var SOLVED_SE = COMB_MAP[0xF00];
  function sliceCoord(st) {
    var mask = 0;
    for (var pos = 0; pos < 12; pos++) if (st.ep[pos] >= 8) mask |= (1 << pos);
    return COMB_MAP[mask];
  }
  var FACTS = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];
  function permIndex(arr, offset, size) {
    var idx = 0;
    for (var i = 0; i < size; i++) {
      var smaller = 0;
      for (var j = i + 1; j < size; j++) if (arr[offset + j] < arr[offset + i]) smaller++;
      idx += smaller * FACTS[size - 1 - i];
    }
    return idx;
  }
  function cornerPermIndex(st) { return permIndex(st.cp, 0, 8); }
  function edgeUDPermIndex(st) { return permIndex(st.ep, 0, 8); }
  function slicePermIndex(st) { return permIndex(st.ep, 8, 4); }
  var SOLVED_CP = permIndex([0, 1, 2, 3, 4, 5, 6, 7], 0, 8);
  var SOLVED_EP = permIndex([0, 1, 2, 3, 4, 5, 6, 7], 0, 8);
  var SOLVED_SP = permIndex([8, 9, 10, 11], 0, 4);

  function parityOf(st) {
    // Parität der Ecken- und Kantenpermutation (0 = gerade)
    function par(arr) {
      var a = Array.prototype.slice.call(arr), p = 0;
      for (var i = 0; i < a.length; i++) {
        for (var j = i + 1; j < a.length; j++) if (a[i] > a[j]) p++;
      }
      return p % 2;
    }
    return { corners: par(st.cp), edges: par(st.ep) };
  }

  ZW.Cube = {
    FACES: FACES,
    FACE_INDEX: FACE_INDEX,
    OPPOSITE_FACE: OPPOSITE_FACE,
    moveIndex: moveIndex,
    FACE_DE: FACE_DE,
    NORMAL: NORMAL,
    RIGHTV: RIGHTV,
    DOWNV: DOWNV,
    COLOR_HEX: COLOR_HEX,
    COLOR_NAME: COLOR_NAME,
    CORNER_COORD: CORNER_COORD,
    CORNER_NAME: CORNER_NAME,
    CORNER_HOME_FACES: CORNER_HOME_FACES,
    EDGE_COORD: EDGE_COORD,
    EDGE_NAME: EDGE_NAME,
    EDGE_HOME_FACES: EDGE_HOME_FACES,
    ROTATIONS: ROTATIONS,
    ROT_MUL: ROT_MUL,
    ROT_INVERSE: ROT_INVERSE,
    MOVE_NAMES: MOVE_NAMES,
    MOVE_NAME_INDEX: MOVE_NAME_INDEX,
    MOVE_FACE: MOVE_FACE,
    MOVE_TURNS: MOVE_TURNS,
    MOVE_AXIS: MOVE_AXIS,
    MOVE_ANGLE: MOVE_ANGLE,
    MOVE_ROT: MOVE_ROT,
    PERM: PERM,
    FACELET_MAP: FACELET_MAP,
    CORNER_MOVE: CORNER_MOVE,
    EDGE_MOVE: EDGE_MOVE,
    CORNER_AFFECTED: CORNER_AFFECTED,
    EDGE_AFFECTED: EDGE_AFFECTED,
    CORNER_HOME_STICKERS: CORNER_HOME_STICKERS,
    EDGE_HOME_STICKERS: EDGE_HOME_STICKERS,
    TWIST_AT: TWIST_AT,
    TWIST_AT_NEG: TWIST_AT_NEG,
    FLIP_AT: FLIP_AT,
    State: State,
    isSolved: isSolved,
    applyMoveIdx: applyMoveIdx,
    applyMoves: applyMoves,
    moveIndexOf: moveIndexOf,
    parseAlg: parseAlg,
    invertMoves: invertMoves,
    toFacelets: toFacelets,
    cornerInfo: cornerInfo,
    edgeInfo: edgeInfo,
    twistCoord: twistCoord,
    twistSum: twistSum,
    flipCoord: flipCoord,
    flipSum: flipSum,
    sliceCoord: sliceCoord,
    cornerPermIndex: cornerPermIndex,
    edgeUDPermIndex: edgeUDPermIndex,
    slicePermIndex: slicePermIndex,
    SOLVED_TW: 0,
    SOLVED_FL: 0,
    SOLVED_SE: SOLVED_SE,
    SOLVED_CP: SOLVED_CP,
    SOLVED_EP: SOLVED_EP,
    SOLVED_SP: SOLVED_SP,
    COMB_MAP: COMB_MAP,
    parityOf: parityOf,
    colorOfSticker: colorOfSticker,
    applyM: applyM,
    mulM: mulM,
    dot: dot,
    cross: cross,
    V: V
  };
})(typeof window !== 'undefined' ? window : this);
