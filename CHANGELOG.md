# Changelog

## 1.21.6

### Images now come from GitHub

- The code now lives at **github.com/studioappsorg/astrology_studio**, and releases are built there by
  GitHub Actions (Intel/AMD and ARM) and published as `ghcr.io/studioappsorg/astrologystudio`
  whenever a `vX.Y.Z` tag is pushed. The installer and `astrologystudio update` use that image.
- **Existing installs:** re-run the installer once
  (`curl -fsSL https://astro.getstudioapps.com | sudo bash`). It switches the image from
  `registry.getstudioapps.com` to GitHub's registry, keeping the same version tag, and keeps your
  data and settings. After that, `astrologystudio update` works as before.
- The build server (`deploy/build-server`) is now optional, for building and hosting the image
  yourself; it fetches the code from GitHub by default.

## 1.21.5

### The installer's new address

- The installer is now served from **https://astro.getstudioapps.com**, so installing is
  `curl -fsSL https://astro.getstudioapps.com | sudo bash`. The script, its help text and the
  READMEs say so. Nothing else changes: images still come from `registry.getstudioapps.com`.

## 1.21.4

### Fixed: a choice could be lost if the page reloaded while it was being saved

- Screen choices (such as *Open new charts with this preset*, the Overview's counting, the default
  preset) are saved a moment after you make them. If the page reloaded or moved on just as that
  save was on its way, the browser cancelled it and the choice was lost. Saves now carry on when
  the page closes, and anything not yet confirmed is sent again and put back after the reload.
- This was behind an occasional failure of the presets browser test on slower machines (CI); a new
  test holds a save back, reloads, and checks the choice is still there.

## 1.21.3

### Settings in tabs

- Settings now shows one section at a time under tabs, in a single tidy column, instead of a grid
  of cards of different heights: **Defaults**, **Calculation**, **ephemeralREST**, and for the
  owner **Business**, **Email** (the SMTP server), **New accounts** and **Site themes**.
- The address names the section (for example `/settings?section=email`), so a reload, a bookmark
  or a link opens on it.

## 1.21.2

### Two-page client sheet: aligned to the page

- Page 1: the logo and business box sits on the bottom margin, whatever the paper (A4 or Letter),
  with the wheel at the top.
- Page 2: the aspectarian's bottom edge lines up with the bottom of the tables beside it.

## 1.21.1

### Client sheet: two pages when there are too many bodies

- When the bodies switched on won't fit one page without making the wheel small (or the page would
  have to be shrunk to fit), the client sheet goes onto **two pages**: page 1 has the chart wheel
  across the full width (190 mm) with the logo and business details in a box under it; page 2 has
  the aspectarian, the positions, the house cusps and the elements and modalities. With the usual
  bodies it stays on one page as before. A note beside *Print or save as PDF* says when it's two.
- On page 1 the business box lays out sideways: the logo on the left, the details beside it (in two
  columns when they're long).

## 1.21.0

### Business details on client sheets

- **Settings → Business details and logo** (owner): a text box for your business or contact
  details, typed as they should print (up to 1,000 characters), alongside the logo upload.
- **Client sheets** print the logo and the business details in a box at the bottom right, under the
  elements and modalities. The logo has moved there from the top corner; with neither set, the
  sheet shows the AstrologyStudio name at the top as before. The sheet still fits one A4 or Letter page.
- API: `GET /branding` now returns `details` too; `PUT /branding/details` (owner) sets them. The logo
  and the details are kept and removed independently.

## 1.20.1

### Client sheet: a larger aspectarian, lined up with the wheel

- The aspectarian now starts at the left edge, in line with the chart wheel, instead of being centred
  under it.
- It's a little bigger: with the usual bodies its squares grow from about 6.3 mm to 6.8 mm (the wheel
  gives up 6 mm, to 126 mm across). Squares are never more than 7.5 mm, and the aspect symbols (at
  most 11 pt) and orbs (at most 6.5 pt) stop growing there, so a short list of bodies doesn't give
  oversized type. With many bodies it still shrinks to fit one A4 or Letter page.

## 1.20.0

### Overview: the first interpretive page

- **A new Overview tab**, straight after Chart, for the selected chart:
  - **Elements and modalities** (triplicities and quadruplicities) in one table, each planet in its
    square, with totals; the **chart signature** (the sign where the leading element and modality
    meet, both signs on a tie); polarity; strong, weak and missing elements and modalities; and
    singletons. Count the ten planets, add the Ascendant and MC, or weight the Sun, Moon and
    Ascendant double.
  - **Sun, Moon, Ascendant and chart ruler**, the Moon's phase at birth, day or night chart, and
    the retrograde planets.
  - **Chart shape** (Jones's seven patterns), with the leading planet or handle.
  - **Hemispheres and houses**: above/below, east/west, quadrants, and angular, succedent and
    cadent houses.
  - **Patterns**: grand trines, kites, grand crosses, mystic rectangles, T-squares and yods,
    stelliums by sign and house, and unaspected planets.
  - **Dignities and rulerships**: dignities and debilities, mutual receptions and the final
    dispositor, with modern or traditional rulers.
- It's a feature you can switch off under My View → Features ("Chart overview"); it's on for
  Self-selected, Modern Western and Hellenistic, and presets can open on it.
- **Client sheet**: the elements and modalities table, the chart signature and polarity, under
  the house cusps. It still fits one A4 or Letter page.

## 1.19.1

### Client sheet on one page

- **Fits one portrait page of A4 or US Letter**: the sheet is laid out in millimetres to the space
  both share (190 × 255 mm inside 10 mm margins), and the print setting no longer forces A4.
- **A large wheel** (132 mm across) with the positions and houses beside it, and the house cusps in
  a compact two-column table below them.
- **A readable aspectarian** under the wheel, in the staircase style with each body's symbol on
  the diagonal, its squares sized to the number of bodies (up to 8 mm) and larger aspect symbols
  and orbs. With many bodies on, the squares and then the wheel shrink so it all still fits; as a
  last resort the sheet scales itself to the page.
- Browser test: the sheet prints as one page on A4 and on Letter, with the usual bodies and with
  every body on.

## 1.19.0

### Your logo on saved charts and client sheets

- **Settings → Logo** (owner only): upload a company or owner logo (PNG, JPEG, WebP or SVG, under
  1 MB; large pictures are scaled down on upload), with a preview, *Replace logo…* and *Remove*.
- **Saved PNG and SVG pictures** now have the chart details across the top (chart 1 on the left,
  chart 2 on the right when there is one, for the chart screen, synastry, composite, Davison and
  returns) and the logo in the bottom right. The picture grows to make room; the chart itself is
  unchanged.
- **Client sheets** show the logo in the top corner in place of the AstrologyStudio name.
- Saved SVGs now use plain colours throughout: mixed colours were written as `color(srgb …)`,
  which drawing programs such as Inkscape and Illustrator showed as black.
- API: `GET /branding` (anyone logged in; the logo as a data URL), `PUT` and `DELETE
  /branding/logo` (owner). The logo is checked to be the image type it says it is and is never
  served as a file of its own.

## 1.18.0

### Forgot your password?

- **Password resets by email**, once the owner has set up email (Settings → Email). The login
  page offers *Forgot your password?*; the email has a link to choose a new password, which works
  once, for an hour, and logs the account out everywhere else. Only a hash of each link is kept.
- **Private and limited:** the answer is the same whether or not an account exists (even if
  sending fails), and an account gets at most one reset email a minute.
- Accounts that sign in through ephemeralREST are emailed that their password is changed there.
  A reset link opened while logged in goes to Account.
- API: `POST /auth/password-reset`, `GET /auth/password-reset/{token}`,
  `POST /auth/password-reset/finish`; `/auth/status` has `password_reset`. Database migration 007
  adds `password_resets`.

## 1.17.0

### Email through your own SMTP server

- **Settings → Email** (owner only): the SMTP server, security (STARTTLS, SSL/TLS or none), port,
  username and password, and the From address, From name and Reply-to that everything in the app
  sends email with. The password is kept encrypted with the install's secret key and never shown
  again (leave it empty to keep it). *Send test* sends a test message and explains any failure.
- **One way to send:** `mail.send()` on the server (to, subject, text, optional HTML and
  attachments) is what every feature that sends email uses, so all of it goes through these
  settings. Nothing in the app sends email yet besides the test.
- API (owner only): `GET`, `PUT` and `DELETE /email`, and `POST /email/test`.

## 1.16.0

### Shorter menus, and My View

- **"Your view" is now "My View"**, everywhere in the app and the guide, and it has its own place
  in the menu bar (before Help), which goes straight to the page.
- **The menus keep only what isn't a click away elsewhere:**
  - *File*: New chart, Open chart…, Add a shared chart…, Close tab.
  - *Chart* (on a chart): Edit details…, Returns, Client sheet.
  - *Tools*: Ephemeris, Settings, Users (owner).
  - *Help*: Keyboard shortcuts, Getting started (moved from Tools), About.
- **Taken off, and where they are:** the View menu's chart types (the title bar's chart-type
  picker), Dark mode (the ☀/☾ button), Next and Previous tab (the tabs, Alt+] and Alt+[), and
  Status bar (now *Show the status bar* under My View → Appearance); File's Chart library (its tab,
  always first), Account and Log out (the account menu, top right); Chart's Chart and With another
  chart (the chart's tab, the Chart 2 card and ＋ View); and the extra My View entries in Tools and
  the account menu.
- Escape now closes a menu opened with the mouse, too.

## 1.15.10

- **Browser tests wait for the screen to catch up.** `test_app_frame` failed on GitHub because it
  read the title bar's chart-type picker a moment before it changed to Dial (the dial was already
  drawn; the picker follows a moment later). Checks made straight after an action (the picker,
  the preset picker, a place filled in, symbol buttons, checkboxes and the tab order) now use
  Playwright's retrying checks, which wait up to 5 seconds for the expected value.

## 1.15.9

- **Choices made just before a reload are kept.** Your choices (open tabs and the rest) are sent
  to the server as the page closes, but a reload straight afterwards could load them before the
  server had saved them, bringing back, say, a tab you'd just closed. Now they're also held in the
  browser tab for a few seconds and put back (and sent again) when the page loads.
- The browser test of tabs (`test_app_frame`) failed on GitHub for that reason: it reloaded the
  page straight after closing a tab. It now reopens the chart from the library instead, and a new
  test covers closing a tab and reloading at once.

## 1.15.8

- **Checks workflow:** the GitHub actions are on their Node 24 versions (checkout v6, setup-node
  v6, setup-python v6; the release workflow's Docker actions too), which clears the "Node.js 20 is
  deprecated" warnings. The browser tests list each failure by name (`-rf`), and a failing browser
  test now saves a screenshot of the page, kept as the run's `browser-test-failures` artifact.
- A browser test of presets waits for the transits view's chart to be worked out before saving,
  which a slow machine could otherwise beat.

## 1.15.7

- **fontTools and brotli are part of the development setup** (`server[dev]`, which F5 installs),
  so `web/fonts/make-glyph-font.py` runs from `.venv` and VS Code no longer reports
  `Import "fontTools" could not be resolved`.

## 1.15.6

- **Every source file starts with a header:** the app's name, the file's path, what the file is
  for, and the copyright and MIT License reference (with an `SPDX-License-Identifier: MIT` line
  for licence-scanning tools). Covers the Python, TypeScript, SQL, shell, CSS and HTML files, the
  tests, and the Dockerfile, workflow and compose files and `pyproject.toml`. JSON files can't
  hold comments, so they're left as they are.
- LICENSE: the copyright holder is now written in full, Gavin Melhuish.

## 1.15.5

- **Composite and Davison charts are kept with the From chart.** Made as a derived chart (Change →
  Derived chart), they're now listed under the chart they were made from, like transits and
  returns, so they can be picked again from the saved charts. They're still worked out from the
  two charts each time they're shown, so corrections to either chart carry through. Removing one
  removes just it; removing either of its two charts removes it too.
- API: `POST /charts/{id}/derived` takes `kind: "composite"` or `"davison"` with `other` (and
  `place` for Davison); kept ones appear in that chart's `derived` list, and
  `DELETE /charts/{composite~…}` removes one. Database migration 006 adds `kept_derived`, which is
  included in your data export.

## 1.15.4

- **Tags are badges** wherever they're shown or added. In New chart and Edit, each tag is a badge
  with × to take it off; type a tag and press Enter, Tab or a comma to add one (Backspace in the
  empty box takes off the last), with tags from your other charts suggested as you type. The
  chart library's tag filter and the Change dialog's chart list show them as badges too.

## 1.15.3

### Releases from your own build server

- **`deploy/build-server/`**: set up an Ubuntu server that builds the image and keeps it in its
  own registry (`registry:2` behind Caddy, read-only from outside; the server pushes to it
  locally, so no push passwords). `studio-build release` builds and publishes a version as
  `X.Y.Z`, `X.Y`, `X` and `latest`; with `--watch`, new `vX.Y.Z` tags are built automatically
  within 10 minutes. `studio-build list` and `prune` look after the registry.
- **The installer pulls from it:** the default image is now
  `registry.getstudioapps.com/astrologystudio:latest` (was GHCR). `astrologystudio update` pulls
  the newest from there.

## 1.15.2

- **Chart 1 and chart 2 cards** on the canvas are larger, and always the same size as each other.
  Long chart names wrap (up to three lines, then the rest is in the tooltip), and so does the
  chart name over the positions in the panel.
- **Tabs:** the Chart library is always the first tab and can't be closed (no ×, and Alt+W or
  File → Close tab does nothing there); the app opens on it. The home screen is gone: closing the
  last other tab goes back to the library. Every other tab can be dragged to a new place in the row.

## 1.15.1

- **Edit is a dialog too**, styled like New chart and the Change dialog, in the middle of the
  screen over the chart (which stays loaded behind it). *Remove from my charts* is at the bottom
  left; Cancel, × or Escape goes back to the chart. Saving redraws the chart with the changes.

## 1.15.0

### New chart, house systems and defaults

- **New chart is a dialog** in the middle of the screen, styled like the chart screen's Change
  dialog, with the same fields as before. Cancel, × or Escape closes it and its tab.
- **A house system for each chart.** New chart, Edit and the Change dialog's New chart have a
  *House system*: *Default* (whatever is in use) or a particular system that chart always uses.
  Changing it recalculates only the houses. Derived charts use their parent's house system.
- **Settings → Defaults:**
  - **Default house system**, for calculation profiles set to *My default* (new in the profile's
    house system list) and charts set to *Default*. Profiles that had Placidus, the old default,
    now follow it, so nothing changes until you choose another.
  - **Default location**, where you usually are: New chart starts with it, and transits, solar
    returns and lunar returns (including a preset's "now" charts) are worked out for it unless
    you give another place. Progressions and solar arc stay at the birth place.
- API: `GET`/`PUT /preferences/defaults` (`house_system`, `place`); `house_system` on
  `POST /charts`, `PATCH /charts/{id}` and each chart's `note`; a profile's `house_system` may be
  `null` (send `""` to choose the default); `/preferences/calculation` includes `defaults`.
  Database migration 005 adds `chart_notes.house_system`.

## 1.14.3

- **Events: choose the bodies.** Two lines of symbols above *List events*: the moving bodies
  (*Transiting*, *Progressed* or *Solar arc*) and the natal ones they aspect (*To natal*), each
  with *All*, *None* and *Usual*. The choices are remembered, the moving bodies separately for
  each kind of event. The Moon is now one of the symbols, in place of the *The Moon* checkbox.
- `GET /charts/{id}/events` takes `targets`, the natal bodies to aspect (default: all your Your
  view bodies). Unknown body names in `movers` or `targets` are refused (422).

## 1.14.2

- **Aspects report:** the aspectarian and the list of aspects sit side by side, each half the
  width. The aspectarian's squares grow or shrink to fill its half; the list is tighter, and drops
  applying/separating when its half is narrow. One above the other when the window is narrow.
- **Midpoints report:** *On the pointer* is gone. *Midpoint sort* lists everything *Round the dial*
  (from 0°) or *Closest to exact*: each midpoint within orb of a factor, with the factor, tightest
  first. The sort and search card is wider, and the trees move over to make room.
- **Positions panel:** column headings Body, Long. and House; no House column on the dial.
- **Hellenistic report:** its two cards are the same width and reach both edges.
- Reports use the full width of the screen (they stopped at 1500 pixels).

## 1.14.1

- **Close a view with its ×.** Each view in the views row has a small × that closes it, and Delete
  closes the view that has focus. Closing the last but one view hides the row, as before.

## 1.14.0

### Self-selected school

- **Self-selected** is a new default school, first in the list, tied to no school in particular:
  mix and match techniques from every school with the Features and Bodies & points switches.
- **New accounts start with the most common techniques:** transits, progressions, solar arc,
  returns, synastry, composite charts, midpoints, event lists and the ephemeris; the ten planets,
  Chiron, the mean node, the Ascendant and Midheaven. Dials, Hellenistic techniques, Davison,
  harmonics, heliocentric positions and Ceres, Pallas, Juno and Vesta start off, ready to switch on.
  *Reset to defaults* now goes back to this set.
- **Back to the most common techniques** (in place of *Show only what … uses* while Self-selected is
  chosen) resets the switches to that set. `POST /preferences/limit-to-school` takes `"self"`.
- **Modern Western now opens charts on the chart wheel** each visit, like the other schools. Anyone
  who hadn't chosen a school is now on Self-selected, so their charts still open where they left
  them.
- The catalog's schools have a `hint`.

## 1.13.0

### Presets tab in My View

Design: `docs/design/views-and-presets/`, iteration 1.13. The design (with its sample screens) is now
in the repo, marked as built.

- **My View → Presets** (a new tab) replaces the presets list in Charts & dials. Each preset shows
  its views as chips, its theme and profile, and *Default for new charts*.
- **Edit a preset:**
  - name, theme (or keep the theme in use), calculation profile (or keep the profile in use)
  - each view's name, chart type, dial size, layout (or your default), report tab, chart 2 role
    (with a chart picker for *Always a particular chart*) and *Between 1 and 2*
  - add views (up to six), remove them and move them up or down
- **Duplicate, move up or down, delete** presets. The order is the picker's order
  (`PUT /preferences/presets-order`).
- **New charts open with**: a preset, or one view from your last choices. This is where the default
  preset can now be cleared.
- **A preset with several views, on a chart with several**: ask each time, replace, or add after.
  This is where a remembered choice can now be changed.
- *Manage presets…* in the preset picker opens this tab (`/view?tab=presets`).
- Phones: the views row scrolls sideways, and the preset editor stacks its fields.
- Tests:
  - server: preset order
  - browser: editing a preset's views, the default preset, replace-or-add, duplicate, reorder,
    delete, and *Manage presets…*

## 1.12.0

### Presets as sets of views

A preset is now the set of views a chart opens with, plus a theme and calculation profile. Design:
`views-and-presets-design.md`, iteration 1.12.

- **Presets hold 1–6 views.** Each view has a chart type and dial size, layout, report tab,
  *Between 1 and 2*, an optional name, and a **chart 2 role**:
  - none
  - ask each time
  - transits now
  - progressions to the day
  - solar arc to the day
  - the year's solar return
  - the month's lunar return
  - always a particular chart

  Presets from before 1.12 read as one-view presets. The API still accepts and returns the old
  fields (`display`, `dial_size`, `layout`, `panel`), which mirror the first view.
- **Applying from the picker:**
  - A one-view preset changes the view on screen, including chart 2 unless its role is *none*.
  - A preset with several views gives the chart those views in its tab. On a chart that already
    has several, it asks the first time: *Replace them* or *Add after them*, with *Remember my
    choice*.
  - Charts for "now" roles are worked out straight away. *Ask each time* opens the chart dialog
    on that view.
  - Missing layouts, a switched-off chart type, a deleted theme or profile fall back and are named
    in the notice, as before.
- **Save this chart's views as a preset…** (replaces *Save as new preset…*):
  - name it, and tick the views to include
  - for each chart 2 choose its kind (*Ask each time*, *Transits now* and so on) or *Always <that
    chart>*
  - *Open new charts with this preset*
  - It keeps the current theme and profile, as before.
- **Default preset for new charts**: charts with no views yet open with it, working out any "now"
  charts. Set it when saving. Clearing it comes with the Presets tab in 1.13.
- **(changed)** now compares the chart's views with the preset's: chart type, dial size, layout,
  number of views, and whether each has a chart 2. Switching report tabs doesn't count. *Save
  changes to …* saves the chart's views into the preset, keeping each chart 2's role.
- **＋ View → From a preset** adds a preset's views after the chart's own.
- *Manage presets…* in the picker opens My View.
- Views remember how a chart 2 worked out for now was made, so saving keeps it as "transits now"
  and not that particular moment. Chart 2 names are kept with views for their labels.
- Tests:
  - server: sets of views, the old shape, first-view edits through the old fields, checks
  - unit: views to templates, chart 2 roles, the (changed) comparison
  - browser: saving a chart's views as a preset; the default preset opening a new chart with
    transits worked out; replace or add; *ask each time* opening the chart dialog

## 1.11.0

### Views in a chart

A chart can now be looked at in several ways in its own tab: for example a Western wheel, a 90° dial,
and a bi-wheel with a partner. Each way is a **view**. Tabs still mean one chart each. Design:
`views-and-presets-design.md`, iteration 1.11.

- **＋ View** (right of the report tabs, or in the views row) adds a view:
  - a copy of this view
  - as a chart wheel, a dial or a Hellenistic chart
  - with another chart…
  - with transits now, progressions to today, solar arc to today, or this year's solar return

  The ones that need a chart worked out make it at once through the existing derived-chart
  calculations, and it's listed under the chart.
- **Views row**: shown above the report tabs once a chart has two or more views. Click to switch in
  place. Right-click to rename, duplicate, move left or right, or close. Drag to reorder. Up to 6
  views per chart. Labels come from what a view shows (*Western*, *Dial 90°*, *+ John Smith*,
  *Dial 90° + Transits*) unless renamed.
- **Each view keeps its own:**
  - chart type and dial size
  - layout
  - chart 1 (when derived from the chart) and chart 2
  - report tab
  - selected chart
  - *Between 1 and 2*
  - dial pointer

  These used to be one set of choices shared by every chart.
- **The title bar pickers** (chart type, dial size, layout) and **applying a preset** change the
  view on screen only. Your last choices are the starting point for new views. Presets as sets of
  views follow in 1.12.
- **Kept on the server per chart** (`GET/PUT/DELETE /preferences/chart-views/{chart}`), so views
  follow you between devices. The 300 most recently changed charts keep theirs. A chart without
  views opens with one made from your last choices, so it looks exactly as before.
- `?view={id}` on a chart's address opens that view. The old `/charts/{id}/dial` and `/events`
  addresses open the chart's view on the dial or the Events tab.
- **Chart wheel: lines from moved symbols to the graduation are now off by default.** The tick on
  the graduation still marks each body's exact place. Switch the lines back on in My View →
  Charts & dials → Chart wheel.
- **Hovering a body shows only its aspects**: the other aspect lines are hidden, not faded.
- Tests:
  - server: views stored, read back, checked and pruned
  - browser: wheel and dial views of one chart, each keeping its report; the chart type picker
    changing one view; a view with another chart; views after a reload; closing a view

## 1.10.1

- **The chart only draws aspects between the selected chart's own bodies.** Choosing *Between 1
  and 2* on the Aspects tab no longer draws synastry lines across the wheel; the aspectarian and
  list there still show the aspects between the charts. Click a chart's card to see its aspects.
- Test: the wheel's aspect lines stay the same when *Between 1 and 2* is chosen.

## 1.10.0

### Aspects in My View

- **My View → Aspects** (a new tab): tick the aspects you use, set their orbs, and give each its
  own colour.
  - An aspect switched off is not found at all, so it isn't drawn on any chart or listed in any
    report: aspect lines, the aspectarian and aspect list, synastry, events, the client sheet and
    Hellenistic aspects by sign (which now follow the profile's switches too).
  - *All*, *Major only* and *None* set them all at once.
  - On/off and orbs belong to the active calculation profile (the same settings as Settings →
    Calculation profiles), so presets that change profile change them too.
  - Colours are kept with My View, over whichever theme is in use, in light and dark mode
    alike; *Theme colour* goes back to the theme's. They're used wherever aspects are coloured:
    lines, glyphs, grids, lists and events. *Reset to defaults* clears them.
- **Aspect symbols on the lines**: each aspect line on the chart wheel and the Hellenistic chart
  carries its aspect's symbol in the middle, on a small disc in the wheel's colour. Where the
  middle is taken (every opposition crosses the centre) the symbol slides along its line to the
  nearest free place. It dims with its line when you hover a body. Switch it off in My View →
  Aspects.
- API: `PATCH /preferences/view` takes `aspect_colours` (`{"trine": "#22cc55"}`, `null` to go back to
  the theme's); `GET /preferences/view` returns them.
- Tests: aspect colours (saving, checking, reset), switched-off aspects missing from standard and
  Hellenistic charts, and a browser test for the tab, the colours and the symbols on the lines.

## 1.9.2

- **Fixed: the dial flickered while its pointer was dragged.** Two causes, both new in 1.9:
  - Every movement of the pointer redrew the whole chart screen (panel, chart cards, report tabs).
    The dial now keeps the pointer to itself while you drag and tells the screen where it ended up
    when you let go, so only the dial redraws.
  - The canvas measured itself with a CSS size container (to decide where the chart cards go),
    which made the browser repaint the drawing area as a block. It's now measured once per resize
    in code instead.
- Test: dragging the dial's pointer changes nothing outside the dial.

## 1.9.1

### Chart screen layout

- **The report tabs sit over the chart only.** The positions panel on the left runs from the top,
  beside them.
- **Chart 1 and chart 2 are on the canvas**, under the report tabs: chart 1 to the left of the wheel
  or dial, chart 2 to the right. When the canvas isn't wide enough to keep them clear of the
  chart, they go in a row above it; on report tabs they sit above the report. With one chart, the
  right-hand card offers *＋ Add a chart*; × on chart 2 goes back to one chart (the 1 | 2 switch is
  gone).
- **The panel holds the selected chart's positions only**, headed with its name.
- **The chart list down the left of every screen is gone**, as it duplicated the chart library and
  the chart cards' *Change*. Ctrl+K (File → Open chart) now opens the chart library with the cursor
  in its search; Ctrl+B and View → Chart list are gone, and so is ☰ on phones.
- Tests: browser tests for the tabs over the chart only, the cards on the canvas, clearing chart 2,
  and Ctrl+K.

## 1.9.0

### Report tabs on every chart

- **Report tabs across the top of every chart**, centred: *Chart*, *Aspects*, *Midpoints*,
  *Hellenistic* and *Events* (the last three when their features are on). The bar spans the
  panel and the stage; the chart picker and positions sit under it. The tab in use is remembered,
  and presets set it (a preset's aspectarian, midpoint trees or timing switch now means the
  Aspects, Midpoints or Hellenistic tab).
- **The panel shows the charts and the selected chart's positions only.** Everything else moved to
  the tabs:
  - *Aspects*: the aspectarian and the aspect list; with two charts, *Chart 1 | Chart 2 | Between
    1 and 2*, which also decides the aspect lines in the wheel.
  - *Midpoints*: on the pointer, midpoint sort and search beside the midpoint trees, with the orb
    and *Include 45°*. Moving the pointer here moves it on the dial.
  - *Hellenistic*: sect, each body's lords, dignities, phase and joy, whole-sign houses, and
    timing (profections and zodiacal releasing), whose signs are marked on the Hellenistic chart.
    *Modern bodies* is here and under the Hellenistic chart.
  - *Events*: exact transits, progressions and solar arc directions to chart 1.
  Reports use the app's own colours and scroll by themselves.
- **Two charts, not three.** Chart 1 is the inner chart (normally the natal chart) and chart 2 the
  outer (transits, progressions, returns, synastry), labelled *inner* and *outer* in the panel. A
  setup saved with three charts shows its first two.
- **The dial matches the bi-wheel**: the natal chart (chart 1) is the inner ring and chart 2 the
  outer, each in its own chart's colour.
- The old `/charts/{id}/events` address opens the Events tab.
- Removed: the aspectarian, midpoint trees, timing and events layouts beside the chart.
- Tests: browser tests for the report tabs, the panel holding only positions, two charts at most,
  and the natal chart inside on the dial; a unit test for presets and report tabs.

## 1.8.0

### Works like an application

AstrologyStudio is now laid out like a desktop program (in the spirit of MindForce Dials) rather than
a website. The browser page never scrolls; each part scrolls on its own.

- **Title bar with menus**: *File*, *View*, *Chart*, *Tools* and *Help* replace the row of page
  links. The chart screen's Preset, Chart type and Layout pickers stay at the right, with the
  light/dark switch and an account menu (your initial and name) holding Account and Log out.
- **Chart list down the left of every screen**: find a chart as you type and open it without
  leaving what you're doing; arrow keys and Enter, or click; right-click for its other screens
  (with another chart, returns, client sheet, edit). Filter by folder. ＋ for a new chart, ▤ for the
  full chart library. Hide it with « or Ctrl+B; a strip at the left brings it back.
- **Tabs**: every chart and screen you open gets a tab, which remembers where you were in it. Close
  with ×, a middle-click or Alt+W. Switching chart from the chart's own panel keeps the tab. Open
  tabs are remembered with your other choices; deleted charts' tabs close themselves. Closing the
  last tab shows a home screen with your recently changed charts.
- **Status bar**: ephemeralREST's health (a dot, checked every five minutes or when clicked), the
  chart or screen you're on, how many charts you have, and the version. View → Status bar hides it.
- **Keyboard shortcuts**: Ctrl/⌘+K find a chart, Ctrl/⌘+B chart list, Alt+N new chart, Alt+W close
  tab, Alt+] / Alt+[ next and previous tab, Ctrl/⌘+, Settings, ? the list (Help → Keyboard shortcuts).
- **Denser controls**: smaller type, buttons, fields, cards and tables, as in a desktop program.
- **Phones**: ☰ in the title bar slides the chart list over the screen and puts it away once you've
  picked a chart; tabs scroll sideways; no status bar.
- File → *Add a shared chart…* opens the chart library with the shared-chart form ready
  (`/charts?add=shared`).
- Tests: a browser test for the frame (chart list, tabs, menus, shortcuts, home screen, status bar).

## 1.7.0

### Synastry and events on the chart screen

- **Aspects between charts**: with two or three charts on the wheel, *Aspects: Chart N's own |
  Between 1 and N* in the panel. Between draws chart 1's aspects to the other chart across the
  wheel and, with the aspectarian on, a full grid (chart 1 down the side, the other chart along the
  top) placed clear of the wheel. Worked out in the browser from the profile's orbs, so it works
  for any pair of charts, derived ones included.
- **Events beside the wheel**: an *Events* checkbox next to *Aspectarian* lists exact transits,
  progressions or solar arc aspects to chart 1 by month; hovering one shows its natal body on the
  wheel. The separate Events screen is gone, and its address opens the chart screen with events on.
- Fixed: opening an old address directly (`/dial`, `/harmonic`, `/events`) could leave the screen
  blank, because the redirect happened before the app was listening for address changes.
- Tests: `aspectsBetween` unit tests; browser tests for aspects between charts and for events.

## 1.6.0

### Composite and Davison charts, and midpoints, on the chart screen

- **Composite and Davison charts are derived charts**: *Change* → *Derived chart* → *Composite* or
  *Davison*, then the second chart. They go in any chart slot and work on the wheel, the
  Hellenistic chart and the dial. They're worked out from the two charts each time and aren't added
  to your list; a Davison chart is calculated once and then kept for an hour, since ephemeralREST
  keeps every chart it calculates.
- **Davison place**: an optional *Where* replaces the midpoint place. An ephemeralREST that only
  finds places by name can't use the midpoint's coordinates, and now says so plainly.
- **Midpoints beside the dial**: *On the pointer*, *Midpoint sort* (in order round the dial, the row
  at the pointer kept in view; click a row to move the pointer) and *Search* (any degree), for the
  selected chart, whatever kind it is.
- The separate Dial screen is gone; its old address opens the chart screen on the dial.
- Calculating a chart (a Davison chart, or a chart in another house system) no longer clears the
  cache of chart reads.
- API: `GET /charts/derived/composite~{id}~{other}` and `davison~{id}~{other}[~{place}]`;
  `place` on `GET /charts/{id}/davison`.

## 1.5.0

### Hardening for the hosted service

- **Fewer calls to ephemeralREST.** Charts, derived charts and the chart list are cached per key
  (charts for 10 minutes, the list for 1 minute), and anything you change clears them. Opening a
  chart again, switching chart type, or adding a ring no longer asks ephemeralREST at all.
- **Hosted first run.** `ASTROLOGYSTUDIO_HOSTED=1` marks a hosted service. People who sign up
  never see ephemeralREST: no key or connection steps, and plain wording on login, sign-up,
  Account, Charts, chart forms and messages. The owner still sees everything.
- **Welcome.** With no charts yet, the chart list offers *Add your first chart*.
- **Your data.** Account → *Download my data*: one JSON file with your chart list, notes, folders
  and every setting, theme, layout and preset.
- **Delete your account.** Confirmed with your password (or email), optionally taking your charts
  off your chart list. The owner's account can't be deleted this way.
- **Phones.** The top bar's pickers get their own row; the aspectarian, midpoint trees and timing go
  under the chart; tables keep their columns; My View and the editors fit.
- **Tests.** Web unit tests (`npm test`) and browser tests of the main paths (`pytest -m e2e`),
  both run by CI.
- **Fixed:** crowded symbols on wheels and dials drifted anticlockwise; each crowded run is now
  centred on its true positions.
- **Installer:** `.env` has `ASTROLOGYSTUDIO_HOSTED`, passed to the app.
- API: `GET /account/export`, `POST /account/delete`; `hosted` in `GET /auth/status`.

## 1.4.0

### Fixes from the code review

- **Theme pinned by accident.** Changing any display option (or, for someone who had changed their
  symbols, nothing at all) stored the theme too, so a later change to the site's default theme
  passed them by. Only what each person actually chooses is stored now.
- **Settings that can't load** no longer leave screens that can't work: the app says it couldn't
  load your settings, with *try again*.
- The theme's colours are applied before the page paints, not while it's being worked out, and
  styles.css carries Studio's colours as a fallback (a test keeps them in step with the server).
- Removed the old colour-scheme swatch styles.

### Harmonic charts on the chart screen

- **Harmonics are a derived chart**: *Change* → *Derived chart* → *Harmonic*, with a harmonic
  from 1 to 180 and one-click H4, H5, H7, H9 and H16. They go in any chart slot, so a harmonic can
  sit round the natal chart, and work on the wheel, the Hellenistic chart and the dial. They're
  worked out from their chart each time, so nothing is stored and they aren't added to your list.
- The separate Harmonics screen is gone; its old address opens the chart screen.
- API: `GET /charts/derived/harmonic-{n}-{chart id}` gives a harmonic chart in a derived chart's
  shape (with `mode=hellenistic` too). `GET /charts/{id}/harmonic?n=` is unchanged.

### Presets

- **Presets** bundle a working setup: chart type and dial size, layout, theme, calculation profile
  and panel options (aspectarian, midpoint trees, timing). Choose one from the new Preset picker at
  the left of the chart screen's top bar to switch everything at once; the charts are recalculated
  when the profile changes.
- **Saving**: *Save as new preset…* in the picker saves the screen as it is. Changing anything
  after choosing a preset marks it *(changed)*, with *Save changes to …* to update it.
- Presets refer to their layout, theme and profile, so later improvements carry through. A part
  that has been deleted falls back to the default, with a note saying which.
- My View → Charts & dials lists presets with what each sets, to use, rename or delete them.
- The chart screen now reloads its charts when the active calculation profile changes (from a
  preset or from Settings).
- API: `POST /preferences/presets`, `PATCH` and `DELETE /preferences/presets/{id}`; presets are
  in `GET /preferences/appearance`.

## 1.3.0

### Appearance: themes, display options, layouts and dial sizes

- **Themes** colour the canvas, charts and dials; the app window still follows the ☀/☾ button,
  which also picks each theme's light or dark version. Built-in: Studio, Classic, Monochrome,
  High contrast and Parchment. The old chart colour choice (Studio, Classic, Monochrome) carries
  over as the matching theme.
- **Your own themes**: duplicate any theme, then edit it on a full screen with a live preview of
  a wheel (with a second chart) and a dial. Colours are grouped: canvas, chart, signs (by element as
  standard, or by modality, each sign or plain), bodies (one colour, by element, by sect or each
  body), aspects (colour and solid, dashed or dotted line each), dial (background, pointer, axis
  lines, midpoint trees), highlights and charts 2 and 3. Low-contrast warnings, "Make dark from
  light", and revert. Nothing applies until Save. Export and import as `.theme.json`.
- **Site themes** (owner): share a theme with every account and choose the theme new accounts
  start with (Settings → Site themes).
- **Display options**: text size (90–130%), symbol size, line weight, degrees (dm, dms or
  decimal), date order, 12- or 24-hour times, ℞ or R, export background (canvas, white or
  transparent) and reduce motion.
- **Layouts** fill the Layout picker: built-in Default, Clean and Teaching for the chart wheel and
  Hellenistic chart, and Default, Minimal and Clear for the dial, plus your own, made by
  duplicating one and edited with a live preview. Wheel options: zodiac band, degree scale, houses
  and numbers, angles as badges or lines, degree labels, retrograde mark, which aspect lines,
  ring spacing and symbol size. Dial options: scale density, numbers, stacked symbols, pointer
  shape, midpoint lines, trees or a one-line-per-midpoint list, and symbol size.
- **Any dial size that divides 360°**, down to 5.625°: 180°, 45°, 30°, 22.5°, 11.25°, 72° and so
  on, with the scale adapting to the size. The server's midpoint endpoint accepts them too.
- **My View** is now four tabs: Features, Appearance, Charts & dials, Bodies & points.
- **Client sheet** prints in Monochrome, or your theme's light version.
- API: `GET/PATCH /preferences/appearance`, `GET /preferences/appearance-catalog`,
  `POST /preferences/themes` (copy), `POST /preferences/themes/import`,
  `PATCH/DELETE /preferences/themes/{id}`, `POST/PATCH/DELETE /preferences/layouts…`,
  `POST /site/themes`, `DELETE /site/themes/{id}`, `PUT /site/default-theme`.

## 1.2.0

### Three schools: Modern Western, Hellenistic, Cosmobiology

- **Chart type picker.** The app bar picker lists Chart wheel, Hellenistic chart and Dial. Dial
  sizes are chosen in My View (90° on by default, 120° and 360° off); with more than one on, a
  size picker appears beside it. Anyone already on the 120° or 360° dial keeps that size. The dial
  screen offers the same sizes.
- **Hellenistic chart.** Draws the chart screen's charts (1–3, saved, new or derived) with Whole
  Sign houses, the seven planets, Ascendant, MC, Fortune and Spirit, aspects by whole sign (with
  aversion and overcoming), and the Hellenistic details in the panel: sect, the lords of each place
  (domicile, triplicity, bound, decan), own dignities, solar phase (cazimi, combust, under the
  beams, morning or evening), joys and angularity. It doesn't change the active calculation
  profile. Aspect lines show for the body you hover; the aspectarian shows them all. API:
  `?mode=hellenistic` on `GET /charts/{id}` and `GET /charts/derived/{id}`.
- **Lots.** Fortune, Spirit, Eros, Necessity, Courage, Victory and Nemesis (Paulus Alexandrinus),
  worked out in AstrologyStudio from the planets and Ascendant, in a new "Lots" group in My View.
- **Part of Fortune fix.** ephemeralREST gives the day formula for every chart. Calculation
  profiles now have a Part of Fortune choice: the same formula day and night (the default, as
  before) or reversed at night; the Hellenistic chart always reverses it.
- **Timing** in the Hellenistic chart (a panel checkbox, in the aspectarian's place): annual
  profections (ages 0–100, lord of the year, activated planets) and zodiacal releasing from Spirit
  or Fortune to level 3, with the loosing of the bond, peak periods angular from Fortune, and a
  360-day (Valens, default) or 365.25-day year, beside the chart with the signs in play marked on
  it. API: `GET /charts/{id}/profections`, `GET /charts/{id}/releasing` (`to_age` or `end`).
- **Default school** in My View: Modern Western (default), Hellenistic or Cosmobiology. Everyone
  starts with everything switched on; Hellenistic and Cosmobiology open charts on their chart type
  each visit. "Show only what this school uses" switches off the rest (`POST
  /preferences/limit-to-school`).
- **Aries Point** as a body (off by default): on wheels and dials, in midpoints and midpoint trees,
  and left out of aspect lines.
- New feature switch: Hellenistic techniques.


- The midpoint trees' scroll bar is in the app's orange.
- Larger text on the Ephemeris screen (16px, as the chart screen's positions), in the table and
  the month's events.

- **Midpoint trees in a fixed area left of the dial**, never beside or around it. The area is
  what the dial leaves, but at least two columns wide (one if two would take the dial below 80%
  of its own size); the trees flow down the columns and the area scrolls when they don't all
  fit. Their text is a little larger than the positions table on a large canvas (17px), smaller
  on a small one.

- **The aspectarian and midpoint trees size with the canvas.** The name and details, the grid's
  squares and the trees' text are all sized from the canvas, within readable limits, so
  everything scales together as the canvas or window changes size. The wheel or dial stays the
  size it is on its own whenever the grid or trees fit beside it; if they can't fit even a little
  smaller, the wheel or dial shrinks to make room, so nothing overlaps.
- Larger text in the chart screen's positions table; smaller symbols and text in the midpoint trees.

- **Transits as a derived chart.** The Derived chart tab now offers Transits for a date and time
  (local to the place; the birth place unless you choose another). ephemeralREST has no transits
  endpoint, so they're an ordinary ephemeralREST chart for that moment, listed under the chart
  they're for like the other derived charts. Derived kinds you've switched off in My View
  (transits, progressions, solar arc, returns) aren't offered, and the tab is hidden if all are.
- **120° and 360° dials in the app bar picker**, beside the 90° dial and the chart wheel.
- **Dials redrawn in Ebertin's layout, as MindForce draws them.** No sign band: the degrees round
  the outside, then the graduation with ticks standing out from its base circle, a dot on that
  circle at each body's exact place and a line in to its symbol. The pointer sits inside the
  graduation, tip on the base circle. Gold lines join the bodies whose midpoint is on the pointer
  (MindForce's rules: within the orb, the far end of the axis included, nearby bodies clustered).
  With 2 or 3 charts, chart 1 is the outer ring and the others get their own graduated rings
  inside; the selected chart's ring is tinted and gets the gold lines. The same dial is used on
  the separate dial screen. The dial is drawn in the chart wheel's colours: the numbers sit in a
  band tinted in 30° stretches like the wheel's signs (on the 360° dial they are the signs), with
  the wheel's grey lines and ticks, angles and pointer in the accent colour, and symbols a little
  smaller than the wheel's largest.
- **Midpoint trees on dials**, in the aspectarian's place: charts have the aspectarian, dials have
  midpoint trees. Each factor of the selected chart with the midpoints on its axis and their orbs,
  laid out down the left and around the dial, with symbols sized to the text. Clicking a factor puts the pointer on it. The panel
  shows the midpoint orb and the far-end option when a dial is shown (shared with the dial
  screen). The trees follow My View's Midpoints switch and body choices.

- **People can create their own accounts from the login page.** The owner switches it on under
  Settings → New accounts (off by default). Registration uses ephemeralREST's own process: the
  person gives a name and email, verifies the address and sets a password from ephemeralREST's
  emails, and receives their API key by email. They then log in with that email and password plus
  a 6-digit code sent by email, with an option to remember the browser for 28 days. Their key is
  saved automatically on first login. Existing accounts are unchanged. New API:
  `POST /api/v1/auth/register`, `POST /api/v1/auth/login/code`, `PUT /api/v1/auth/registration`;
  `/auth/status` gives `registration_open`. Migration 004 adds `users.signs_in_with`.
- **Users is owner-only.** Other people no longer see the Users page or its menu item, and
  `GET /api/v1/users` now answers 403 to anyone but the owner, so nobody else can see who has an
  account or their email address.
- **Screen choices follow the person, not the browser.** The theme, wheel or dial, layout, dial
  size, background shade, panel width, number of charts and what's in them, and the other choices
  screens remember are now kept with each person's account, so they're the same on any computer
  and two people sharing one browser no longer share them. The first person to log in on a
  browser that has choices from an earlier version gets them, and the old cookies are cleared.
  The login page uses the theme last used on that browser. New API:
  `GET` and `PATCH /api/v1/preferences/remembered`.

- **The dial shows in the chart screen's canvas.** A picker in the app bar, beside your name, switches
  the canvas between the chart wheel and the dial (at the size set on the dial screen, 90° unless
  you changed it). It holds the same charts as the wheel, chart 1 innermost, with the pointer to
  drag; the aspectarian and saving as PNG or SVG work with either. The choice is remembered. The
  picker is only on the chart screen; user-defined wheels and dials will be added to it later.
  A second picker to its right chooses the layout, remembered separately for the wheel and the
  dial; only *Default layout* for now, with user layouts to come.
- Fixed: a saved chart whose house system differs from your profile's (such as one made in
  MindForce) failed to open with an ephemeralREST that has no Google geocoding ("Location
  '-43.533330, 172.633330' not found in cities database"). It's now recalculated from the place's
  name and the exact UTC moment, with the coordinates only as a fallback; if ephemeralREST can't
  find the place either way, the chart opens in its own house system instead of failing.
- **The chart screen shows up to three charts in one wheel.** Choose 1, 2 or 3 at the top of the
  panel; each chart's panel takes a saved chart, a new chart, or a chart derived from one
  (progressions, solar arc, solar or lunar return). Click a panel to select that chart: its
  positions show below, its ring is tinted and its aspects fill the centre. The **Aspectarian**
  toggle moves the wheel to the right, at the same size as without it, and fits the aspect grid
  into the lower left without touching the wheel: each body's symbol sits on the diagonal (no
  header row). The wheel and the grid keep one size however many charts are shown and whichever
  is selected. A new set of charts is drawn only once all of them have arrived: until then the
  last complete wheel stays up with a *Calculating…* note (or, on first opening, a waiting message),
  so the wheel never appears half-filled. The panel
  holds nothing else. Choosing a chart (Change, or adding a 2nd or 3rd) opens a dialog with Saved,
  New and Derived; the selected chart's positions have a "Chart N Positions" heading, and the
  panel's text is a size larger. The links to other screens, the heliocentric view, the moving-chart
  overlays and the Aspects, Houses and Details tabs are gone from it.
- Derived charts are kept in ephemeralREST and listed under their parent chart, as MindForce does.
  New API: `POST /api/v1/charts/{id}/derived`, `GET /api/v1/charts/derived/{id}`; the chart list
  gives each chart's `derived` charts.
- The chart list has an **Edit** link on each chart; the Edit page has *Remove from my charts* and
  the chart's id for sharing.
- A slider down the right side of the chart area lightens or darkens its background and the inside
  of the chart or dial, remembered separately for the light and dark themes (double-click it to
  reset). Past halfway, the symbols and numbers inside the chart switch colour to stay readable.
  Saved PNG and SVG charts look as you see them.
- The AC, MC, DC and IC markers on the wheel are no longer cut in half at the edge: the wheel is
  drawn slightly smaller so they fit, on screen and in saved charts.
- Astrology symbols are drawn with Astronomicon by Roberto Corona (SIL Open Font License), bundled
  with the app, so they look the same on every computer and in saved PNG and SVG charts (which now
  carry the font inside them). The quintile and biquintile have proper symbols instead of letters.
- Development: in VS Code, Run and Debug → **Server** builds the web app, starts the server and
  opens the browser, all from one ▶. See `VS Code Setup.md`.

## 1.1.0

- Chart screens have one panel on the left with everything to read and set, and the chart or dial
  fills the rest of the screen, sized to fit it. The panel can be resized and remembers its width;
  a narrow panel shows the essential columns, a wider one shows them all.
- Switch charts from the panel: click the chart's name to search your charts, and stay on the
  same screen (the dial stays the dial). **+ New** is there too.
- The chart's screens (Chart, Dial, With…, Returns, Events, Harmonics, Edit) are links at the top
  of the panel. Remove is at the bottom of the Details tab.

## 1.0.0

The first release. Everything from 0.1 to 0.9, together:

- **Install**: one line on a fresh Ubuntu or Debian server, with HTTPS, daily backups and the
  `astrologystudio` command. The owner connects ephemeralREST; each person adds their own key.
- **Charts**: in ephemeralREST, organised here with folders, tags, Rodden ratings, sources and notes.
  Unknown birth times, offsets set by hand, corrections that reach everyone, shared charts.
- **The chart**: wheel, positions with dignities and houses, aspect grid and list, houses,
  heliocentric view, calculation profiles. Sidereal is ready for when ephemeralREST supports it.
- **Moving charts**: transits, progressions and solar arc as bi- and tri-wheels with time stepping.
- **Cosmobiology**: 90°, 120° and 360° dials with pointer and outer ring; midpoint trees, sort and search.
- **Two charts and returns**: synastry, composite, Davison, solar and lunar returns.
- **Time tools**: event lists, the ephemeris page, harmonic charts.
- **Output**: PNG and SVG, a printable client sheet, glyph and colour choices, and My View.

Not in 1.0, on purpose: interpretation text, astrocartography, Vedic and Hellenistic techniques,
Uranian planets, 45° and 22.5° dials, the graphic ephemeris, and importing other programs' files.

## 0.9.0

- The user guide (docs/user-guide.md).
- Long chart lists show 200 at a time, with Show more.
- Phones: the chart list and positions keep their key columns and drop the rest.
- Release workflow: version tags build the image for Intel/AMD and ARM, publish it to GHCR and create
  a GitHub release with the installer and its checksum; scripts/release-image.sh does the same by hand.
- Checked every request against ephemeralREST's own request schemas.

## 0.8.0

- Save any wheel or dial as a PNG (1600 pixels square) or an SVG, in the colours you see.
- A one-page client sheet with the wheel, positions with houses and the aspect grid, ready to print or save
  as a PDF from the browser.
- My View has its own page: every feature with what it does, bodies and points by group with all/none,
  and a reset to the defaults.
- Glyphs as symbols or as two-letter abbreviations, for screens and printers without astrological symbols.
- Three chart colour schemes: Studio (soft), Classic (bright elements) and Monochrome (for printing).

## 0.7.0

- Event lists: every exact transit, progression or solar arc aspect to a chart over a range of dates,
  timed to the minute for transits, grouped by month, with retrograde passes marked.
- The ephemeris page: a month of daily positions at noon UT, with ingresses, stations, lunations and eclipses.
- Harmonic charts for any harmonic from 1 to 180, with the usual ones a click away.
- Ephemeris, Events and Harmonics follow My View: switch them off and they disappear.

## 0.6.0

- Synastry: two charts as a bi-wheel, with a square aspect grid and a list of the aspects between them.
- Composite charts by the midpoint method, houses included.
- Davison charts at the midpoint in time and space, calculated by ephemeralREST.
- Solar and lunar returns from ephemeralREST, for the birth place or anywhere else, with the natal chart
  around them if you want it.
- "With…" and "Returns" buttons on every chart, shown only when those features are switched on.

## 0.5.0

- Cosmobiology dials: 90°, 120° and 360°, with 0° at the top and the dial running anticlockwise.
- A pointer you can drag, or put on a body by clicking it, listing every natal factor and midpoint on its
  axis, including the far end (45° on the 90° dial) when you want it.
- An outer ring for transits, solar arc directions or progressions, with time stepping, and the moving
  bodies that fall on the pointer.
- Midpoint trees for any factor, the full midpoint sort in dial order, and midpoint search by degree
  ("12.5", "12°30'" or "12°30' Leo") for directions and rectification.
- An orb for the dial (1.5° to start) and the dial size are remembered.
- Midpoints are worked out in AstrologyStudio from ephemeralREST's positions; ephemeralREST needed no change.

## 0.4.0

- Transits, secondary progressions and solar arc directions around any chart, as a bi-wheel or tri-wheel.
- Step the moment back and forward by a minute, hour, day, week, month or year; the wheel updates as you go.
- Aspects from each moving layer to the natal chart, with a largest orb set per profile (1° to start).
- Transiting angles for the birth place; progressed angles by solar arc on the Midheaven.
- Moving charts are read from ephemeralREST's monthly ephemeris and kept in this install, so stepping
  through time saves nothing in ephemeralREST and repeats cost nothing.

## 0.3.0

- The chart wheel: zodiac, houses with the angles marked, bodies spread so they never overlap, and aspect lines.
- Positions with speed, latitude, declination, house and essential dignities; hover a row to pick out the body on the wheel.
- Aspects: an aspect grid and a list ordered by orb, with applying and separating.
- Houses: each cusp and the size of each house.
- Calculation profiles: house system, zodiac and an orb for each aspect, in named profiles you can switch between on any chart.
- Heliocentric view of any chart, with Earth and without houses, angles or the Moon.
- Sidereal zodiac and ayanamsa can be chosen and saved; positions stay tropical until ephemeralREST supports it.

## 0.2.0

- Charts: calculate and save new charts in ephemeralREST, with every body and point calculated.
- Unknown birth times (set for noon) and a UTC offset set by hand for wartime or local mean time.
- Place suggestions from ephemeralREST as you type; coordinates work too.
- Your chart list from ephemeralREST, with search by name, date, place, tags, source and notes.
- Folders, tags, Rodden ratings, source and notes, kept in this install.
- Correcting a chart's birth data recalculates it under the same id, so everyone who has it sees the correction.
- Add a chart someone shared by pasting its id or link; remove charts from your list.
- A chart page with positions, speed, latitude and declination, and the time-zone details used.
- Choose your house system; a different house system never changes the saved chart.

## 0.1.0

- One-line installer with automatic HTTPS, daily backups and the `astrologystudio` command.
- Owner account on first run; the owner adds other people.
- The ephemeralREST address is set once for the install and checked before it's saved.
- Each person saves their own ephemeralREST API key, checked with ephemeralREST and stored encrypted.
- My View: switch major features and individual bodies and points on or off.
- Light and dark themes in the Studio look.
