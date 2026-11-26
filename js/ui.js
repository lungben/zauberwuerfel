/*
 * ui.js — Steuerung, Zähler, Schritt-Panel und Wiedergabe.
 *
 * Die App besitzt den einzigen wahren Zustand (ZW.Cube.State). Löser liefern
 * nur Zugfolgen; hier werden sie Schritt für Schritt abgespielt, rückwärts wie
 * vorwärts. Manuelles Drehen, Mischen und Zurücksetzen wirken sofort.
 */
(function (global) {
  'use strict';
  var ZW = (global.ZW = global.ZW || {});
  var C = ZW.Cube;

  var TOP_CORNERS = [0, 1, 2, 3], TOP_EDGES = [0, 1, 2, 3];

  function el(id) { return document.getElementById(id); }
  function inverseOf(moveIdx) {
    var f = C.MOVE_FACE[moveIdx], t = C.MOVE_TURNS[moveIdx];
    return f * 3 + (t === 1 ? 2 : t === 2 ? 1 : 0);
  }

  function App(root) {
    this.doc = root || document;
    this.state = new C.State();
    this.view = null;
    this.mode = 'lbl';
    this.plan = null;          // {steps:[…], pos, title}
    this.auto = false;
    this.speed = 1;
    this.counts = { manual: 0, solver: 0, total: 0 };
    this.scramble = '';
    this.lastManual = null;
    this.tables = { basic: false, full: false };
  }

  /* --------------------------------------------------------------- Start */

  App.prototype.init = function () {
    var self = this;
    ZW.Scheme.load();
    this.cacheDom();
    this.buildMoveButtons();
    this.buildColorPanel();
    this.bindControls();
    this.bindKeys();

    var canvas = el('buehne');
    this.view = ZW.Cube3D.create(canvas, {
      onUserMove: function (moveIdx) { self.onManualMove(moveIdx); },
      onDragStart: function (slots) { self.view.highlight(slots); },
      onDragCancel: function () { self.refreshHighlight(); },
      onTurnDone: function () { self.afterTurn(); },
      getState: function () { return self.state; }   // die Ansicht prüft sich dagegen
    });
    if (!this.view) {
      el('banner').textContent = 'Diese Anzeige braucht WebGL. Der Würfel lässt sich ' +
        'nur über die Zug-Buttons und Tasten drehen.';
      el('banner').classList.remove('versteckt');
    } else {
      this.view.setColors(ZW.Scheme.get());
      global.addEventListener('resize', function () { self.view.resize(); });
    }

    this.updateCounters();
    this.say('Bereit. Ziehe mit der Maus über den Würfel oder benutze die Buttons und die ' +
      'Tasten U D L R F B.', 'Los geht’s');
    this.buildTables();
    return this;
  };

  App.prototype.cacheDom = function () {
    this.dom = {
      banner: el('banner'),
      phaseTitle: el('phasen-titel'),
      phaseText: el('phasen-text'),
      stepInfo: el('schritt-info'),
      scrambleLine: el('scramble'),
      progress: el('fortschritt'),
      progressText: el('fortschritt-text'),
      manual: el('zaehler-manuell'),
      solver: el('zaehler-loesung'),
      total: el('zaehler-gesamt'),
      auto: el('auto'),
      planInfo: el('plan-info')
    };
  };

  App.prototype.buildTables = function () {
    var self = this;
    var TP = ZW.TwoPhase;
    this.progress('Tabellen für den Löser werden vorbereitet …', 0);
    TP.buildBasic();
    TP.buildPermTables();
    this.tables.basic = true;
    TP.buildFull(
      function (name, pct) { self.progress('Tabellen (' + name + ') …', pct); },
      function () {
        self.tables.full = true;
        self.progress('', 0);
        self.say('Suche bereit. Würfel mischen und „Lösen“ drücken.', '');
      }
    );
  };

  /* --------------------------------------------------------- Texte & Zähler */

  App.prototype.say = function (text, title) {
    this.dom.phaseTitle.textContent = title || '';
    this.dom.phaseText.textContent = text || '';
  };
  App.prototype.progress = function (text, pct) {
    this.dom.progressText.textContent = text || '';
    this.dom.progress.style.width = (pct || 0) + '%';
    this.dom.progress.style.opacity = text ? '1' : '0';
  };
  App.prototype.updateCounters = function () {
    this.dom.manual.textContent = this.counts.manual;
    this.dom.solver.textContent = this.counts.solver;
    this.dom.total.textContent = this.counts.total;
  };

  /* ---------------------------------------------------------- Zug ausführen */

  /** Zug wirklich ausführen: Zustand, Zähler, Animation. */
  App.prototype.commit = function (moveIdx, kind, duration) {
    C.applyMoveIdx(this.state, moveIdx);
    if (kind === 'manual') { this.counts.manual++; this.counts.total++; }
    else if (kind === 'solver') { this.counts.solver++; this.counts.total++; }
    this.updateCounters();
    if (this.view) this.view.applyMove(moveIdx, { duration: duration });
  };

  App.prototype.onManualMove = function (moveIdx) {
    // Die Maus-Drehung wird gerade schon animiert, also nur Zustand und Zähler.
    C.applyMoveIdx(this.state, moveIdx);
    this.counts.manual++;
    this.counts.total++;
    this.lastManual = { move: moveIdx, at: Date.now() };
    this.updateCounters();
    if (this.plan) this.dropPlan('Die Lösung ist verworfen, weil du selbst weitergedreht hast.');
    this.refreshHighlight();
  };

  /** Tastatur/Buttons: Zug ausführen und animieren. */
  App.prototype.playMove = function (moveIdx) {
    if (this.blockedByDrag()) return;
    if (this.plan) this.dropPlan('Die Lösung ist verworfen, weil du selbst weitergedreht hast.');
    this.lastManual = { move: moveIdx, at: Date.now() };
    this.commit(moveIdx, 'manual', this.turnTime(210));
  };

  App.prototype.handleDouble = function () {
    var last = this.lastManual;
    if (!last || Date.now() - last.at > 1500) return false;
    var face = C.MOVE_FACE[last.move];
    if (C.MOVE_TURNS[last.move] === 2) return false;
    // zweite Vierteldrehung derselben Fläche ergänzt die letzte zum halben Zug
    var extra = C.moveIndex(C.FACES[face], 1);
    this.lastManual = { move: face * 3 + 1, at: Date.now() };
    this.commit(extra, 'merge', this.turnTime(180));
    return true;
  };

  App.prototype.turnTime = function (base) {
    return Math.max(50, Math.round(base / this.speed));
  };

  /* ------------------------------------------------------------- Mischen */

  App.prototype.scrambleCube = function () {
    this.dropPlan('');
    var res = ZW.Scramble.randomMoves(25);
    this.state = new C.State();
    ZW.Scramble.applyTo(this.state, res);
    this.counts = { manual: 0, solver: 0, total: 0 };
    this.updateCounters();
    this.scramble = res.names.join(' ');
    this.dom.scrambleLine.textContent = this.scramble;
    this.say('Gewürfelt. Drücke „Lösen“, um in Schritten zur Lösung zu kommen.', 'Gemischt');
    if (this.view) {
      // Die Steine der Anzeige müssen den Mischzug nacherleben.
      this.view.flush();
      this.view.highlight([]);
      for (var i = 0; i < res.moves.length; i++) this.view.applyMove(res.moves[i], { duration: 70 });
    }
  };

  App.prototype.resetCube = function () {
    this.dropPlan('');
    this.state = new C.State();
    this.scramble = '';
    this.dom.scrambleLine.textContent = '—';
    this.counts = { manual: 0, solver: 0, total: 0 };
    this.updateCounters();
    if (this.view) {
      this.view.flush();
      this.view.rebuild();
    }
    this.say('Würfel zurückgesetzt.', 'Gelöst');
  };

  /* --------------------------------------------------------------- Lösen */

  App.prototype.solve = function () {
    if (!this.tables.full) {
      this.say('Die Suchtabellen sind noch nicht fertig. Einen Moment gedulden.', 'Arbeitet noch');
      return;
    }
    if (C.isSolved(this.state)) {
      this.say('Der Würfel ist bereits gelöst.', 'Fertig');
      return;
    }
    this.stopAuto();
    this.dom.planInfo.textContent = 'Lösung wird gesucht …';
    var steps = null, note = '';
    if (this.mode === 'lbl') {
      var res = ZW.SolverLBL.solve(this.state, {});
      if (!res.ok) {
        this.dom.planInfo.textContent = '';
        this.say(res.error || 'Für diesen Würfel wurde keine Lösung gefunden.', 'Fehler');
        return;
      }
      steps = res.steps;
    } else {
      var two = ZW.TwoPhase.solve(this.state, { timeLimit: 5000 });
      if (!two) {
        var fb = ZW.SolverLBL.solve(this.state, {});
        note = 'Die Kurzsuche hat keine Lösung geschafft — es zeigt die Anfängermethode.';
        if (!fb.ok) { this.say('Für diesen Würfel wurde keine Lösung gefunden.', 'Fehler'); return; }
        steps = fb.steps;
      } else {
        steps = profiSteps(two);
      }
    }
    this.plan = { steps: steps, pos: 0, note: note };
    this.dom.planInfo.textContent = 'Lösung: ' + this.countMoves(steps) + ' Züge · Schritt 0';
    this.say(this.introText(steps), 'Los geht’s');
    this.refreshHighlight();
  };

  function profiSteps(two) {
    var out = [];
    for (var i = 0; i < two.moves.length; i++) {
      var idx = two.moves[i];
      out.push({
        move: C.MOVE_NAMES[idx],
        title: i < two.phase1 ? 'Phase 1 · Kreuz und Mittelebene' : 'Phase 2 · Obere Ebene',
        text: i === 0
          ? 'Kurze Lösung in zwei Phasen: zuerst ' + two.phase1 +
            ' Züge, dann ' + (two.moves.length - two.phase1) + ' Züge für die obere Ebene.'
          : '',
        phase: i < two.phase1 ? 1 : 2
      });
    }
    return out;
  }

  App.prototype.countMoves = function (steps) {
    var n = 0;
    for (var i = 0; i < steps.length; i++) if (steps[i].move) n++;
    return n;
  };
  App.prototype.introText = function (steps) {
    var first = '';
    for (var i = 0; i < steps.length; i++) {
      if (steps[i].text) { first = steps[i].text; break; }
    }
    return (this.plan && this.plan.note ? this.plan.note + ' ' : '') + first;
  };

  App.prototype.dropPlan = function (message) {
    if (!this.plan) return;
    this.stopAuto();
    this.plan = null;
    this.dom.planInfo.textContent = '';
    if (message) this.say(message, 'Abgebrochen');
    this.dom.stepInfo.textContent = '';
    this.refreshHighlight();
  };

  /* ------------------------------------------------------------ Wiedergabe */

  App.prototype.stepIndex = function () { return this.plan ? this.plan.pos : 0; };

  App.prototype.nextStep = function () {
    if (!this.plan) return;
    if (this.view && this.view.busy()) {
      // Die Maus dreht gerade, oder eine Animation läuft noch: lieber kurz
      // warten, sonst spielen Modell und Ansicht die Züge in verschiedener
      // Reihenfolge und es steht etwas anderes da, als die Zähler melden.
      var self = this;
      this.waitWaits = (this.waitWaits || 0) + 1;
      if (this.waitWaits > 30) {
        this.waitWaits = 0;
        this.stopAuto();
        this.say('Auto-Play pausiert. Drehe fertig oder drücke noch einmal Auto-Play.', 'Pause');
        return;
      }
      global.setTimeout(function () { self.nextStep(); }, 100);
      return;
    }
    this.waitWaits = 0;
    var steps = this.plan.steps;
    while (this.plan.pos < steps.length && !steps[this.plan.pos].move) {
      // nur Informationstexte: anzeigen und weiterschieben
      this.say(steps[this.plan.pos].text, steps[this.plan.pos].title || 'Hinweis');
      this.plan.pos++;
    }
    if (this.plan.pos >= steps.length) {
      this.stopAuto();
      this.dom.stepInfo.textContent = 'Fertig';
      this.say('Der Würfel ist gelöst. Gut gemacht!', 'Geschafft');
      this.refreshHighlight();
      return;
    }
    var step = steps[this.plan.pos];
    this.showStep(step);
    this.commit(C.moveIndexOf(step.move), 'solver', this.turnTime(230));
    this.plan.pos++;
    this.reportProgress();
    // Ende sofort erkennen: sonst bleibt die Markierung des letzten Steins stehen
    if (this.plan.pos >= steps.length) {
      this.stopAuto();
      this.dom.stepInfo.textContent = 'Fertig';
      this.say('Der Würfel ist gelöst. Gut gemacht!', 'Geschafft');
      this.refreshHighlight();
    }
  };

  /** Eine laufende Maus-Drehung blockiert andere Züge: die Reihenfolge muss stimmen. */
  App.prototype.blockedByDrag = function () {
    if (this.view && this.view.dragging()) {
      this.say('Lass die Maus-Drehung fertig werden, dann geht es weiter.', 'Einen Moment');
      return true;
    }
    return false;
  };

  App.prototype.prevStep = function () {
    if (!this.plan || this.blockedByDrag()) return;
    this.stopAuto();
    var i = this.plan.pos - 1;
    while (i >= 0 && !this.plan.steps[i].move) i--;
    if (i < 0) return;
    var step = this.plan.steps[i];
    var inv = inverseOf(C.moveIndexOf(step.move));
    this.commit(inv, 'back', this.turnTime(200));
    this.counts.solver--;
    this.counts.total--;
    this.updateCounters();
    this.plan.pos = i;
    var shown = this.plan.steps[i - 1] || this.plan.steps[i];
    this.showStep(shown);
    this.reportProgress();
  };

  App.prototype.showStep = function (step) {
    if (step.text) this.say(step.text, step.title || '');
    this.dom.stepInfo.textContent = 'Zug ' + (this.plan.pos + 1) + ': ' + step.move;
    if (this.view) this.view.highlight(this.slotsFor(step));
  };

  App.prototype.reportProgress = function () {
    var total = this.countMoves(this.plan.steps), done = 0;
    for (var i = 0; i < this.plan.pos; i++) if (this.plan.steps[i].move) done++;
    this.dom.planInfo.textContent = 'Lösung: ' + total + ' Züge · Schritt ' + done + '/' + total;
  };

  App.prototype.runAll = function () {
    if (!this.plan) return;
    this.auto = true;
    this.dom.auto.textContent = 'Pause';
    this.nextStep();
  };

  App.prototype.stopAuto = function () {
    this.auto = false;
    this.dom.auto.textContent = 'Auto-Play';
  };
  App.prototype.toggleAuto = function () {
    if (!this.plan) { this.solve(); if (!this.plan) return; }
    if (this.auto) this.stopAuto();
    else this.runAll();
  };

  /** Wird nach jeder beendeten Animation aufgerufen. */
  App.prototype.afterTurn = function () {
    if (this.auto && this.plan) {
      var self = this;
      global.setTimeout(function () { self.nextStep(); }, 40 / this.speed);
    }
  };

  /* ------------------------------------------------------- Hervorhebungen */

  /** Steine, die zu einem Schritt gehören, in Würfelkoordinaten. */
  App.prototype.slotsFor = function (step) {
    if (!this.view) return [];
    if (step.kind === 'corner') return this.cornerSlots(step.id);
    if (step.kind === 'edge') return this.edgeSlots(step.id);
    if (step.phase === 6) return this.topSlots();
    return [];
  };
  App.prototype.cornerSlots = function (id) {
    for (var p = 0; p < 8; p++) {
      if (this.state.cp[p] === id) return [C.CORNER_COORD[p]];
    }
    return [];
  };
  App.prototype.edgeSlots = function (id) {
    for (var p = 0; p < 12; p++) {
      if (this.state.ep[p] === id) return [C.EDGE_COORD[p]];
    }
    return [];
  };
  App.prototype.topSlots = function () {
    var out = [];
    for (var c = 0; c < 4; c++) out.push(C.CORNER_COORD[c]);
    for (var e = 0; e < 4; e++) out.push(C.EDGE_COORD[e]);
    return out;
  };
  App.prototype.refreshHighlight = function () {
    if (this.view) this.view.highlight([]);
  };

  /* --------------------------------------------------------- Steuerung UI */

  App.prototype.buildMoveButtons = function () {
    var self = this;
    var wrap = el('zug-buttons');
    for (var f = 0; f < 6; f++) {
      var letter = C.FACES[f];
      var group = document.createElement('div');
      group.className = 'zug-gruppe';
      var head = document.createElement('span');
      head.className = 'zug-flaeche';
      head.textContent = letter + ' · ' + C.FACE_DE[letter];
      group.appendChild(head);
      var row = document.createElement('div');
      row.className = 'zug-zeile';
      for (var t = 0; t < 3; t++) {
        var idx = f * 3 + t;
        var b = document.createElement('button');
        b.className = 'zug';
        b.textContent = C.MOVE_NAMES[idx];
        b.dataset.move = idx;
        b.addEventListener('click', (function (i) {
          return function () { self.playMove(i); };
        })(idx));
        row.appendChild(b);
      }
      group.appendChild(row);
      wrap.appendChild(group);
    }
  };

  App.prototype.bindControls = function () {
    var self = this;
    el('mischen').addEventListener('click', function () { self.scrambleCube(); });
    el('loesen').addEventListener('click', function () { self.solve(); });
    el('zuruecksetzen').addEventListener('click', function () { self.resetCube(); });
    el('auto').addEventListener('click', function () { self.toggleAuto(); });
    el('schritt-vorwaerts').addEventListener('click', function () { self.nextStep(); });
    el('schritt-rueckwaerts').addEventListener('click', function () { self.prevStep(); });
    el('geschwindigkeit').addEventListener('change', function (ev) {
      self.speed = parseFloat(ev.target.value) || 1;
    });
    var modes = document.querySelectorAll('[data-modus]');
    for (var i = 0; i < modes.length; i++) {
      modes[i].addEventListener('click', function (ev) {
        var mode = ev.currentTarget.getAttribute('data-modus');
        self.setMode(mode);
      });
    }
  };

  App.prototype.setMode = function (mode) {
    this.mode = mode;
    this.dropPlan('');
    var buttons = document.querySelectorAll('[data-modus]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('an', buttons[i].getAttribute('data-modus') === mode);
    }
    this.say(mode === 'lbl'
      ? 'Anfängermethode: Der Würfel wird Stein für Stein gelöst, jede Gruppe bekommt eine Erklärung.'
      : 'Profi: Kurze Lösung mit der Zwei-Phasen-Suche, ohne Erklärtext.',
      mode === 'lbl' ? 'Modus Lernen' : 'Modus Profi');
  };

  App.prototype.bindKeys = function () {
    var self = this;
    document.addEventListener('keydown', function (ev) {
      if (ev.target && /input|select|textarea/i.test(ev.target.tagName)) return;
      if (ev.key === ' ') { self.toggleAuto(); ev.preventDefault(); return; }
      if (ev.key === 'ArrowRight') { self.nextStep(); return; }
      if (ev.key === 'ArrowLeft') { self.prevStep(); return; }
      if (ev.key === '2' && self.handleDouble()) { ev.preventDefault(); return; }
      var face = C.FACE_INDEX[ev.key.toUpperCase()];
      if (face === undefined) return;
      var turns = ev.shiftKey ? 3 : 1;
      self.playMove(face * 3 + (turns - 1));
      ev.preventDefault();
    });
  };

  /* ---------------------------------------------------------- Farbschema */

  App.prototype.buildColorPanel = function () {
    var self = this;
    var wrap = el('flaechen-farben');
    var colors = ZW.Scheme.get();
    this.colorInputs = [];
    for (var f = 0; f < 6; f++) {
      var row = document.createElement('label');
      row.className = 'farbe';
      var caption = document.createElement('span');
      caption.textContent = C.FACES[f] + ' ' + faceWord(f);
      var input = document.createElement('input');
      input.type = 'color';
      input.value = colors[f];
      input.dataset.face = f;
      input.addEventListener('input', function () { self.applyColors(); });
      row.appendChild(caption);
      row.appendChild(input);
      wrap.appendChild(row);
      this.colorInputs.push(input);
    }
    var preset = el('farb-voreinstellung');
    for (var key in ZW.Scheme.PRESETS) {
      var opt = document.createElement('option');
      opt.value = key;
      opt.textContent = key;
      preset.appendChild(opt);
    }
    preset.addEventListener('change', function () {
      var list = ZW.Scheme.PRESETS[preset.value];
      for (var i = 0; i < 6; i++) self.colorInputs[i].value = list[i];
      self.applyColors();
    });
    this.updateColorNames();
  };

  function faceWord(face) {
    var w = C.FACE_DE[C.FACES[face]];
    return w.charAt(0).toUpperCase() + w.slice(1);
  }

  App.prototype.applyColors = function () {
    var list = [];
    for (var i = 0; i < 6; i++) list.push(this.colorInputs[i].value);
    ZW.Scheme.set(list);
    if (this.view) this.view.setColors(list);
    this.updateColorNames();
  };

  App.prototype.updateColorNames = function () {
    var names = ZW.Scheme.names();
    var out = [];
    for (var f = 0; f < 6; f++) out.push(C.FACE_DE[C.FACES[f]] + ' ' + names[f]);
    el('farben-namen').textContent = out.join(' · ');
  };

  ZW.App = App;
})(typeof window !== 'undefined' ? window : this);
