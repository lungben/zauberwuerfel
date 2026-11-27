#!/usr/bin/env python3
"""Testseiten headless in Firefox laden und OK/FAIL maschinenlesbar auswerten.

Aufruf:  python3 tests/ci.py                    (alle Testseiten)
         python3 tests/ci.py tests/engine.html  (nur diese Seiten)

Der Text im <#out>-Feld ist seitenweise (40 Zeilen pro Ansicht) - für
Auswerter gibt es die vollständigen Zeilen über T.lines. Gesucht wird ein
lauffähiger geckodriver; sonst wird er selbst gestartet und beendet.

Ausgang 0, wenn jede Seite mindestens ein OK meldet und kein FAIL oder
!!! FEHLER dabei ist.
"""

import json
import pathlib
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

WURZEL = pathlib.Path(__file__).resolve().parent.parent
TREIBER = 'http://127.0.0.1:4444'
WARTEN_MS = 600000   # Zwei-Phasen-Tafeln bauen dauert erfahrungsgemäß


def hole_treiber():
    """Laufenden geckodriver finden, sonst einen starten. Gibt den Prozess zurück."""
    try:
        with socket.create_connection(('127.0.0.1', 4444), 0.3):
            print('geckodriver läuft bereits auf :4444')
            return None
    except OSError:
        pass
    programm = shutil.which('geckodriver')
    if not programm:
        raise SystemExit('geckodriver nicht gefunden (installiere ihn oder stelle '
                         'ihn auf 127.0.0.1:4444 bereit)')
    proc = subprocess.Popen([programm, '--port', '4444', '--log', 'error'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            with socket.create_connection(('127.0.0.1', 4444), 0.3):
                return proc
        except OSError:
            time.sleep(0.2)
    proc.terminate()
    raise SystemExit('geckodriver geht nicht hoch')


def anfrage(methode, pfad, sitzung=None, inhalt=None):
    ziel = TREIBER + (('/session/' + sitzung) if sitzung else '') + pfad
    daten = json.dumps(inhalt).encode() if inhalt is not None else None
    anforderung = urllib.request.Request(
        ziel, data=daten, method=methode,
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(anforderung, timeout=WARTEN_MS / 1000 + 30) as antwort:
        text = antwort.read().decode()
    return json.loads(text) if text else {}


def seite_lesen(sitzung, seite):
    """Eine Testseite laden und alle Ergebniszeilen als Text zurückgeben."""
    url = seite.as_uri()
    try:
        anfrage('POST', '/url', sitzung, {'url': url})
    except (urllib.error.HTTPError, urllib.error.URLError) as fehl:
        print('  Hinweis: %s endet mit %s - Ergebnis wird trotzdem gelesen'
              % (seite.name, fehl))
    try:
        ergebnis = anfrage('POST', '/execute/sync', sitzung, {
            'script': "return (window.T && T.lines) ? T.lines.join('\\n') : '';",
            'args': []})
        return ergebnis['value'] or ''
    except Exception as fehl:
        return '!!! FEHLER: Seite nicht auswertbar: %s' % fehl


def bewerte(seite, text):
    zeilen = [z for z in text.splitlines() if z]
    gelb = [z for z in zeilen if z.startswith('OK')]
    falsch = [z for z in zeilen if z.startswith('FAIL')]
    krach = [z for z in zeilen if z.startswith('!!!')]
    print('%-22s %4d OK, %d FAIL, %d FEHLER' % (seite.name, len(gelb),
                                                len(falsch), len(krach)))
    for zeile in falsch + krach:
        print('    ' + zeile)
    if not zeilen:
        print('    FAIL  keine Ergebniszeilen - Seite lädt nicht oder '
              'Harness fehlt')
    return bool(zeilen) and not falsch and not krach and gelb


def main():
    if len(sys.argv) > 1:
        seiten = [pathlib.Path(a) for a in sys.argv[1:]]
        seiten = [(WURZEL / s if not s.is_absolute() else s) for s in seiten]
    else:
        seiten = sorted(WURZEL.glob('tests/*.html'))
    if not seiten:
        raise SystemExit('keine Testseiten gefunden')
    treiber = hole_treiber()
    try:
        start = anfrage('POST', '/session', inhalt={'capabilities': {'alwaysMatch': {
            'browserName': 'firefox',
            'pageLoadStrategy': 'normal',
            'unhandledPromptBehavior': 'ignore',
            'moz:firefoxOptions': {
                'args': ['-headless'],
                # Auf den CI-Läufern scheitert sonst die Inhaltssandkiste
                # (Benutzer-Namensräume sind dort gesperrt) und WebGL fällt aus.
                'env': {'MOZ_DISABLE_CONTENT_SANDBOX': '1',
                        'MOZ_DISABLE_GMP_SANDBOX': '1',
                        'LIBGL_ALWAYS_SOFTWARE': '1'},
                'prefs': {'webgl.force-enabled': True,
                          'gfx.webrender.software': True}}}}})
        sitzung = start['value']['sessionId']
        anfrage('POST', '/timeouts', sitzung,
                {'pageLoad': WARTEN_MS, 'script': WARTEN_MS})
        fehlgeschlagen = []
        for seite in seiten:
            if not seite.is_file():
                print('%-22s FAIL  Seite gibt es nicht: %s'
                      % (seite.name, seite))
                fehlgeschlagen.append(seite.name)
                continue
            if not bewerte(seite, seite_lesen(sitzung, seite)):
                fehlgeschlagen.append(seite.name)
        try:
            anfrage('DELETE', '', sitzung)
        except Exception:
            pass
    finally:
        if treiber:
            treiber.terminate()
    if fehlgeschlagen:
        print('FEHLGESCHLAGEN: ' + ' '.join(fehlgeschlagen))
        raise SystemExit(1)
    print('ALLE TESTSEITEN OK')


if __name__ == '__main__':
    main()
