#!/usr/bin/env python3
"""Alles in eine einzige HTML-Datei bauen.

Aufruf:  ./tools/bauen.py [ziel.html]
         ./tools/bauen.py -s tests/app.html   (baut eine Prüfoseite als Einzelfall)

Ersetzt in der Seite das Stylesheet und alle <script src="..."> durch ihren
Inhalt. Die Reihenfolge bleibt erhalten, es ändert sich nichts am Programm -
die fertige Datei läuft per Doppelklick in Chrome und Firefox.
"""

import pathlib
import re
import sys

WURZEL = pathlib.Path(__file__).resolve().parent.parent
QUELLE = WURZEL / 'index.html'

MUSTER_STIL = re.compile(r'^\s*<link rel="stylesheet" href="([^"]+)">\s*$', re.M)
MUSTER_SKRIPT = re.compile(r'^\s*<script src="([^"]+)"></script>\s*$', re.M)


def einbetten(pfad, grund):
    """Eine lokale Datei in ihren Inline-Baustein übersetzen (grund = Ordner der Seite)."""
    inhalt = (grund / pfad).read_text(encoding='utf-8')

    # Ein </script> im Inhalt würde die Datei beenden, auch wenn es nur in
    # einem Text oder Kommentar steht. Für JS ist <\/script> dasselbe.
    if '</script' in inhalt:
        print('  Hinweis: </script> im Inhalt von %s überschrieben' % pfad)
        inhalt = inhalt.replace('</script', '<\\/script')
    if '<script' in inhalt:
        print('  Warnung: <script im Inhalt von %s' % pfad)

    if pfad.endswith('.css'):
        return '<style>\n%s</style>' % inhalt
    return '<script>\n%s</script>' % inhalt


def main():
    seite = QUELLE
    args = sys.argv[1:]
    if args and args[0] in ('-s', '--seite'):
        if len(args) < 2:
            raise SystemExit('-s braucht einen Seitennamen')
        seite = WURZEL / args[1]
        args = args[2:]
    ziel = pathlib.Path(args[0]) if args else WURZEL / 'dist' / 'zauberwuerfel.html'
    if not ziel.is_absolute():
        ziel = WURZEL / ziel
    text = seite.read_text(encoding='utf-8')
    grund = seite.parent                      # Pfade in der Seite sind relativ zur Seite
    eingebettet = []

    def ersetze(match):
        pfad = match.group(1)
        if pfad.startswith(('http://', 'https://', '//')):
            raise SystemExit('fremde Quelle %s - die Datei soll offline laufen' % pfad)
        eingebettet.append(pfad)
        return einbetten(pfad, grund)

    text = MUSTER_STIL.sub(ersetze, text)
    text = MUSTER_SKRIPT.sub(ersetze, text)

    # Was nicht ersetzt wurde, fehlt: dann wäre die Datei unvollständig.
    for muster, name in ((MUSTER_STIL, 'Stylesheet'), (MUSTER_SKRIPT, 'Skript')):
        if muster.search(text):
            raise SystemExit('kein Ersatz für ein %s gefunden' % name)

    ziel.parent.mkdir(parents=True, exist_ok=True)
    ziel.write_text(text, encoding='utf-8')

    groesse = ziel.stat().st_size
    print('%d Dateien eingebettet:' % len(eingebettet))
    for pfad in eingebettet:
        datei = (grund / pfad).resolve()
        print('  %-26s %7d Bytes' % (pfad, datei.stat().st_size))
    print('=> %s  (%.0f kB)' % (ziel, groesse / 1024))


if __name__ == '__main__':
    main()
