#!/usr/bin/env python3
"""Baute eine Debug-Seite, die ein JS-File inline ausfuehrt, damit Firefox
Syntax-/Lauffehler mit Zeilennummern meldet.

Aufruf: python3 tests/debugjs.py js/cube-state.js [js/weitere.js ...]
Ergebnis: /tmp/opencode/debug-js.html  (+ Screenshot unter /tmp/opencode/debug-js.png)
"""
import subprocess
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.environ.get('TMPDIR', '/tmp/opencode')
files = sys.argv[1:]
if not files:
    print('js-Dateien angeben')
    sys.exit(1)

parts = []
offset = 0
for f in files:
    with open(os.path.join(ROOT, f), encoding='utf-8') as fh:
        src = fh.read()
    parts.append('/* >>> %s <<< */\n' % f + src)
    offset += 1
code = '\n'.join(parts)

html = """<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font:16px/1.4 monospace;white-space:pre;margin:10px}</style></head>
<body><div id="out">start</div>
<script>
var el = document.getElementById('out');
window.addEventListener('error', function (e) {
  el.textContent += '\\nFEHLER Zeile ' + e.lineno + ': ' + e.message +
    '\\nSTACK: ' + String(e.error && e.error.stack ? e.error.stack : 'kein Stack');
});
</script>
<script>
%(code)s
</script>
<script>
el.textContent += '\\nOK: cube-state geladen, Drehungen=' + (window.ZW && ZW.Cube ? ZW.Cube.ROTATIONS.length : 'fehlt');
</script>
</body></html>
""" % {'code': code}

out_html = os.path.join(OUT_DIR, 'debug-js.html')
with open(out_html, 'w', encoding='utf-8') as fh:
    fh.write(html)

profile = os.path.join(OUT_DIR, 'ff-debug')
os.makedirs(profile, exist_ok=True)
png = os.path.join(OUT_DIR, 'debug-js.png')
if os.path.exists(png):
    os.remove(png)
subprocess.run(['firefox', '--headless', '--profile', profile, '--screenshot', png,
                '--window-size', '1200,400', 'file://' + out_html],
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(html[:0], 'html:', out_html)
print('screenshot:', png)
