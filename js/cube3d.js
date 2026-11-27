/*
 * cube3d.js — Three.js-Ansicht des Würfels mit Drehung per Maus.
 *
 * Die Ansicht ist nur die Darstellung: Der wahre Zustand bleibt der
 * ZW.Cube.State in der App. Diese Datei kennt also weder Lese- noch
 * Lösungslogik, sondern dreht sichtbare Steine und meldet fertige Züge.
 *
 * Bedienung:
 *   · Ziehen auf einem Stein  → Ebene folgt der Maus, Snap ab 45°
 *   · Ziehen auf dem Hintergrund → Ansicht drehen
 *   · Mausrad / Pinch         → zoomen
 */
(function (global) {
  'use strict';
  var ZW = (global.ZW = global.ZW || {});
  var C = ZW.Cube;

  var BOX = 0.94;          // Kantenlänge eines Steins (1 = ohne Lücke)
  var STICKER = 0.80;      // Größe des farbigen Aufklebers
  var SNAP = Math.PI / 4;  // ab hier wird der Zug übernommen
  var MAX_DRAG = Math.PI / 2;

  function vec3(n) { return new THREE.Vector3(n.x, n.y, n.z); }
  function roundAxisVector(v) {
    var ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
    if (ax >= ay && ax >= az) return new THREE.Vector3(Math.sign(v.x) || 1, 0, 0);
    if (ay >= az) return new THREE.Vector3(0, Math.sign(v.y) || 1, 0);
    return new THREE.Vector3(0, 0, Math.sign(v.z) || 1);
  }
  function faceOfNormal(v) {
    for (var f = 0; f < 6; f++) {
      var d = v.x * C.NORMAL[f].x + v.y * C.NORMAL[f].y + v.z * C.NORMAL[f].z;
      if (d > 0.9) return f;
    }
    return -1;
  }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /* ------------------------------------------------------------- Aufbau */

  function Cube3D(canvas, handlers) {
    this.canvas = canvas;
    this.handlers = handlers || {};
    this.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, global.devicePixelRatio || 1));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#141821');
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    // Etwas von oben schauen: so wirken die Steine würfelig und nicht flach.
    this.orbit = { theta: 0.72, phi: 1.08, radius: 8, zoomed: false };

    // Die Flächen sollen dicht an ihren Farbwerten bleiben: Lichtsumme um 1,
    // damit Gelb nicht ausfrisst und die Schattenseite noch zu sehen ist.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    var key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 5, 6);
    this.scene.add(key);
    var fill = new THREE.DirectionalLight(0xffffff, 0.9);
    fill.position.set(-4, -3, -5);
    this.scene.add(fill);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.boxGeo = new THREE.BoxGeometry(BOX, BOX, BOX);
    this.stickerGeo = new THREE.PlaneGeometry(STICKER, STICKER);
    this.cubies = [];
    this.boxes = [];
    this.colors = C.COLOR_HEX.slice();
    this.buildCubies();

    this.pivot = new THREE.Group();
    this.root.add(this.pivot);

    this.queue = [];
    this.turn = null;
    this.drag = null;
    this.orbitDrag = null;
    this.highlighted = [];
    this.disposed = false;
    // Zähler für ausgeführte Drehungen: nach jeder fertigsten Drehung wird die
    // Ansicht einmal mit dem Modell verglichen (see step()).
    this.serial = 0;
    this.checkedSerial = -1;

    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.bindEvents();
    this.observeLayout();
    this.resize();
    var self = this;
    this.frame = function () {
      if (self.disposed) return;
      self.step();
      requestAnimationFrame(self.frame);
    };
    requestAnimationFrame(this.frame);
  }

  Cube3D.prototype.buildCubies = function () {
    var up = new THREE.Vector3(0, 0, 1);
    for (var x = -1; x <= 1; x++) {
      for (var y = -1; y <= 1; y++) {
        for (var z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue;
          var group = new THREE.Group();
          group.position.set(x, y, z);
          var bodyMat = new THREE.MeshLambertMaterial({ color: 0x14161c });
          var box = new THREE.Mesh(this.boxGeo, bodyMat);
          group.add(box);
          var cubie = {
            group: group, box: box, bodyMat: bodyMat,
            stickers: [], x: x, y: y, z: z, bx: x, by: y, bz: z
          };
          box.userData.cubie = cubie;
          for (var f = 0; f < 6; f++) {
            var n = C.NORMAL[f];
            if (x * n.x + y * n.y + z * n.z !== 1) continue;
            var mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
            var mesh = new THREE.Mesh(this.stickerGeo, mat);
            mesh.position.set(n.x * (BOX / 2 + 0.006), n.y * (BOX / 2 + 0.006), n.z * (BOX / 2 + 0.006));
            mesh.quaternion.setFromUnitVectors(up, vec3(n));
            group.add(mesh);
            cubie.stickers.push({ mat: mat, normal: vec3(n) });
          }
          this.root.add(group);
          this.cubies.push(cubie);
          this.boxes.push(box);
        }
      }
    }
    this.applyColors();
  };

  /** Farben der sechs Flächen setzen (Reihenfolge U R F D L B). */
  Cube3D.prototype.setColors = function (hexList) {
    this.colors = hexList.slice();
    this.applyColors();
  };
  Cube3D.prototype.applyColors = function () {
    var q = new THREE.Quaternion();
    for (var i = 0; i < this.cubies.length; i++) {
      var cubie = this.cubies[i];
      cubie.group.getWorldQuaternion(q);
      for (var s = 0; s < cubie.stickers.length; s++) {
        var n = cubie.stickers[s].normal.clone().applyQuaternion(q);
        var f = faceOfNormal(roundAxisVector(n));
        cubie.stickers[s].mat.color.set(f >= 0 ? this.colors[f] : '#808080');
      }
    }
  };

  /** Steine hervorheben; list = [{x,y,z}, …] in Würfelkoordinaten. */
  Cube3D.prototype.highlight = function (list) {
    var wanted = Object.create(null);
    for (var i = 0; i < (list || []).length; i++) {
      wanted[list[i].x + ',' + list[i].y + ',' + list[i].z] = true;
    }
    for (var c = 0; c < this.cubies.length; c++) {
      var cubie = this.cubies[c];
      var on = !!wanted[cubie.x + ',' + cubie.y + ',' + cubie.z];
      cubie.bodyMat.emissive.set(on ? 0x2a6cff : 0x000000);
      for (var s = 0; s < cubie.stickers.length; s++) {
        cubie.stickers[s].mat.emissive.set(on ? 0x123f80 : 0x000000);
      }
    }
    this.highlighted = list || [];
  };

  /* ------------------------------------------------------- Ebenen & Züge */

  Cube3D.prototype.layerOf = function (axis, value) {
    var out = [];
    for (var i = 0; i < this.cubies.length; i++) {
      var c = this.cubies[i];
      if (Math.round(c.x * axis.x + c.y * axis.y + c.z * axis.z) === value) out.push(c);
    }
    return out;
  };

  /* Alle Steine, die noch im Dreh-Punkt hängen, wieder einhängen. */
  Cube3D.prototype.clearPivot = function () {
    var kinder = this.pivot.children;
    for (var i = kinder.length - 1; i >= 0; i--) this.root.attach(kinder[i]);
    this.pivot.quaternion.identity();
    this.activeLayer = null;
    this.activeAxis = null;
  };

  /** Zug animieren (Zustand hat die App schon geändert). */
  Cube3D.prototype.applyMove = function (moveIdx, opts) {
    opts = opts || {};
    this.queue.push({ move: moveIdx, duration: opts.duration || 220 });
    return this;
  };
  Cube3D.prototype.busy = function () {
    // Auch eine laufende Maus-Drehung blockiert: sonst würfen sich Modell und
    // Ansicht in eine andere Zugreihenfolge.
    return !!(this.turn || this.queue.length || this.drag || this.activeLayer);
  };
  /** Läuft gerade eine Drehung per Maus? */
  Cube3D.prototype.dragging = function () { return !!this.drag; };
  Cube3D.prototype.flush = function () {
    this.queue.length = 0;
    this.turn = null;
    this.drag = null;
    this.clearPivot();
    this.serial++;                 // Ansicht muss wieder mit dem Modell verglichen werden
  };

  Cube3D.prototype.startTurn = function (item) {
    var face = C.MOVE_FACE[item.move];
    var axis = vec3(C.NORMAL[face]);
    var list = this.layerOf(axis, 1);
    var target = C.MOVE_ANGLE[item.move];
    this.beginPivot(axis, list);
    this.turn = {
      axis: axis, target: target, from: 0, move: item.move,
      t0: performance.now(), duration: item.duration, list: list, animated: true
    };
    this.setPivotAngle(0);
  };

  Cube3D.prototype.beginPivot = function (axis, list) {
    this.clearPivot();                 // nichts von einer früheren Drehung hängen lassen
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.quaternion.identity();
    this.activeAxis = axis;
    this.activeLayer = list;
    for (var i = 0; i < list.length; i++) this.pivot.attach(list[i].group);
  };
  Cube3D.prototype.setPivotAngle = function (angle) {
    if (this.activeAxis) this.pivot.quaternion.setFromAxisAngle(this.activeAxis, angle);
  };
  Cube3D.prototype.endPivot = function () {
    // Steine zurückhängen, Koordinaten und Drehungen wieder exakt machen
    var liste = this.activeLayer || [];
    for (var i = 0; i < liste.length; i++) this.root.attach(liste[i].group);
    this.clearPivot();
    var m = new THREE.Matrix4();
    for (var j = 0; j < this.cubies.length; j++) {
      var cubie = this.cubies[j];
      var p = cubie.group.position;
      cubie.x = Math.round(p.x); cubie.y = Math.round(p.y); cubie.z = Math.round(p.z);
      cubie.group.position.set(cubie.x, cubie.y, cubie.z);
      m.makeRotationFromQuaternion(cubie.group.quaternion);
      for (var k = 0; k < 16; k++) m.elements[k] = Math.round(m.elements[k]);
      cubie.group.quaternion.setFromRotationMatrix(m);
    }
    this.serial++;
  };

  /* --------------------------------------------------------- Ereignisse */

  Cube3D.prototype.pointerNdc = function (ev) {
    var rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1,
                 -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    return this.ndc;
  };
  Cube3D.prototype.pick = function (ev) {
    this.ray.setFromCamera(this.pointerNdc(ev), this.camera);
    var hits = this.ray.intersectObjects(this.boxes, false);
    if (!hits.length) return null;
    var hit = hits[0];
    var q = new THREE.Quaternion();
    hit.object.getWorldQuaternion(q);
    var normal = roundAxisVector(hit.face.normal.clone().applyQuaternion(q));
    return { cubie: hit.object.userData.cubie, normal: normal, point: hit.point.clone() };
  };
  Cube3D.prototype.rayFrom = function (ev) {
    this.ray.setFromCamera(this.pointerNdc(ev), this.camera);
    return this.ray.ray;
  };

  Cube3D.prototype.bindEvents = function () {
    var self = this;
    var canvas = this.canvas;

    canvas.addEventListener('pointerdown', function (ev) {
      if (self.disposed) return;
      canvas.setPointerCapture(ev.pointerId);
      var hit = self.pick(ev);
      if (hit && !self.busy()) {
        self.drag = {
          cubie: hit.cubie, normal: hit.normal, point: hit.point,
          axis: null, angle: 0, pivot: null, list: null
        };
      } else {
        self.orbitDrag = { x: ev.clientX, y: ev.clientY, theta: self.orbit.theta, phi: self.orbit.phi };
      }
      ev.preventDefault();
    });

    canvas.addEventListener('pointermove', function (ev) {
      if (self.disposed) return;
      if (self.drag) { self.updateDrag(ev); return; }
      if (self.orbitDrag) {
        var dx = ev.clientX - self.orbitDrag.x, dy = ev.clientY - self.orbitDrag.y;
        self.orbit.theta = self.orbitDrag.theta - dx * 0.008;
        self.orbit.phi = Math.min(Math.PI - 0.15, Math.max(0.15, self.orbitDrag.phi - dy * 0.008));
        self.updateCamera();
      }
    });

    function finish(ev) {
      if (self.canvas.hasPointerCapture(ev.pointerId)) self.canvas.releasePointerCapture(ev.pointerId);
      // Eine Maus-Drehung beenden wir immer, auch wenn die Gefangennahme weg ist.
      if (self.drag) self.endDrag();
      self.orbitDrag = null;
    }
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('lostpointercapture', finish);

    canvas.addEventListener('wheel', function (ev) {
      self.orbit.radius = Math.min(20, Math.max(4, self.orbit.radius + ev.deltaY * 0.01));
      self.orbit.zoomed = true;          // eigene Wahl behalten, auch beim Umskalieren
      self.updateCamera();
      ev.preventDefault();
    }, { passive: false });
  };

  /**
   * Achse und Ebene für eine Maus-Drehung.
   * Die gezogene Fläche bewegt sich mit der Maus; die Drehachse steht deshalb
   * senkrecht auf Zugrichtung und Flächennormaler.
   * @returns {axis, value, along} oder null (Mittelschicht hat keinen Zug)
   */
  Cube3D.prototype.turnAxisFor = function (normal, cubie, delta) {
    var best = null;
    for (var f = 0; f < 6; f++) {
      var b = vec3(C.NORMAL[f]);
      if (Math.abs(b.dot(normal)) > 0.5) continue;        // nicht die Flächennormale
      var along = b.dot(delta);
      if (Math.abs(along) < 0.02) continue;
      if (along < 0) { along = -along; b.negate(); }
      var axis = new THREE.Vector3().copy(normal).cross(b);
      var value = cubie.x * axis.x + cubie.y * axis.y + cubie.z * axis.z;
      if (value === 0) continue;                          // Mittelschicht: kein Zug
      if (!best || along > best.along) {
        best = { axis: axis, value: value > 0 ? 1 : -1, along: along };
      }
    }
    return best;
  };

  /** Zug-Index für die gewählte Achse und den Zielwinkel (in Achsenrichtung). */
  Cube3D.prototype.moveForTurn = function (chosen, angle) {
    var face = chosen.value > 0
      ? faceOfNormal(chosen.axis)
      : faceOfNormal(chosen.axis.clone().negate());
    // Winkel gilt für die Achse; die Flächenbezugsnormale zeigt ggf. entgegen
    var turns = angle * chosen.value < 0 ? 1 : 3;
    return face * 3 + (turns - 1);
  };

  Cube3D.prototype.updateDrag = function (ev) {
    var d = this.drag;
    var ray = this.rayFrom(ev);
    var denom = d.normal.dot(ray.direction);
    if (Math.abs(denom) < 1e-6) return;
    var t = d.normal.dot(new THREE.Vector3().copy(d.point).sub(ray.origin)) / denom;
    if (t < 0) return;
    var p = ray.origin.clone().addScaledVector(ray.direction, t);
    var delta = p.clone().sub(d.point);
    if (delta.lengthSq() < 0.0016) return;

    if (!d.axis) {
      var chosen = this.turnAxisFor(d.normal, d.cubie, delta);
      if (!chosen) {
        // Für diesen Stein gibt es keinen Zug: weiterziehen orbitiert die Ansicht.
        this.drag = null;
        this.orbitDrag = { x: ev.clientX, y: ev.clientY, theta: this.orbit.theta, phi: this.orbit.phi };
        return;
      }
      d.axis = chosen.axis;
      d.value = chosen.value;
      d.list = this.layerOf(chosen.axis, chosen.value);
      this.beginPivot(chosen.axis, d.list);
      d.pivot = this.pivot;
      if (this.handlers.onDragStart) {
        this.handlers.onDragStart(d.list.map(function (c) { return { x: c.x, y: c.y, z: c.z }; }));
      }
    }

    // Weg der gezogenen Flächenmitte bei positiver Drehung
    var tangent = new THREE.Vector3().copy(d.axis).cross(d.normal).normalize();
    var along = delta.dot(tangent);
    d.angle = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, along));
    this.setPivotAngle(d.angle);
  };

  Cube3D.prototype.endDrag = function () {
    var d = this.drag;
    this.drag = null;
    if (!d || !d.pivot) {
      if (this.handlers.onDragCancel) this.handlers.onDragCancel();
      return;
    }
    var commit = Math.abs(d.angle) >= SNAP;
    var target = commit ? (d.angle > 0 ? Math.PI / 2 : -Math.PI / 2) : 0;
    this.turn = {
      axis: d.axis, target: target, from: d.angle, move: -1,
      t0: performance.now(), duration: commit ? 120 : 160, list: d.list, animated: true
    };
    if (!commit) {
      if (this.handlers.onDragCancel) this.handlers.onDragCancel();
      return;
    }
    var moveIdx = this.moveForTurn({ axis: d.axis, value: d.value }, d.angle);
    this.turn.move = moveIdx;
    if (this.handlers.onUserMove) this.handlers.onUserMove(moveIdx);
  };

  /* --------------------------------------------------------- Animation */

  Cube3D.prototype.step = function () {
    // Während einer Maus-Drehung nichts aus der Warteschlange starten, sonst
    // streiten sich Drag und Zug um dieselben Steine.
    if (!this.turn && !this.activeLayer && this.queue.length) this.startTurn(this.queue.shift());
    if (this.turn) {
      var t = this.turn;
      var k = Math.min(1, (performance.now() - t.t0) / Math.max(1, t.duration));
      var angle = t.from + (t.target - t.from) * easeInOut(k);
      this.activeAxis = t.axis;
      this.setPivotAngle(angle);
      if (k >= 1) {
        this.setPivotAngle(t.target);
        this.endPivot();
        this.turn = null;
        if (this.handlers.onTurnDone) this.handlers.onTurnDone(t.move);
      }
    } else if (this.handlers.getState && this.checkedSerial !== this.serial) {
      // Sobald nichts mehr läuft: Ansicht mit dem Modell vergleichen und
      // notfalls zurücksetzen. Sonst steht am Ende eine andere Stellung da,
      // als Modell und Zähler melden.
      this.checkedSerial = this.serial;
      var zustand = this.handlers.getState();
      if (zustand && !this.inSyncWith(zustand)) this.syncToState(zustand);
    }
    this.renderer.render(this.scene, this.camera);
  };

  Cube3D.prototype.updateCamera = function () {
    var o = this.orbit;
    this.camera.position.set(
      o.radius * Math.sin(o.phi) * Math.sin(o.theta),
      o.radius * Math.cos(o.phi),
      o.radius * Math.sin(o.phi) * Math.cos(o.theta)
    );
    this.camera.lookAt(0, 0, 0);
  };

  /** Auf Größenänderungen der Leinwand reagieren (Fenster, Panel, Umbruch). */
  Cube3D.prototype.observeLayout = function () {
    if (!global.ResizeObserver) return;
    var self = this;
    this.resizeObserver = new ResizeObserver(function () {
      if (!self.disposed) self.resize();
    });
    this.resizeObserver.observe(this.canvas.parentElement);
  };

  /** Größte Ausdehnung des Würfels im Bild (in normalisierten Gerätekoordinaten). */
  Cube3D.prototype.extentNdc = function () {
    var v = new THREE.Vector3(), lim = 1.55;          // Ecken des fertigen Würfels
    var span = 0;
    var ecken = [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1],[-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1]];
    var minx = 9, maxx = -9, miny = 9, maxy = -9;
    for (var i = 0; i < ecken.length; i++) {
      v.set(ecken[i][0] * lim, ecken[i][1] * lim, ecken[i][2] * lim).project(this.camera);
      if (v.x < minx) minx = v.x;
      if (v.x > maxx) maxx = v.x;
      if (v.y < miny) miny = v.y;
      if (v.y > maxy) maxy = v.y;
    }
    return Math.max(maxx - minx, maxy - miny);
  };

  /** Abstand so wählen, dass der Würfel das Bild gut ausfüllt. */
  Cube3D.prototype.fitCamera = function () {
    var füllung = 0.88;                       // Anteil der kürzeren Bildseite
    for (var versuch = 0; versuch < 4; versuch++) {
      this.updateCamera();
      var span = this.extentNdc();
      if (span <= 0) break;
      var ziel = 2 * füllung;
      this.orbit.radius = Math.min(24, Math.max(3.5, this.orbit.radius * span / ziel));
    }
    this.updateCamera();
  };

  Cube3D.prototype.resize = function () {
    // Größe des Layouts nehmen, nie die des Canvases: sonst regelt sich die
    // Bühnengröße über die eigene Pixelgröße hoch.
    var rect = this.canvas.getBoundingClientRect();
    var messen = rect.width > 4 && rect.height > 4 ? rect : this.canvas.parentElement.getBoundingClientRect();
    var w = Math.max(200, Math.round(messen.width));
    var h = Math.max(200, Math.round(messen.height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();   // ohne diesen Aufruf bleibt die Projektion quadratisch
    if (!this.orbit.zoomed) this.fitCamera();
    else this.updateCamera();
  };

  /** Ansicht wieder in den gelösten Aufbau versetzen (nach „Zurücksetzen“). */
  Cube3D.prototype.rebuild = function () {
    this.queue.length = 0;
    this.turn = null;
    this.drag = null;
    for (var i = 0; i < this.cubies.length; i++) {
      var cubie = this.cubies[i];
      this.root.attach(cubie.group);
      cubie.group.position.set(cubie.bx, cubie.by, cubie.bz);
      cubie.group.quaternion.identity();
      cubie.x = cubie.bx; cubie.y = cubie.by; cubie.z = cubie.bz;
    }
    this.highlight([]);
    this.applyColors();
    this.serial++;
  };

  /* ---------------------------------- Ansicht am Modell ausrichten */

  // Heim-Coordinate -> Stein-Nummer im Modell
  var CORNER_ID = Object.create(null), EDGE_ID = Object.create(null);
  for (var ci = 0; ci < 8; ci++) {
    var cc = C.CORNER_COORD[ci];
    CORNER_ID[cc.x + ',' + cc.y + ',' + cc.z] = ci;
  }
  for (var ei = 0; ei < 12; ei++) {
    var ec = C.EDGE_COORD[ei];
    EDGE_ID[ec.x + ',' + ec.y + ',' + ec.z] = ei;
  }

  function quaternionOf(rotIdx) {
    var M = C.ROTATIONS[rotIdx], m = new THREE.Matrix4();
    m.set(M.x.x, M.y.x, M.z.x, 0,
          M.x.y, M.y.y, M.z.y, 0,
          M.x.z, M.y.z, M.z.z, 0,
          0, 0, 0, 1);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  /** Ziel-Position und -Drehung jedes Steins, abgeleitet aus dem Modell. */
  Cube3D.prototype.targetsFrom = function (state) {
    var out = [];
    for (var i = 0; i < this.cubies.length; i++) {
      var cubie = this.cubies[i];
      var key = cubie.bx + ',' + cubie.by + ',' + cubie.bz;
      var id = CORNER_ID[key];
      if (id !== undefined) {
        var p = 0;
        while (p < 8 && state.cp[p] !== id) p++;
        if (p >= 8) return null;
        out.push({ cubie: cubie, coord: C.CORNER_COORD[p], rot: state.cr[p] });
        continue;
      }
      id = EDGE_ID[key];
      if (id === undefined) continue;                 // Flächenmitte ruht immer
      var q = 0;
      while (q < 12 && state.ep[q] !== id) q++;
      if (q >= 12) return null;
      out.push({ cubie: cubie, coord: C.EDGE_COORD[q], rot: state.er[q] });
    }
    return out;
  };

  /** Deckt sich die Ansicht mit dem Modell? */
  Cube3D.prototype.inSyncWith = function (state) {
    var ziele = this.targetsFrom(state);
    if (!ziele) return false;
    for (var i = 0; i < ziele.length; i++) {
      var z = ziele[i], c = z.cubie;
      if (c.x !== z.coord.x || c.y !== z.coord.y || c.z !== z.coord.z) return false;
      var p = c.group.position;
      if (Math.abs(p.x - z.coord.x) > 1e-3 || Math.abs(p.y - z.coord.y) > 1e-3 ||
          Math.abs(p.z - z.coord.z) > 1e-3) return false;
      if (c.group.quaternion.angleTo(quaternionOf(z.rot)) > 1e-3) return false;
    }
    return true;
  };

  /** Ansicht zwangsweise auf den Modellzustand setzen (Selbstheilung). */
  Cube3D.prototype.syncToState = function (state) {
    this.turn = null;
    this.drag = null;
    this.clearPivot();
    var ziele = this.targetsFrom(state);
    if (!ziele) return false;
    for (var i = 0; i < ziele.length; i++) {
      var z = ziele[i], c = z.cubie;
      c.group.position.set(z.coord.x, z.coord.y, z.coord.z);
      c.group.quaternion.copy(quaternionOf(z.rot));
      c.x = z.coord.x; c.y = z.coord.y; c.z = z.coord.z;
    }
    return true;
  };

  Cube3D.prototype.dispose = function () {
    this.disposed = true;
    if (this.resizeObserver) this.resizeObserver.disconnect();
  };

  /** Erzeugt die Ansicht oder meldet false, wenn WebGL nicht verfügbar ist. */
  function create(canvas, handlers) {
    if (!global.THREE) return false;
    try {
      var view = new Cube3D(canvas, handlers);
      view.updateCamera();
      view.step();        // sofort ein Bild zeigen, nicht erst nach dem ersten Frame
      return view;
    } catch (e) {
      if (global.T) T.info('create warf: ' + e.message);   // nur in Testseiten sichtbar
      return false;
    }
  }

  ZW.Cube3D = { create: create, SNAP: SNAP };
})(typeof window !== 'undefined' ? window : this);
