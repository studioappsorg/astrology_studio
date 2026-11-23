# AstrologyStudio user guide

AstrologyStudio is a self-hosted astrology app with everything that's needed and nothing
that isn't. Every calculation, and every chart you save, lives in
[ephemeralREST](https://github.com/gmelh/ephemeralREST). AstrologyStudio is the screens and
the working tools around it.

## Getting started

1. **Create the owner account.** The first person to open a new install becomes its owner.
2. **Connect to ephemeralREST** (owner only): Settings → ephemeralREST address. The address is
   checked before it's saved. The installer can set it for you with `--ephemeral`.
3. **Add your API key**: Account → Your ephemeralREST key. Each person uses their own key; it's
   checked with ephemeralREST, then stored encrypted. Your key is in the email ephemeralREST
   sent when you set your password.

Add other people under Users. Only the owner sees that page. Each person has their own charts, folders and
settings.

### Letting people create their own accounts

The owner can switch on Settings → New accounts → *Allow new people to create accounts* (off by
default). The login page then shows **New here? Create an account**:

1. Enter your name and email. ephemeralREST emails a link to verify the address.
2. A second email has a link to set your password. Once it's set, a third email brings your API
   key. Keep it safe; AstrologyStudio saves it for you when you first log in.
3. Log in with that email and password. A 6-digit code is emailed to you; enter it to finish.
   Tick *Remember this browser for 28 days* to skip the code next time.

These accounts use their ephemeralREST password, so it's changed in ephemeralREST, not under
Account. They're marked *ephemeralREST* under Users. Switching registration off again stops new
sign-ups only; people who already have accounts still log in.

## Finding your way around

AstrologyStudio is laid out like a desktop program, and the browser page itself never scrolls:

- **Title bar and menus** across the top. *File* (new chart, open, add a shared chart, the chart
  library, close the tab, account, log out), *View* (chart type, status bar, dark mode, tabs,
  Your view), *Chart* (the chart's own screens: with another chart, returns, client
  sheet, edit), *Tools* (Ephemeris, Your view, Settings, Users) and *Help*. On the chart screen the
  Preset, Chart type and Layout pickers sit at the right, with the ☀/☾ light/dark switch and your
  account menu.
- **Finding a chart**: the **Chart library** (File → Chart library, the logo, or Ctrl+K, which
  also puts the cursor in its search). Click a chart to open it in its own tab.
- **Tabs** over the work area. Every chart and screen you open gets a tab, and a tab remembers
  where you were in it (a chart's Returns screen, say). Click a tab to go back to it; × or a
  middle-click closes it. Drag a tab to move it along the row, as in a browser. The **Chart
  library** is always the first tab and can't be closed or moved; the app opens on it, and closing
  every other tab brings you back to it. Switching chart from a chart's own panel keeps the same
  tab. Your open tabs, in their order, are remembered with your other choices.
- **Status bar** along the bottom: whether ephemeralREST is answering (checked every five minutes;
  click the dot to check now), what's open, how many charts you have and the version.
- **Phones**: the tabs and a chart's views row scroll sideways, and the status bar is hidden.

| Shortcut | Does |
| --- | --- |
| Ctrl+K (⌘K) | Find a chart (the chart library, with the cursor in its search) |
| Alt+N (⌥N) | New chart |
| Alt+W (⌥W) | Close the tab |
| Alt+] and Alt+[ | Next and previous tab |
| Ctrl+, (⌘,) | Settings |
| ? | The list of shortcuts (Help → Keyboard shortcuts) |

## Charts

- **New chart** opens a dialog in the middle of the screen: name, date, time and place, the
  house system, and the folder, tags, rating, source and notes. Tick *Time unknown* to set the
  chart for noon. The place starts as your default location (Settings → Defaults), if you have
  one. Place suggestions come from ephemeralREST as you type; coordinates such as `-31.95, 115.86`
  work too.
- **Tags** are badges: type one and press Enter (or a comma) to add it, and × or Backspace takes
  one off. Tags you've used before are suggested as you type. They show as badges in the chart
  library, where clicking one under *Tags* shows only the charts that have it.
- **House system**: *Default* follows your calculation profile, or your default house system if
  the profile hasn't one of its own. Choose a particular system and that chart always uses it,
  whatever the profile. Change it later with *Edit* (only the houses are recalculated).
- **UTC offset**: normally looked up for the place and date. For wartime, local mean time or
  anywhere the automatic answer is wrong, tick *Set the UTC offset myself* and enter it, e.g. `+10:00`.
- **Correcting a chart** (Edit): changing the date, time, place or offset recalculates the chart in
  ephemeralREST under the same id, so everyone who has it sees the correction. Changing the name,
  folder, tags, rating, source or notes doesn't recalculate anything.
- **Organising**: folders, tags, Rodden ratings, source and notes are kept in this install. Search
  matches name, date (e.g. `1985-06`), place, tags, source and notes.
- **Sharing**: copy a chart's id from its Edit page. Anyone using ephemeralREST (AstrologyStudio,
  MindForce, cosmobiology.online) can add it with *Add a shared chart*.
- **Removing** a chart takes it off your list only; it stays in ephemeralREST for anyone else who has it.

## The chart screen

A bar of **report tabs** runs across the top of every chart, centred: **Chart**, **Aspects**,
**Midpoints**, **Hellenistic** and **Events** (each of the last three only when its feature is
switched on in Your view). The bar sits over the chart only. The panel on the left runs from the
top, beside it, and holds the selected chart's positions and nothing else. Under the bar, on the
canvas, are the two charts: **chart 1** to the left of the wheel or dial and **chart 2** to the
right (above it in a row when the window isn't wide enough, and above every report).
The report tab you're on is remembered, and presets set it too.

The chart type picker in the title bar (or View in the menus) switches the Chart tab between the
**chart wheel**, the **Hellenistic chart** and the **dial** (each only when its feature is switched
on in Your view). The dial is 90° unless you switch on other sizes under Your view → Charts & dials;
with more than one size on, a second picker beside the chart type chooses the size. The **Layout**
picker next to them chooses how the chart type is drawn (see *Layouts* below). Drag the panel's
edge to widen or narrow it; double-click the edge to put it back.

- **One chart or two.** **Chart 1 (inner)** is normally the natal
  chart: it's the inner ring and gives the wheel its houses and angles. **Chart 2 (outer)** goes
  round it in its own colour: transits, progressions, a return, or another person's chart for
  synastry. The dial is the same way round: chart 1 inside, chart 2 outside. With one chart, the
  right-hand card offers **＋ Add a chart**; × on chart 2 goes back to one chart.
- **Chart cards**: one per chart. *Change* (or *Add a chart*) opens a dialog to fill it with:
  - **Saved**: any of your charts. Charts derived from one are listed under it.
  - **New**: name, date, time and place. It's calculated in ephemeralREST and added to your charts.
  - **Derived**: transits for a date and time, progressions or solar arc directions to a date, or
    a solar or lunar return, a harmonic chart, or the composite or Davison chart of two charts,
    worked out from one of your charts (chart 1's, unless you choose another). Only the kinds
    switched on in Your view are offered. ephemeralREST keeps it, and it's listed under its chart
    from then on, here and in other apps that use your ephemeralREST chart list, such as MindForce.
    Composite and Davison charts are kept under the *From* chart too (and worked out from the two
    charts each time they're shown); removing either of their charts removes them. Harmonic charts
    are the exception: they're worked out from their chart each time and aren't added to your list.
- **Selecting a chart**: click its card. Its positions show in the panel, under *Chart N
  Positions*, with columns for the body, its longitude and its house (no house column while the
  dial is showing, as a dial has no houses); its ring is tinted, the aspect lines in the centre of the wheel are its own (only
  aspects between its own bodies are drawn, never between the two charts), and the
  Aspects and Midpoints reports are for it.
- **Background slider** (Chart tab): down the right-hand side, lightens or darkens the canvas and
  the inside of the wheel, starting from your theme's colours. Double-click it to go back to the
  theme's own.

### Views

A chart can be looked at in more than one way in its tab, for example as a Western wheel, as a
90° dial, and with John Smith outside it for synastry. Each way is a **view**.

- **＋ View** (at the right of the report tabs) adds one:
  - a copy of this view
  - as a chart wheel, a dial or a Hellenistic chart
  - with another chart…
  - with transits now
  - with progressions or solar arc to today
  - with this year's solar return

  Ones that need a chart worked out make it straight away, as Change → Derived chart would, and
  it's listed under the chart.
- With two or more views, a **views row** appears above the report tabs. Click a view to switch to
  it in place. Each view's × closes it (or press Delete on it). Right-click one to rename,
  duplicate, move or close it, or drag it along the row.
  A chart can have up to six views.
- **Each view keeps its own:**
  - chart type and dial size
  - layout
  - chart 2
  - report tab
  - selected chart
  - *Between 1 and 2*
  - dial pointer

  The midpoint orb, *Include 45°* and *Modern bodies* are shared by every view.
- The title bar's **Chart type**, **Dial size** and **Layout** pickers change the view on screen
  only. What you pick there is also what a new view starts with.
- Views are labelled from what they show (*Western*, *Dial 90°*, *+ John Smith*, *Dial 90° +
  Transits*) unless you rename them.
- Views are kept on the server for your 300 most recently changed charts, so they follow you
  between devices. A chart without any opens with one view made from your last choices.

### The reports

- **Aspects**: the aspectarian (each square shows the aspect and its orb, with applying (a) or
  separating (s)) and the list of aspects, closest first, side by side, each half the width (one
  above the other when the window is narrow). With two charts, choose *Chart 1*,
  *Chart 2* or *Between 1 and 2* (synastry, transits to natal and so on): between has chart 1's
  bodies down the side and chart 2's along the top. The chart itself only ever draws the aspects
  between the selected chart's own bodies, whichever you choose here. Orbs and which aspects count come from your calculation profile. On
  the Hellenistic chart, aspects are by whole sign.
- **Midpoints** (for the selected chart, in the dial size in use): *Midpoint sort* and *Search* on
  the left, and the midpoint trees on the right. The sort lists everything *Round the dial*, in
  order from 0°, or *Closest to exact*: each midpoint within orb of a factor, with that factor,
  the tightest first. The orb and *Include 45°*
  (half the dial's size on other dials) are at the top and apply to the dial's gold lines too.
  Clicking a row in the sort, a search result or a tree's factor moves the dial's pointer, so it's
  there when you go back to the Chart tab.
- **Hellenistic** (chart 1): sect, and each body with the lords and dignities of its place,
  whole-sign houses, and timing (profections and zodiacal releasing), in two cards of the same
  width. See below.
- **Events** (chart 1, which has to be a saved chart): every exact transit, progression or solar
  arc aspect to it over a range of dates, by month. Hovering an event picks out its natal body in
  the positions. Click the symbols to choose which bodies move (*Transiting*, *Progressed* or
  *Solar arc*) and which natal ones they aspect (*To natal*); *All*, *None* and *Usual* are beside
  each line. Usual is every body switched on in Your view, except that transits leave out the
  Moon, and transits and progressions leave out the angles and lots (solar arc moves those too).
  Your choices are remembered, separately for each kind of event.

Each chart remembers its views (below): chart 2, the chart type, the report tab and the dial
pointer come back as you left them, on any device. Opening a chart from your list puts it in chart 1. To edit a chart, remove it or copy its id to share it, use **Edit** beside
it in your chart list (or Chart → Edit details). It opens as a dialog over the chart, like New chart.

The Returns screen is still at the chart's address with `/returns` added, and With… at `/with`
(it has synastry's aspect list, too). The old `/dial` and `/events` addresses open the chart screen
on the dial, or on the Events tab.

### Dials

The dials follow Ebertin's layout, as in MindForce, in the chart wheel's colours: 0° at the top
running anticlockwise, the degrees in a tinted band round the outside, and the graduation with a
dot for each body's exact place and a line in to its symbol. With two charts, chart 2 has the
outer ring and chart 1 (the natal chart) a smaller ring inside it with its own graduation, as on
the bi-wheel; the selected chart's ring is tinted.

- **The pointer** sits inside the graduation. Drag it, or click a body to put it there. Its far
  end is the other end of the axis (45° on the 90° dial).
- **Gold lines** join the bodies of the selected chart whose midpoint is on the pointer, within
  the midpoint orb (set on the Midpoints tab). Bodies close together share one end, so a cluster
  gives one line.

### The Hellenistic chart

Choose **Hellenistic chart** in the chart type picker to draw the same charts (one or two, saved,
new or derived) the Hellenistic way. Your calculation profile isn't changed: switch back to the
chart wheel and its houses and aspects return.

- **Houses** are Whole Sign houses, counted from the Ascendant's sign.
- **Bodies** are the seven traditional planets, the Ascendant and MC, and the Lots of Fortune and
  Spirit, with the other lots if they're switched on in Your view. *Modern bodies* (under the chart,
  or on the Hellenistic tab) adds the outer planets and the other bodies you have switched on.
- **Aspects are by whole sign**: planets in signs 2, 3, 4 or 6 apart aspect each other whatever
  the degrees, and planets in signs 1 or 5 apart are in aversion. Hover a body to see its aspects;
  the Aspects tab shows them all, with an arrow beside the body that overcomes in a square, and
  aversion hatched.
- **The Hellenistic tab** says whether it's a day or night chart, the sect light, and the benefic and malefic
  of sect (with a warning if the Sun is right on the horizon). Under each body are the lords of its
  place (domicile, triplicity for the chart's sect, bound and decan, in that order), its own
  dignities, its phase with the Sun (cazimi within 0°17′, combust within 8°30′, under the beams
  within 15°, morning or evening) and whether it's in its joy. The house number carries A, S or C
  for angular, succedent or cadent.

The lots follow Paulus Alexandrinus: Fortune, Spirit, Eros, Necessity, Courage, Victory and
Nemesis, each reversed in a night chart. The triplicities are Dorothean and the bounds Egyptian.

### Timing: profections and zodiacal releasing

On the **Hellenistic** tab, beside sect and dignities. Chart 1's years or periods are listed, and
the signs in play are marked on the Hellenistic chart when you go back to the Chart tab. Choose
the technique at the top:

- **Profections**: the sign and lord of each year of life from birth to 100, with the current year
  picked out, the natal planets it activates, and where it falls from the Ascendant and Fortune.
  Each year runs from birthday to birthday. Click a year to mark its sign and lord on the chart.
- **Zodiacal releasing** from the Lot of Spirit or Fortune. Each level 1 period opens into its
  level 2 periods, and each of those into level 3. *Peak* marks a period in the 10th sign from
  Fortune, and 1st, 4th and 7th the other angular signs; *loosing* marks a loosing of the bond.
  The current periods are picked out and marked on the chart. The year is 360 days (Valens) by
  default, or 365.25 days.

## Cosmobiology

**Dial** on any chart opens the dial in the sizes you have switched on (90° by default). Drag the pointer, or click a body to put
the pointer on it. The gold lines on the dial join every natal factor and midpoint on its axis, including
the far end (45° on the 90° dial) when *Include* is ticked. The outer ring (chart 2) can show transits,
solar arc directions or progressions round the natal chart.

- **Midpoint tree**: everything on a factor's axis, closest first.
- **Midpoint sort**: every factor and midpoint in dial order, or the midpoints closest to exact on a
  factor first.
- **Search**: everything within orb of a degree, written as `12.5`, `12°30'` or `12°30' Leo`.

## Two charts, returns, events and harmonics

- **Composite and Davison charts**: on the chart screen, *Change* → *Derived chart* → *Composite*
  or *Davison*, then choose the second chart. The composite chart is the midpoint of each pair of
  positions, house cusps included. The Davison chart is the chart for the moment and place midway
  between the two births. An ephemeralREST without Google geocoding finds places by name only and
  can't use the midpoint's coordinates; it then says so, and you can enter the nearest town under
  *Where*. Either goes in any chart slot, so you can put one round a natal chart, or read its
  midpoints on the dial.
- **Aspects between charts**: on the chart screen, put the other chart in chart 2 and choose
  *Between 1 and 2* on the Aspects tab, which then shows the square grid between them. The older
  With… screen (the chart's address with `/with`) also lists them.
- **Returns**: solar and lunar returns for any year (and month), at your default location, the birth place or elsewhere,
  with the natal chart around them if you like.
- **Events**: the Events tab. Every exact transit, progression or solar arc
  aspect to chart 1 over a range of dates: up to two years of transits, or a hundred years of
  progressions and solar arcs.
- **Harmonics**: on the chart screen, choose *Change* on a chart (or add a 2nd chart), then
  *Derived chart* → *Harmonic*, and a harmonic from 1 to 180 (H4, H5, H7, H9 and H16 are one
  click). Every position is multiplied by that number, so conjunctions in it are that harmonic's
  aspects in the chart. Put it in chart 2 to see it round the natal chart, or alone in chart 1.
  It works on the chart wheel, the Hellenistic chart and the dial. Harmonic charts have no houses.
- **Ephemeris** (Tools → Ephemeris): a month of daily positions with ingresses, stations, lunations
  and eclipses.

## Your view and profiles

- **Your view** (View → Your view, or Tools) has five tabs. It only changes what you see.
  - **Features**: switch major features on or off, and choose your default school (below).
  - **Appearance**: your theme and display options (see *Appearance* below).
  - **Charts & dials**: dial sizes and layouts.
  - **Bodies & points**: switch individual bodies and points on or off.
  - **Aspects**: which aspects you use, their orbs and their colours. An aspect switched off isn't
    drawn on any chart or listed in any report (aspect grids and lists, synastry, Hellenistic
    aspects by sign, events). *All*, *Major only* and *None* set them all at once. On/off and orbs
    belong to your active calculation profile (the same settings as Settings → Calculation
    profiles), so a preset that changes profile changes them too. Each aspect's colour is yours,
    over whichever theme you use, in light and dark mode alike; *Theme colour* goes back to the
    theme's. *Show each aspect's symbol in the middle of its line* puts the aspect's symbol on
    each aspect line of the chart wheel and Hellenistic chart (where the middle is taken, as every
    opposition crosses the centre, it slides along the line).
- **Default school** (Your view): Self-selected (the first and the default), Modern Western,
  Hellenistic or Cosmobiology. Choosing a school doesn't switch anything on or off by itself.
  - **Self-selected** is tied to no school: you mix and match techniques from all of them. New
    accounts start with the most common techniques switched on (transits, progressions, solar arc,
    returns, synastry, composite charts, midpoints, event lists and the ephemeris, with the ten
    planets, Chiron, the mean node and the angles); switch on whatever else you need under
    Features and Bodies & points. Charts open where you left them. *Back to the most common
    techniques* resets the switches to that starting set (it asks first).
  - With **Modern Western**, **Hellenistic** or **Cosmobiology**, charts open on that school's chart
    type (the chart wheel, the Hellenistic chart or the dial) each visit. *Show only what … uses*
    switches off the features and bodies that school doesn't use (it asks first, and you can
    switch anything back on).
- **Defaults** (Settings): your **default house system**, for calculation profiles set to *My
  default* and charts set to *Default*, and your **default location**, where you usually are.
  New charts start with that place, and transits, solar returns and lunar returns are worked out
  for it unless you give another place. Progressions and solar arc stay at the birth place.
  Before 1.15 every profile had its own house system, Placidus unless you changed it; profiles
  that had Placidus now follow your default (Placidus unless you change it).
- **Calculation profiles** (Settings): house system (*My default*, or one of its own, such as
  Whole Sign for a Hellenistic profile), zodiac and an orb for each aspect, the
  largest orb for moving charts, and the Part of Fortune: the same formula day and night (the
  default), or reversed at night as tradition has it. Keep several and switch between them on any
  chart.
- **Sidereal zodiac**: the choice and the ayanamsa are saved, but positions stay tropical until
  ephemeralREST supports ayanamsas. The chart says so when this applies.

Your view, your themes, layouts and presets, your profiles and everything the screens remember (light or dark, chart type, layout,
background shade, panel width, which charts are on the wheel) belong to your account, so they're
the same on any computer you log in from. The ephemeralREST address and whether new people can
create accounts are the owner's settings and apply to everyone, as are the shared themes and the
theme new accounts start with.

## Appearance

### Themes

A theme colours the canvas, charts and dials: the background round the chart, the inside of the
wheel or dial, the zodiac band, bodies, aspect lines, the pointer and midpoint trees, and the
highlights. It doesn't change the app window (title bar, panels, menus, forms): the ☀/☾ button in
the title bar still switches that between light and dark. Every theme has a light and a dark
version, and the same button picks which one you see.

Your view → Appearance shows each theme on a sample chart. Click one, or *Use*, to switch to it.

- **Built-in themes**: Studio (the standard look), Classic (bright element colours), Monochrome
  (for printing), High contrast and Parchment. They can't be changed, but you can copy them.
- **Your own themes**: *Duplicate* any theme to make your own copy, then *Edit* it. You can also
  *Delete* your own themes.
- **Sharing**: *Export* saves a theme as a small `.theme.json` file; *Import theme…* adds one
  someone has sent you.
- **For everyone** (owner only): *Share with everyone* on one of your themes makes a copy that every
  account here can choose. Under Settings → Site themes, the owner sees the shared themes, can stop
  sharing one, and chooses the theme new accounts start with. People who have already chosen a
  theme keep theirs.

**The theme editor.** Colours are grouped, each group opening with a click: Canvas, Chart, Signs,
Bodies, Aspects, Dial, Highlights and Multi-chart. On the right is a live preview: a sample wheel
with a second chart round it, and a 90° dial.

- *Light* and *Dark* switch which version you're editing. *Make dark from light* (or the other way
  round) works out the other version from this one, as a starting point to adjust.
- **Signs** are coloured by element as standard; you can colour them by modality, give each sign
  its own colour, or leave the band plain.
- **Bodies** can be one colour, coloured by the element of the sign they're in, by sect (the day
  sect's Sun, Jupiter and Saturn; the night sect's Moon, Venus and Mars; Mercury with the day sect
  as a morning star), or each body its own colour. This is chart 1's colour; charts 2 and 3 use
  their colours under Multi-chart.
- **Aspects**: a colour and a solid, dashed or dotted line for each aspect. *All hard, soft,
  neutral* sets every aspect of a kind at once.
- **Low contrast** warnings appear beside text colours that would be hard to read against their
  background (they're warnings; you can still save).
- Nothing changes anywhere else until you press *Save*. *Revert to …* puts every colour back to the
  built-in theme it was copied from.

On the dial, the focused body is drawn in the pointer axis colour, as in MindForce.

### Display options

Under the themes in Your view → Appearance:

- **Symbols**: astrological symbols, or two-letter abbreviations.
- **Text size**: 90%, 100%, 115% or 130% for the whole app, charts included.
- **Symbol size** on charts and dials: small, medium or large.
- **Line weight**: fine, normal or bold. Bold suits projectors and printing.
- **Degrees**: 21°14', 21°14'32" or 21.24°. Degrees are always rounded down, so a body at
  29°59'59" is never shown at 30°.
- **Dates**: 1985-06-12, 12/06/1985 or 06/12/1985. **Times**: 24-hour or 12-hour.
- **Retrograde**: ℞ or R.
- **Background of saved PNG and SVG**: the canvas as you see it, white, or transparent.
- **Reduce motion**: no animated transitions.

### Layouts

A layout is what a chart type draws. Each chart type (chart wheel, Hellenistic chart and dial) has
its own layouts, chosen from the **Layout** picker on the chart screen or under Your view →
Charts & dials.

- **Built-in**:
  - Chart wheel and Hellenistic chart: *Default*, *Clean* (no degree scale or labels, no house
    numbers) and *Teaching* (large symbols, degrees and minutes, roomy rings).
  - Dial: *Default* (Ebertin's layout, as in MindForce), *Minimal* (numbers at the quarters, a plain
    pointer) and *Clear* (large symbols, stacked when crowded, midpoints listed one per line).
- **Your own**: *Duplicate* any layout, then *Edit* it with a live preview.
  - Chart wheel options: the zodiac band, the degree scale, houses and house numbers, the angles as
    badges or lines, the degree beside each body, the retrograde mark, which aspect lines to draw
    (all, hard only, only for the body under the pointer, or none), room for bodies, and symbol size.
  - Dial options: the scale (normal, fine, or numbers only), numbers at every mark or just the
    quarters, crowded symbols spread or stacked, the pointer's shape, the lines joining midpoints,
    midpoint trees or a list, and symbol size.

The Hellenistic chart's Default layout draws aspect lines only for the body under the pointer,
because aspects by sign would fill the centre.

### Presets

A preset is the **set of views a chart opens with** (see *Views* above), plus the theme and
calculation profile to use. For example: "Full reading" might be a Western wheel, a 90° dial, and a
dial with transits now. Use the **Preset** picker at the right of the title bar on the chart screen.

- **Using one** (choose it in the picker):
  - **One view**: changes the view on screen. Its chart type, dial size, layout and report change,
    and chart 2 too unless the preset has none.
  - **Several views**: the chart gets the preset's views, in the same tab. If the chart already has
    several views, it asks the first time whether to **replace** them or **add** the preset's after
    them. Tick *Remember my choice* to stop it asking. Change the choice later in Your view →
    Presets.
  - The theme and calculation profile switch too, and charts are recalculated if the profile is
    different. Dial sizes the preset uses are switched on if they were off.
- **Chart 2 in a preset** is what chart 2 *is*, so a preset works for any chart:

  | In the preset | When it's used |
  |---|---|
  | none | one chart |
  | ask each time | the chart dialog opens on that view so you can choose (a partner, say) |
  | transits now, progressions or solar arc to the day, the year's solar return, the month's lunar return | worked out for that moment, straight away |
  | always a particular chart | that chart, e.g. a mundane or event chart you always compare with |

- **Saving one**: set up a chart's views, then choose *Save this chart's views as a preset…*. Name it,
  untick any views to leave out, and for each view with a chart 2 choose whether the preset keeps
  its **kind** (*Ask each time*, or *Transits now* for transits worked out for now) or **always
  that chart**. *Open new charts with this preset* makes it your default (below).
- **Changing one**: when a chart's views no longer look like its preset's (a different chart type,
  dial size or layout, a view added or closed, or chart 2 added or removed), the picker shows
  *(changed)*. Choose *Save changes to …* to keep them, or save a new preset. Moving between report
  tabs doesn't count as a change.
- **Default preset**: charts that have no views yet open with it. For example, every chart you
  open shows Western, Dial and Transits now. Charts you've already looked at keep their views.
- **From ＋ View**: *From a preset* adds a preset's views after the chart's own.
- **Your view → Presets** lists every preset with its views. There you can:
  - **Edit** a preset: its name, theme (or keep the theme in use), calculation profile (or keep the
    profile in use), and each view's name, chart type, dial size, layout, report tab, chart 2 and
    *Between 1 and 2*. Views can be added (up to six), removed and moved up or down.
  - **Duplicate**, **move up or down** (the order the picker lists them in) and **delete** presets.
    Deleting a preset doesn't change any chart's views.
  - Choose **New charts open with**: a preset, or one view from your last choices.
  - Choose what happens when **a preset with several views meets a chart with several**: ask each
    time, replace, or add after.

  *Manage presets…* in the picker opens this tab.

A preset points to its layouts, theme and profile rather than copying them, so improving a layout
improves every preset that uses it. If one of them has been deleted, the preset uses the default
for that part and says so.

### Dial sizes

Under Your view → Charts & dials, switch on any of 360°, 180°, 120°, 90°, 45°, 30°, 22.5° and
11.25°, or add another size. A size must divide the circle evenly (72°, 60°, 40°, 36°, 24° and so
on), down to 5.625°. The scale adapts to the size: 1° marks on the 90° dial, ¼° marks numbered
every degree on the 22.5° dial, and so on. On dials under 60° the band is tinted in thirds.

## Printing and saving

Under each wheel and dial: **PNG**, **SVG**, and **Client sheet**, a one-page sheet with the wheel,
positions and aspect grid. Use *Print or save as PDF* on the sheet. The sheet is printed in
Monochrome unless you choose your own theme's light version with *Colours* at the top. Saved PNG
and SVG files use the background chosen under Your view → Appearance.

## Your account

Your account menu (your initial and name, top right) → Account, or File → Account:

- **Your data**: *Download my data* saves one JSON file with everything AstrologyStudio keeps for
  you: your chart list (birth details, and what each derived chart was worked out from), notes,
  folders, ratings and tags, and every setting, theme, layout and preset. Your ephemeralREST key
  isn't in it.
- **Delete your account**: removes your account and everything kept here for you, and logs you out
  everywhere. Confirm with your password (or, if you log in through ephemeralREST, by typing your
  email address). *Also delete my charts* takes every chart off your chart list too; otherwise they
  stay there, for other apps you use them in. The owner's account can't be deleted this way,
  because it runs the install.

## Phones

AstrologyStudio works at phone width. The title bar puts the preset, chart type and layout pickers on
a row of their own. On the chart screen the report tabs come first (symbols only, apart from the one in use), then
the two chart cards side by side, the chart or report, and the positions panel below that. Your view and the theme and layout editors
stack their parts in one column.

## Running the install

The installer adds an `astrologystudio` command on the server:

| Command | What it does |
| --- | --- |
| `astrologystudio status` | Is it running and answering? |
| `astrologystudio update` | Back up, then update to the latest version |
| `astrologystudio backup` | Back up now (a daily backup keeps two weeks) |
| `astrologystudio restore FILE` | Restore a backup (backs up first) |
| `astrologystudio reset-password EMAIL` | Give someone a new password |
| `astrologystudio logs` | Follow the logs |

**A hosted service.** Set `ASTROLOGYSTUDIO_HOSTED=1` in the install's `.env` (then `astrologystudio
restart`) when you run AstrologyStudio for the public. People who sign up never see ephemeralREST:

- The login and sign-up pages don't mention it.
- There's no key or connection to set up; their key is saved when they first log in.
- Messages that would name it say "the chart service" instead.

You, the owner, still see everything. The verification and password emails, and the page where
people choose a password, come from ephemeralREST itself, so give them your service's name there.

A backup holds the database and the secret key that encrypts everyone's stored ephemeralREST
keys. Keep them together: without the secret key, everyone has to enter their key again.
