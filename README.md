# AstrologyStudio

Astrology charts and basic cosmobiology, with everything that's needed and nothing
that isn't. Self-hosted, MIT licensed, part of [Studio Apps](https://getstudioapps.com).

Every calculation and every chart lives in [ephemeralREST](https://github.com/gmelh/ephemeralREST)
(Swiss Ephemeris). AstrologyStudio is the screens and working tools around it: each
person enters their own ephemeralREST API key, and their display preferences stay in
this install.

| Folder | Contents |
| --- | --- |
| [`server/`](server/README.md) | API and server (Python, FastAPI, SQLite) |
| [`web/`](web/README.md) | The web app (Preact + TypeScript), served by the server |
| [`install/`](install/README.md) | The one-line installer and the `astrologystudio` command it adds |

See the [user guide](docs/user-guide.md) for everything the app does.

## Install

```sh
curl -fsSL https://get.getstudioapps.com/astrologystudio | sudo bash
```

Then open the address it gives you, create the owner account, connect ephemeralREST
and add your API key.

## Development

In VS Code: open this folder and press **F5**. The first time, it installs what's needed
(Python 3.12+ and Node 22+ must be on your PC). The app opens at http://localhost:8100 and
rebuilds as you edit. See
[VS Code Setup.md](VS%20Code%20Setup.md) for the details.

Without VS Code:

```sh
python3 -m venv .venv && .venv/bin/pip install -e "server[dev]"
cd web && npm ci && npm run build && cd ..
.venv/bin/astrologystudio serve --port 8100      # API docs at /api/docs
```

Tests:

```sh
cd server && ../.venv/bin/pytest -q              # server
cd web && npm test                               # web app: geometry, formats, colours, presets
# Browser tests of the main paths (Chromium, against a stand-in ephemeralREST):
.venv/bin/pip install -e "server[e2e]" && .venv/bin/python -m playwright install chromium
cd web && npm run build && cd ../server && ../.venv/bin/pytest -m e2e -q
```

## Status

- [x] 0.1 Foundation: installer, accounts, ephemeralREST connection, per-person keys, Your view switches
- [x] 0.2 Charts in: list, search, folders, tags, new and corrected charts, shared charts
- [x] 0.3 Natal wheel: wheel, positions, aspects, houses, profiles, heliocentric
- [x] 0.4 Transits and directions: transits, progressions, solar arc, bi- and tri-wheels, time stepping
- [x] 0.5 Cosmobiology: 90°, 120° and 360° dials, pointer, outer ring, midpoint trees, sort and search
- [x] 0.6 Relationships and returns: synastry, composite, Davison, solar and lunar returns
- [x] 0.7 Time tools and harmonics: event lists, ephemeris page, harmonic charts
- [x] 0.8 Output and your view: PNG and SVG export, client sheet, glyph and colour choices, Your view page
- [x] 0.9 Beta: user guide, release workflow, phone layout, long lists
- [x] 1.0 Release
- [x] 1.2 Three schools: Hellenistic chart, lots, timing; dials in Ebertin's layout
- [x] 1.3 Appearance: themes, display options, layouts, any dial size
- [x] 1.4 Presets; harmonic charts on the chart screen
- [x] 1.5 Hardening: caching, web and browser tests, phone layout, your data, hosted first run
- [x] 1.6 Composite and Davison charts, midpoint sort and search, on the chart screen

## Credits

Astrology symbols: [Astronomicon](https://astronomicon.co/en/astronomicon-fonts/) by Roberto Corona,
under the [SIL Open Font License](web/fonts/OFL.txt). The app ships a copy remapped to the standard
Unicode astrology characters, renamed "Studio Astro Glyphs" as the licence requires
([how it's made](web/fonts/make-glyph-font.py)).
