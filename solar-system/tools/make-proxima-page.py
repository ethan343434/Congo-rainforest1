#!/usr/bin/env python3
"""Build proxima.html (the far side of the black hole) from index.html.

Both pages share the HUD, scripts and styles; this keeps them in sync.
Run from the solar-system folder after editing index.html:
    python3 tools/make-proxima-page.py
"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
s = (root / 'index.html').read_text()
s = s.replace('<title>Sol Voyager</title>', '<title>Proxima b</title>', 1)
s = s.replace('<script type="module" src="./src/main.js"></script>',
              "<script>window.SOL_SYSTEM = 'proxima';</script>\n  <script type=\"module\" src=\"./src/main.js\"></script>", 1)
start = s.index('<div id="menu" class="screen">')
end = s.index('<div id="pause" class="screen">')
menu = '''<div id="menu" class="screen">
    <div class="title-block">
      <h1>PROXIMA&nbsp;B</h1>
      <p class="tagline">You fell through the black hole and came out 4.24 light-years from home, above a world circling the red dwarf Proxima Centauri.</p>
      <p id="menu-date" class="date"></p>
      <ul class="brief">
        <li>Proxima b always shows its star the same face: <b>scorched day side</b>, <b>frozen night side</b>, and a <b>twilight ring</b> of life between them.</li>
        <li>The air is <b>breathable</b>. Land, step outside (<kbd>E</kbd>) and explore.</li>
        <li>Find <b>supply crates</b>. They hold a <b>laser rifle</b> (left click to fire) and energy cells.</li>
        <li>Grazers and sky jellies are <b>friendly</b>. Dune claws on the day side and night stalkers in the dark <b>are not</b>.</li>
      </ul>
      <button type="button" id="start-btn" class="btn primary">Step out of the black hole</button>
      <p class="small"><kbd>H</kbd> controls · best with keyboard and mouse</p>
      <p id="webgl-warning" class="small warn"></p>
    </div>
  </div>

  '''
s = s[:start] + menu + s[end:]
s = s.replace('<h1>SOL VOYAGER</h1>\n      <p class="tagline">The real solar system, at real scale, where it is today.</p>',
              '<h1>PROXIMA&nbsp;B</h1>\n      <p class="tagline">Crossing the event horizon…</p>', 1)
(root / 'proxima.html').write_text(s)
print('wrote proxima.html')
