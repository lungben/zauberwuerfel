# Zauberwürfel · 3×3 im Browser

Ein echter 3D-Zauberwürfel (3×3) als HTML-Seite: drehen mit der Maus, mischen,
Zugzähler und ein Löser, der in Schritten erklärt, was passiert. Die Seite läuft
offline — einfach `index.html` per Doppelklick in Chrome oder Firefox öffnen.

## Start

```
index.html öffnen      # kein Server, kein Build, keine Installation nötig
```

Getestete Browser: aktuelle Versionen von Chrome und Firefox (`file://` ohne
Web Server, keine ES-Module, keine Web Workers).

## Bedienung

| Aktion | Weg |
| --- | --- |
| Ebene drehen | mit der Maus auf einem Stein ziehen (Snap ab 45°) |
| Ansicht drehen | auf dem Hintergrund ziehen, Zoom mit dem Mausrad |
| Züge per Taste | `U D L R F B`, mit `Shift` gegen den Uhrzeigersinn, danach `2` ergibt den halben Zug |
| Buttons | ausgeklappter Bereich „Züge per Button“ (alle 18 Züge) |
| Mischen | 25 Zufallszüge, Zähler bleiben bei 0 |
| Lösen | Schrittfolge planen, mit ◀ ▶ einzeln oder mit Auto-Play abspielen |
| Tempo | 0,5× bis 4× |
| Leertaste | Auto-Play starten/pausieren |
| ← → | ein Schritt zurück / weiter |

Dreht man selbst am Würfel, während eine Lösung gezeigt wird, wird die Lösung
verworfen — der Würfel hat sich ja geändert.

## Die beiden Löser

**Lernen** (Voreinstellung) arbeitet nach der Anfängermethode in sechs Phasen:

1. Kreuz unten
2. Ecken der unteren Ebene
3. Mittlere Ebene
4. Kreuz oben
5. Ecken der oberen Ebene drehen
6. Steine der oberen Ebene tauschen

Jede Phase beginnt mit einer Erklärung, jeder einzelne Zug bekommt einen Text
(„Sie liegt in der oberen Ebene an Position UR und ist verdreht. Zugfolge:
R U R' U' — das ist die rechte Palette.“). Die Zugfolgen entstehen aus einer
Suche, die über die Koordinaten der einzelnen Steine nachweislich schon fertige
Steine in Ruhe lässt. Phase 6 nutzt die Vertauschungssuche des Profi-Lösers.

**Profi** nutzt Kociembas Zwei-Phasen-Verfahren und liefert meist 20–26 Züge,
ohne Erklärtexte. Die Suchtabellen (ca. 4 MB `Uint8Array`) werden beim Start im
Hintergrund gebaut, die Fortschrittsanzeige zeigt den Stand. Die Tabellen bleiben
im Speicher, weitere Lösungen brauchen nur einige Hundert Millisekunden.

Beide Löser geben nur Zugfolgen plus Texte aus; die Wiedergabe (Schritte,
Auto-Play, Tempo, Hervorhebung) ist für beide gleich.

## Farben des eigenen Würfels einstellen

Der Würfel in der App muss nicht das Standardschema haben. Unter **„Farben
meiner Flächen“** bekommt jede der sechs Flächen ihre Farbe (fünf
Voreinstellungen oder frei gewählt). Die Auswahl wird im Browser gespeichert und
die Erklärtexte verwenden die zugehörigen Farbnamen — aus „Ecke gelb/orange/grün“
wird „Ecke weiß/grün/rot“, wenn die Flächen entsprechend gefärbt sind.

Die Logik arbeitet ausschließlich mit Flächen-Indizes (`U R F D L B`), die Farbe
ist reine Anzeige. Drehungen, Suche und Zähler sind davon unabhängig.

## Architektur

```
index.html            Aufbau der Seite
css/styles.css        dunkles, responsives Layout
vendor/three.min.js   Three.js r158 (UMD, lokal)
js/cube-state.js      Würfelmodell: 24 Drehungen, 18 Züge, Cubies, Kociemba-Koordinaten
js/color-scheme.js    Farbzuordnung, Farbnamen, Speicherung im Browser
js/scramble.js        Zufalls-Scramble ohne überflüssige Züge
js/solver-common.js   Stein-Koordinaten, Entfernungen, geschützte Zugfolgen
js/solver-twophase.js Zwei-Phasen-Suche (Tabellen + IDA*)
js/solver-lbl.js      Anfängermethode mit deutschen Erklärtexten
js/cube3d.js          Three.js-Ansicht, Ziehen → Drehung, Animation
js/ui.js              Zustand, Zähler, Schritt-Panel, Farbschema
js/main.js            Start und Verdrahtung
tests/                Tests, die im Browser laufen (siehe unten)
```

Das Modell ist durchgängig geometrisch aufgebaut: aus den 24 Drehungen des
Würfels folgen Züge, Facelet-Permutation, Stein-Permutation und Orientierung.
Anzeige, Mischen und beide Löser arbeiten damit zwangsläufig konsistent.

Für die Suche merkt sich jeder Stein seine Position *und* seine globale Drehung
(24 mögliche Lagen pro Stein). Ein Zug wirkt nur auf diese Koordinate, deshalb
lassen sich Entfernungen einzelner Steine per Breitensuche bestimmen und
Zugfolgen aufstellen, die bestimmte Steine garantiert nicht anfassen.

## Tests

Die Testseiten sind ganz normale HTML-Dateien und laufen im Browser:

```
tests/engine.html     Würfelmodell: Drehungen, Züge, Koordinaten, Identitäten
tests/pieces.html     Stein-Suche und geschützte Zugfolgen
tests/perm.html       Vertauschungs-Tabellen und -suche
tests/perm2.html      PLL-Fälle gegen die Vertauschungssuche
tests/solver.html     beide Löser über Zufallswürfel
tests/lbl.html        Anfängermethode über 12 Würfel
tests/selftest.html   Identitäten, Scramble, je 25 Würfel durch beide Löser
tests/app.html        Ansicht: Aufbau, Farben, Animation, Maus-Drehungs-Mathematik
tests/ui.html         Steuerung: Mischen, vor-/rückwärts abspielen, Zähler
```

Von Hand ansehen: `firefox tests/selftest.html` (oder die Datei doppelklicken).
Für eine schnelle Kontrolle im Terminal:

```
./tests/run.sh tests/selftest.html "" 900    # legt einen Screenshot ab
```

`tests/run.sh` prüft die Ergebnisse über den Text der Seite: Headless-Firefox
fängt WebGL-Inhalt in Screenshots nicht ein, in `tests/app.html` werden die
Bildpunkte deshalb direkt aus dem Grafikpuffer gelesen.

## Grenzen

* Die Zwei-Phasen-Suche ist nicht optimal; sie findet selten wirklich die kürzeste
  Lösung (Grenze „God's number“ = 20 Züge), sondern eine kurze.
* Die Anfängermethode braucht 60–110 Züge — sie soll zeigen, wie man vorgeht,
  nicht schnell sein.
* Die Mittelschicht lässt sich per Maus nicht drehen (dafür gibt es im Modell
  keine Züge); für solche Züge die Buttons oder die Tastatur benutzen.
