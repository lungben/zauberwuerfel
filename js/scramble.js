/*
 * scramble.js — Zufalls-Scramble für Würfel und Anzeige.
 *
 * Regel wie bei Wettbewerben: nie zwei Züge derselben Fläche hintereinander
 * und nie drei Züge derselben Achse (U dann D dann U' wäre sonst überflüssig).
 */
(function (global) {
  'use strict';
  var ZW = (global.ZW = global.ZW || {});
  var C = ZW.Cube;

  // Achse einer Fläche: U/D = 0, R/L = 1, F/B = 2
  function axisOf(face) { return Math.min(face, C.OPPOSITE_FACE[face]); }

  /**
   * @param n Anzahl Züge
   * @param rand optionale Zufallsfunktion (für reproduzierbare Tests)
   * @returns {moves:[Index...], names:[String...]}
   */
  function randomMoves(n, rand) {
    rand = rand || Math.random;
    var moves = [], last = -1, second = -1;
    while (moves.length < n) {
      var m = Math.floor(rand() * 18);
      var a = axisOf(C.MOVE_FACE[m]);
      if (last >= 0 && a === axisOf(C.MOVE_FACE[last])) continue;
      if (second >= 0 && a === axisOf(C.MOVE_FACE[second])) continue;
      second = last;
      last = m;
      moves.push(m);
    }
    var names = [];
    for (var i = 0; i < moves.length; i++) names.push(C.MOVE_NAMES[moves[i]]);
    return { moves: moves, names: names };
  }

  function applyTo(state, result) {
    for (var i = 0; i < result.moves.length; i++) C.applyMoveIdx(state, result.moves[i]);
    return state;
  }

  ZW.Scramble = {
    randomMoves: randomMoves,
    applyTo: applyTo,
    axisOf: axisOf
  };
})(typeof window !== 'undefined' ? window : this);
