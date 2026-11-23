/**
 * AstrologyStudio ·
 * web/src/pages/ChartView.tsx
 *
 * The chart screen:
 *
 * one or two charts in one wheel or dial (chart 1 inside), with report tabs across the top.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { api, type ChartData, type ChartDetail, type ChartSummary, type DerivedDetail, type FoundAspect, type HellenisticBlock, type Point } from '../api';
import { ASPECT_INFO, BODY_LETTERS, degrees, dignities, dm, HOUSE_SYSTEM_NAMES, houseOf, midpointTrees, signed, textGlyph, zodiac, zodiacLong } from '../astro';
import { AspectGrid } from '../components/AspectGrid';
import { TimingControls, TimingPane } from '../components/Timing';
import { ChartModal, derivedLine, SlotCard, type SlotRef } from '../components/ChartSlots';
import { ExportButtons } from '../components/Export';
import { Workspace } from '../components/Workspace';
import { Wheel, type WheelRing } from '../components/Wheel';
import { Dial } from '../components/Dial';
import { sizeLabel, useLayout, useSchoolStart, type Report } from '../display';
import { useLayouts, PROFILE_CHANGED } from '../appearance';
import { newViewId, rememberDefaults, setActiveView, useChartViews, type ChartViewsHandle, type View } from '../views';
import { isBoolean, usePref } from '../prefs';
import { Link, navigate } from '../router';
import { Checkbox, Notice, useLoad } from '../ui';
import { AddView, ViewsRow } from '../components/ViewsRow';
import { useView } from '../view';
import { date as fmtDate, retroMark, time as fmtTime } from '../fmt';
import { MidpointPanel } from '../components/Midpoints';
import { aspectsBetween, type AspectSettings } from '../aspects';
import { EventsPane } from '../components/Events';

export function ChartView({ id }: { id: string }) {
  return <ChartScreen id={id} />;
}

/** Body keys to show, in catalog order, for the geocentric or heliocentric view. */
export function useShownKeys(points: Record<string, Point>, helio = false): string[] {
  const { catalog, body } = useView();
  return catalog.bodies.filter((b) => body(b.key) && points[b.key] && !(helio && b.group === 'Angles')).map((b) => b.key);
}

export function useGlyphs(): Record<string, string> {
  const { catalog, display } = useView();
  if (display.glyphs === 'letters') return { ...BODY_LETTERS };
  const glyphs: Record<string, string> = { earth: '♁' };
  for (const b of catalog.bodies) glyphs[b.key] = b.glyph;
  return glyphs;
}

/** A chart in a slot, in one shape whether it's a saved chart or a derived one. */
interface SlotChart {
  id: string;
  name: string;
  line: string;
  /** The chart the page's address names: itself, or the parent of a derived chart. */
  home: string;
  points: Record<string, Point>;
  houses: number[] | null;
  aspects: FoundAspect[];
  /** Sect, lords, solar phase and whole-sign houses, when drawn as a Hellenistic chart. */
  hellenistic: HellenisticBlock | null;
}

/** The bodies a Hellenistic chart shows: the seven planets (unless switched off in Your view),
 * the Ascendant and MC, Fortune and Spirit always, and the other lots if switched on. */
const SEVEN = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'];
const HELLENISTIC_ALWAYS = new Set(['asc', 'mc', 'part_of_fortune', 'lot_spirit']);

/** One chart, or two (chart 2 outside chart 1). */
type Count = 1 | 2;
const isOrb = (v: unknown): v is number => typeof v === 'number' && v > 0 && v <= 5;

function loadSlot(ref: SlotRef | null, hellenistic: boolean): Promise<SlotChart | null> {
  if (!ref) return Promise.resolve(null);
  const query = hellenistic ? '?mode=hellenistic' : '';
  if (ref.derived) {
    return api<DerivedDetail>(`/charts/derived/${ref.id}${query}`).then((d) => ({
      id: d.id, name: d.name, line: derivedLine(d), home: d.parent_id ?? ref.parent ?? d.id,
      points: d.points, houses: d.houses, aspects: d.aspects, hellenistic: d.hellenistic ?? null,
    }));
  }
  return api<ChartDetail>(`/charts/${ref.id}${query}`).then((c) => ({
    id: c.id, name: c.name, line: birthLine(c), home: c.id, points: c.points, houses: c.houses, aspects: c.aspects,
    hellenistic: c.hellenistic ?? null,
  }));
}

/**
 * One or two charts in one wheel or dial: chart 1 (normally the natal chart) inside, chart 2
 * (transits, progressions, a partner's chart...) outside it. The two charts' cards sit on the
 * canvas under the report tabs, chart 1 left of the wheel or dial and chart 2 right of it; the
 * panel on the left holds the selected chart's positions, nothing else. Everything you read about the
 * charts is in the report tabs across the top: the chart itself, aspects, midpoints, Hellenistic
 * and events.
 */
function ChartScreen({ id }: { id: string }) {
  const handle = useChartViews(id);
  // ?view= opens a particular view (the browser's back and forward, links within your account).
  useEffect(() => {
    const wanted = new URLSearchParams(location.search).get('view');
    if (wanted && handle.ready && handle.views.some((v) => v.id === wanted) && handle.active?.id !== wanted) handle.setActive(wanted);
  }, [handle.ready]);
  useEffect(() => () => setActiveView(null), []);
  if (!handle.ready || !handle.active) {
    return <Workspace panel={<p class="muted small">Calculating…</p>}>
      <div class="stage-waiting" role="status"><span class="spinner" aria-hidden="true" />Calculating the chart…</div>
    </Workspace>;
  }
  return <ViewScreen id={id} handle={handle} view={handle.active} />;
}

/** One view of a chart: everything the chart screen shows comes from the view on screen. */
function ViewScreen({ id, handle, view }: { id: string; handle: ChartViewsHandle; view: View }) {
  const update = handle.update;
  const count: Count = view.partner ? 2 : 1;
  const selectedPref = view.selected;
  const setSelected = (i: number) => update({ selected: i === 1 ? 1 : 0 });
  const reportPref = view.report;
  const setReport = (r: Report) => { update({ report: r }); rememberDefaults({ report: r }); };
  const [choosing, setChoosing] = useState<number | null>(null);
  const [adding, setAdding] = useState<'partner' | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [list, reloadList] = useLoad(() => api<{ data: ChartSummary[] }>('/charts'));
  const wheelBox = useRef<HTMLDivElement>(null);
  const glyphs = useGlyphs();
  const { catalog, body, feature, display: look, switches } = useView();
  const display = view.display;
  useSchoolStart(look.school, switches.display !== undefined);
  const [modernBodies, setModernBodies] = usePref<boolean>('hellenistic-modern-bodies', false, isBoolean);
  const [timingMarks, setTimingMarks] = useState<Record<number, string>>({});
  const modulus = view.dial_size;
  const [dialHalf, setDialHalf] = usePref<boolean>('dial-half', true, isBoolean);
  const [dialOrb, setDialOrb] = usePref<number>('dial-orb', 1.5, isOrb);
  // With two charts, the Aspects report lists chart 1's or chart 2's own, or those between them
  // (synastry). The chart itself only ever draws the selected chart's own aspects.
  const betweenPref = view.between;
  const setBetween = (b: boolean) => update({ between: b });
  const pointer = view.pointer;
  const setPointer = (p: number) => update({ pointer: p });
  const showDial = display === 'dial' && feature('dials');
  const hellenistic = display === 'hellenistic' && feature('hellenistic');
  const shownDisplay = showDial ? 'dial' : hellenistic ? 'hellenistic' : 'wheel';
  const layouts = useLayouts(shownDisplay);
  const [defaultLayout] = useLayout(shownDisplay);
  const layout = layouts.find((l) => l.id === view.layout) ?? defaultLayout;
  // The title bar's pickers (chart type, dial size, layout, presets) work on this view.
  useEffect(() => { setActiveView({ chartId: id, view, update, handle }); }, [id, JSON.stringify(view), JSON.stringify(handle.views), handle.preset]);

  const reports: Array<[Report, string, string]> = [
    ['chart', 'Chart', '☉'],
    ['aspects', 'Aspects', '△'],
    ...(feature('midpoints') ? [['midpoints', 'Midpoints', '⊥'] as [Report, string, string]] : []),
    ...(feature('hellenistic') ? [['hellenistic', 'Hellenistic', '⊗'] as [Report, string, string]] : []),
    ...(feature('time_tools') ? [['events', 'Events', '☌'] as [Report, string, string]] : []),
  ];
  const report: Report = reports.some(([k]) => k === reportPref) ? reportPref : 'chart';

  // Chart 1 is the chart in the address (or a chart derived from it).
  const first = view.chart;
  const slots: Array<SlotRef | null> = [
    first && (first.id === id || (first.derived && first.parent === id)) ? first : { id, derived: false },
    view.partner,
  ];
  // Charts are calculated with the active profile: a preset (or Settings) changing it redraws them.
  const [profileTick, setProfileTick] = useState(0);
  useEffect(() => {
    const bump = () => setProfileTick((n) => n + 1);
    window.addEventListener(PROFILE_CHANGED, bump);
    return () => window.removeEventListener(PROFILE_CHANGED, bump);
  }, []);
  const [calc] = useLoad(() => api<{ active: string; profiles: Array<{ id: string; aspects: AspectSettings }> }>('/preferences/calculation'), [profileTick]);
  const aspectSettings: AspectSettings = calc.state === 'ready'
    ? calc.data.profiles.find((p) => p.id === calc.data.active)?.aspects ?? {} : {};
  const loads = [
    useLoad(() => loadSlot(slots[0] ?? null, hellenistic), [slots[0]?.id, hellenistic, profileTick])[0],
    useLoad(() => loadSlot(slots[1] ?? null, hellenistic), [slots[1]?.id, hellenistic, profileTick])[0],
  ];
  // Draw a set of charts only once all of them have arrived. Until then the last complete set
  // stays on screen (with a note that it's calculating), so the wheel never shows half-filled.
  const live: Array<SlotChart | null> = [0, 1].map((i) => {
    const l = loads[i];
    return i < count && slots[i] && l?.state === 'ready' ? l.data : null;
  });
  const pending = slots.slice(0, count).some((ref, i) => {
    const l = loads[i];
    return ref !== null && (l?.state === 'loading' || (l?.state === 'ready' && (l.data?.id !== ref.id || !!l.data?.hellenistic !== hellenistic)));
  });
  const frame = useRef<{ charts: Array<SlotChart | null>; selected: number } | null>(null);
  if (!pending) frame.current = { charts: live, selected: Math.min(selectedPref, count - 1) };
  // A preset's "ask each time": the chart dialog opens for chart 2 when the view is shown.
  useEffect(() => { if (view.ask && !view.partner && choosing === null) setChoosing(1); }, [view.id, view.ask]);
  // Keep chart 2's name with the view, for its label in the views row.
  const partnerName = loads[1]?.state === 'ready' ? loads[1].data?.name ?? null : null;
  useEffect(() => { if (partnerName && partnerName !== view.partner_name) update({ partner_name: partnerName }); }, [partnerName]);
  const drawn = frame.current;
  const chartAt = (i: number): SlotChart | null => drawn?.charts[i] ?? null;

  // Adding chart 2 opens the dialog to choose it.
  const changeCount = (n: 1 | 2) => { if (n === 2 && !slots[1]) setChoosing(1); };

  const setSlot = (i: number, ref: SlotRef | null) => {
    setChoosing(null);
    if (i === 1) {
      update({ partner: ref, partner_name: null, partner_role: null, ask: false, selected: ref ? 1 : 0 });
      return;
    }
    if (!ref) return;
    const home = ref.derived ? ref.parent ?? ref.id : ref.id;
    if (home === id) update({ chart: ref.derived ? ref : null, selected: 0 });
    else navigate(`/charts/${home}`);
  };

  const keysFor = (points: Record<string, Point>, asHellenistic: boolean) =>
    catalog.bodies.filter((b) => {
      if (!points[b.key]) return false;
      if (!asHellenistic) return body(b.key);
      if (HELLENISTIC_ALWAYS.has(b.key)) return true;
      if (SEVEN.includes(b.key) || b.group === 'Lots') return body(b.key);
      return modernBodies && body(b.key) && b.key !== 'aries_point' && b.group !== 'Angles';
    }).map((b) => b.key);
  const shownKeys = (points: Record<string, Point>) => keysFor(points, hellenistic);

  // The rings: the filled slots, in order, chart 1 innermost. Remember which slot each ring is.
  const rings: WheelRing[] = [];
  const ringSlot: number[] = [];
  for (let i = 0; i < 2; i++) {
    const c = chartAt(i);
    if (c) { rings.push({ points: c.points, keys: shownKeys(c.points), label: c.name }); ringSlot.push(i); }
  }
  const selected = drawn?.selected ?? 0;
  const current = chartAt(selected) ?? chartAt(0);
  const currentIndex = chartAt(selected) ? selected : 0;
  const ring = Math.max(0, ringSlot.indexOf(currentIndex));
  const currentKeys = current ? shownKeys(current.points) : [];
  const shown = new Set(currentKeys);
  const currentAspects = current ? current.aspects.filter((a) => shown.has(a.a) && shown.has(a.b)) : [];
  const base = chartAt(0);
  const partner = rings.length > 1 ? chartAt(1) : null;
  const between = !!(betweenPref && partner && base);
  const baseKeys = base ? shownKeys(base.points) : [];
  const partnerKeys = partner ? shownKeys(partner.points) : [];
  const crossAspects = between && partner && base ? aspectsBetween(partner.points, partnerKeys, base.points, baseKeys, aspectSettings) : [];
  const charts = list.state === 'ready' ? list.data.data : null;
  const defaultParent = base ? base.home : id;
  const pointerAt = pointer ?? ((base?.points.sun?.lon ?? 0) % modulus);

  const reportTabs = (
    <nav class="report-tabs" role="tablist" aria-label="Reports">
      {reports.map(([key, label, icon]) => (
        <button key={key} type="button" role="tab" aria-selected={report === key} aria-label={label} title={label} class={`report-tab${report === key ? ' is-active' : ''}`}
                onClick={() => setReport(key)}>
          <span class="report-tab__icon glyph" aria-hidden="true">{icon}</span>
          <span class="report-tab__label">{label}</span>
        </button>
      ))}
    </nav>
  );
  const addView = (
    <AddView handle={handle} view={view} parent={slots[0]?.derived ? slots[0].parent ?? id : id}
             onWithChart={() => { setAdding('partner'); setChoosing(1); }} onListChanged={reloadList} onError={setViewError} />
  );
  const bar = (
    <div class="report-bar">
      {reportTabs}
      {handle.views.length < 2 && <div class="report-bar__end">{addView}</div>}
    </div>
  );
  const viewsRow = handle.views.length > 1 ? <ViewsRow handle={handle} name={chartAt(0)?.name ?? 'this chart'}>{addView}</ViewsRow> : null;

  // Chart 1 on the left of the wheel or dial, chart 2 on the right, under the report tabs. With
  // one chart, the right-hand side offers to add chart 2; clearing chart 2 goes back to one.
  const card = (i: number) => {
    const ref = slots[i] ?? null;
    const l = loads[i]!;
    return (
      <SlotCard index={i} selected={currentIndex === i} canClear={i > 0}
                name={ref && l.state === 'ready' ? l.data?.name ?? null : null} line={l.state === 'ready' ? l.data?.line ?? '' : ''}
                loading={ref !== null && l.state === 'loading'} error={ref && l.state === 'error' ? l.error : null}
                onSelect={() => (ref ? setSelected(i) : setChoosing(i))} onChange={() => setChoosing(i)}
                onClear={() => setSlot(i, null)} />
    );
  };
  const dock = (
    <>
      <div class="slot-dock__side slot-dock__side--left">{card(0)}</div>
      <div class="slot-dock__side slot-dock__side--right">
        {count === 2 ? card(1) : (
          <button type="button" class="slot slot--add" aria-label="Add chart 2" onClick={() => changeCount(2)}>
            <span class="slot__label"><span class="layer-key layer-key--1" />Chart 2<span class="slot__role">outer</span></span>
            <span class="slot__add">＋ Add a chart</span>
            <span class="slot__line">Transits, progressions, a return or another person's chart</span>
          </button>
        )}
      </div>
    </>
  );

  // The panel: the selected chart's positions, and nothing else (the dialog for choosing a chart
  // opens from here too, outside the canvas).
  const panel = (
    <>
      {viewError && <Notice tone="error">{viewError}</Notice>}
      {current ? (
        <section class="slot-positions-block" aria-label={`Chart ${currentIndex + 1} positions`}>
          <h3 class="panel-heading"><span class={`layer-key layer-key--${currentIndex}`} />Chart {currentIndex + 1} Positions</h3>
          <p class="panel-heading__name" title={current.name}>{current.name}</p>
          <SlotPositions points={current.points} keys={currentKeys} houses={current.houses} focus={focus} onFocus={setFocus}
                         hellenistic={hellenistic ? current.hellenistic : null} head noHouses={showDial} />
        </section>
      ) : <p class="muted small">Calculating…</p>}
      {choosing !== null && (
        <ChartModal index={choosing} charts={charts} defaultParent={defaultParent}
                    onPicked={(r) => {
                      if (adding) {
                        // ＋ View → With another chart: a new view, this one with that chart as chart 2.
                        handle.add({ ...view, id: newViewId(), name: null, pointer: null, partner: r, partner_name: null, partner_role: null, ask: false, selected: 1, between: false });
                        setAdding(null);
                        setChoosing(null);
                      } else setSlot(choosing, r);
                    }}
                    onClose={() => { setChoosing(null); setAdding(null); if (view.ask) update({ ask: false, selected: 0 }); }} onListChanged={reloadList} />
      )}
    </>
  );

  const exportName = `${rings.map((r) => r.label).join(' + ') || 'Chart'}${showDial ? ` ${sizeLabel(modulus)} dial` : hellenistic ? ' Hellenistic' : ''}`;
  const pointTo = (key: string, points?: Record<string, Point>) => {
    const lon = (points ?? current?.points)?.[key]?.lon;
    setFocus(key);
    if (lon !== undefined) setPointer(((lon % modulus) + modulus) % modulus);
  };
  // The dial draws its first ring outermost, so it gets the charts the other way round: chart 1
  // (the natal chart) innermost, as on the bi-wheel, each ring keeping its chart's colour.
  const dialRings = rings.map((r) => ({ points: r.points, keys: r.keys })).reverse();
  const drawing = showDial ? (
    <Dial modulus={modulus} rings={dialRings} colours={[...ringSlot].reverse()}
          pointer={pointerAt} onPointer={setPointer} orb={dialOrb} selected={rings.length - 1 - ring}
          half={dialHalf} glyphs={glyphs} focus={focus} options={layout.options}
          onPick={(key) => pointTo(key)} />
  ) : (
    <Wheel rings={rings} houses={base?.houses ?? null} aspects={currentAspects} aspectRing={ring}
           highlight={rings.length > 1 ? ring : null} glyphs={glyphs} focus={focus} onFocus={setFocus} options={layout.options}
           marks={hellenistic ? timingMarks : undefined}
           title={`${rings.map((r) => r.label).join(', ')} chart wheel`} />
  );

  const waiting = <div class="stage-waiting" role="status"><span class="spinner" aria-hidden="true" />Calculating the chart…</div>;
  const busy = drawn && pending && <div class="stage-busy" role="status"><span class="spinner" aria-hidden="true" />Calculating…</div>;

  if (report !== 'chart') {
    const lons = (c: SlotChart, keys: string[]) => Object.fromEntries(keys.filter((k) => c.points[k]).map((k) => [k, c.points[k]!.lon]));
    return (
      <Workspace panel={panel} above={viewsRow} bar={bar} dock={dock} report>
        {!drawn || !base ? waiting : report === 'aspects' ? (
          <AspectsReport base={base} partner={partner} selected={currentIndex} between={between}
                         onChoose={(which) => { if (which === 'between') setBetween(true); else { setBetween(false); setSelected(which); } }}
                         ownKeys={currentKeys} ownAspects={currentAspects} baseKeys={baseKeys} partnerKeys={partnerKeys}
                         crossAspects={crossAspects} glyphs={glyphs} focus={focus} onFocus={setFocus} bySign={hellenistic} />
        ) : report === 'midpoints' && current ? (
          <MidpointsReport chart={current} index={currentIndex} count={rings.length} lons={lons(current, currentKeys)}
                           glyphs={glyphs} modulus={modulus} orb={dialOrb} half={dialHalf} onOrb={setDialOrb} onHalf={setDialHalf}
                           pointer={pointerAt} onPointer={setPointer} focus={focus} onFocus={setFocus}
                           onPick={(k) => pointTo(k)} />
        ) : report === 'hellenistic' ? (
          <HellenisticReport slot={slots[0] ?? { id, derived: false }} chartId={id} name={base.name} line={base.line}
                             glyphs={glyphs} keysFor={(p) => keysFor(p, true)} profileTick={profileTick}
                             focus={focus} onFocus={setFocus} modernBodies={modernBodies} onModernBodies={setModernBodies}
                             onMark={(m, lord) => { setTimingMarks(m); setFocus(lord); }} />
        ) : report === 'events' ? (
          <ReportHead name={base.name} line={base.line} what="Events: exact transits, progressions and solar arc directions to chart 1">
            {slots[0] && !slots[0].derived
              ? <EventsPane chartId={slots[0].id} glyphs={glyphs} onFocus={setFocus} />
              : <p class="muted small">Events are for a saved chart. Put one in chart 1 to list its transits, progressions and solar arc directions.</p>}
          </ReportHead>
        ) : null}
        {busy}
      </Workspace>
    );
  }

  return (
    <Workspace panel={panel} above={viewsRow} bar={bar} dock={dock} stageFooter={
      <div class="wheel-actions">
        <ExportButtons target={wheelBox} name={exportName} />
        <Link href={`/charts/${id}/sheet`} class="link-button">Client sheet</Link>
        {hellenistic && <Checkbox label="Modern bodies" checked={modernBodies} onChecked={setModernBodies} />}
      </div>
    }>
      {!drawn || !base ? waiting : <div class="stage-chart" ref={wheelBox}>{drawing}</div>}
      {busy}
    </Workspace>
  );
}

/** The sect of a Hellenistic chart, under the positions heading. */
function SectLine({ block, glyphs }: { block: HellenisticBlock; glyphs: Record<string, string> }) {
  const g = (k: string) => <span class="glyph">{textGlyph(glyphs[k] ?? '')}</span>;
  const cap = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);
  return (
    <p class="sect-line">
      <strong>{block.sect === 'day' ? 'Day' : 'Night'} chart</strong> · {g(block.sect_light)} {cap(block.sect_light)} sect light
      · {g(block.benefic_of_sect)} benefic, {g(block.malefic_of_sect)} malefic of sect
      {block.sect_near_horizon && <span class="sect-line__warn"> · Sun on the horizon: check the birth time</span>}
    </p>
  );
}

const PHASE_LABEL: Record<string, string> = { cazimi: 'cazimi', combust: 'combust', beams: 'under the beams' };
const OWN_LABEL: Record<string, string> = {
  domicile: 'own sign', exaltation: 'exalted', triplicity: 'own triplicity', bound: 'own bound', decan: 'own decan',
  detriment: 'detriment', fall: 'fall',
};

/** The selected chart's positions: body, place in the zodiac, and house in its own chart (whole
 * sign in a Hellenistic chart). With `detail` (the Hellenistic report) each body also gets a line with the lords of its place (domicile, triplicity,
 * bound, decan), its own dignities, its solar phase and whether it's in its joy. */
function SlotPositions({ points, keys, houses, focus, onFocus, hellenistic, detail, head, noHouses }: {
  points: Record<string, Point>; keys: string[]; houses: number[] | null; focus: string | null; onFocus: (k: string | null) => void;
  hellenistic?: HellenisticBlock | null;
  /** Each body's lords and dignities on a line under it (the Hellenistic report). */
  detail?: boolean;
  /** Column headings: Body, Long., House (the panel). */
  head?: boolean;
  /** No house column: a dial has no houses. */
  noHouses?: boolean;
}) {
  const { catalog } = useView();
  const glyphs = useGlyphs();
  const info = new Map(catalog.bodies.map((b) => [b.key, b]));
  const g = (k: string) => <span class="glyph">{textGlyph(glyphs[k] ?? '')}</span>;
  return (
    <table class="table table--compact data-table slot-positions">
      {head && (
        <thead><tr><th scope="col">Body</th><th scope="col">Long.</th>{!noHouses && <th scope="col" class="num">House</th>}</tr></thead>
      )}
      <tbody>
        {keys.map((key) => {
          const p = points[key]!;
          const b = info.get(key);
          const angle = b?.group === 'Angles';
          const hel = hellenistic;
          const house = hel?.houses[key];
          const lords = hel?.dignities[key];
          const phase = hel?.phase[key];
          const notes = [
            ...(lords?.own ?? []).map((o) => OWN_LABEL[o] ?? o),
            ...(phase && phase.phase !== 'free' ? [PHASE_LABEL[phase.phase]] : []),
            ...(phase ? [phase.orientation] : []),
            ...(hel?.joys.includes(key) ? ['in its joy'] : []),
          ];
          const row = (
            <tr key={key} class={`${focus === key ? 'is-focus' : ''}${hel && detail ? ' has-detail' : ''}`}
                onMouseEnter={() => onFocus(key)} onMouseLeave={() => onFocus(null)}>
              <td class="nowrap"><span class="glyph">{textGlyph(glyphs[key] ?? '')}</span> {b?.label ?? key}</td>
              <td class="nowrap" title={degrees(p.lon)}>{zodiac(p.lon)}{p.retro && <span class="retro"> {retroMark()}</span>}</td>
              {!noHouses && (
                <td class="num muted">
                  {house && !angle
                    ? <span title={house.angularity}>{house.house}<small class="angularity">{house.angularity[0]!.toUpperCase()}</small></span>
                    : houses && !angle ? houseOf(p.lon, houses) : ''}
                </td>
              )}
            </tr>
          );
          if (!detail || !hel || !lords) return row;
          return [
            row,
            <tr key={`${key}-detail`} class={`slot-positions__detail${focus === key ? ' is-focus' : ''}`}
                onMouseEnter={() => onFocus(key)} onMouseLeave={() => onFocus(null)}>
              <td colSpan={noHouses ? 2 : 3}>
                <span class="lords" title="Lords of its place: domicile, triplicity, bound, decan">
                  {g(lords.domicile)}{g(lords.triplicity)}{g(lords.bound)}{g(lords.decan)}
                </span>
                {notes.length > 0 && <span class="notes">{notes.join(' · ')}</span>}
              </td>
            </tr>,
          ];
        })}
      </tbody>
    </table>
  );
}

export function birthLine(chart: ChartDetail): string {
  const time = chart.note.time_unknown ? 'time unknown' : fmtTime(chart.time);
  return [fmtDate(chart.date), time, chart.place].filter(Boolean).join(' · ');
}

function PositionsTable({ points, keys, houses, focus, onFocus }: {
  points: Record<string, Point>; keys: string[]; houses: number[] | null; focus: string | null; onFocus: (k: string | null) => void;
}) {
  const { catalog } = useView();
  const glyphs = useGlyphs();
  const info = new Map(catalog.bodies.map((b) => [b.key, b]));
  return (
    <div class="table-scroll">
      <table class="table table--compact data-table">
        <thead><tr><th /><th>Position</th><th class="hide-sm">Speed</th><th class="hide-sm">Lat.</th><th class="hide-sm">Decl.</th>{houses && <th>House</th>}<th class="hide-sm">Dignity</th></tr></thead>
        <tbody>
          {keys.map((key) => {
            const p = points[key]!;
            const b = info.get(key);
            const angle = b?.group === 'Angles';
            return (
              <tr key={key} class={focus === key ? 'is-focus' : ''} onMouseEnter={() => onFocus(key)} onMouseLeave={() => onFocus(null)}>
                <td class="nowrap"><span class="glyph">{textGlyph(glyphs[key] ?? '')}</span> {b?.label ?? key}</td>
                <td class="nowrap" title={degrees(p.lon)}>{zodiac(p.lon)}{p.retro && <span class="retro"> {retroMark()}</span>}</td>
                <td class="num hide-sm">{angle || p.speed === null ? '' : `${p.speed.toFixed(3)}°`}</td>
                <td class="nowrap hide-sm">{angle ? '' : signed(p.lat)}</td>
                <td class="nowrap hide-sm">{angle || p.decl === null ? '' : signed(p.decl)}</td>
                {houses && <td class="num">{angle ? '' : houseOf(p.lon, houses)}</td>}
                <td class="small hide-sm">{dignities(key, p.lon)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AspectsPanel({ keys, aspects, glyphs, focus, onFocus }: {
  keys: string[]; aspects: FoundAspect[]; glyphs: Record<string, string>; focus: string | null; onFocus: (k: string | null) => void;
}) {
  const { catalog } = useView();
  const label = (k: string) => catalog.bodies.find((b) => b.key === k)?.label ?? k;
  return (
    <>
      <AspectGrid rows={keys} aspects={aspects} glyphs={glyphs} focus={focus} onFocus={onFocus} />
      <AspectList aspects={aspects} glyphs={glyphs} label={label} />
    </>
  );
}

export function AspectList({ aspects, glyphs, label, joiner }: {
  aspects: FoundAspect[]; glyphs: Record<string, string>; label: (k: string) => string; joiner?: [string, string];
}) {
  if (aspects.length === 0) return <p class="muted small">No aspects within orb.</p>;
  return (
    <table class="table table--compact aspect-list">
      <tbody>
        {aspects.map((a) => (
          <tr key={`${a.a}-${a.b}-${a.aspect}`}>
            <td class="nowrap"><span class="glyph">{textGlyph(glyphs[a.a] ?? '')}</span> {joiner ? `${joiner[0]} ` : ''}{label(a.a)}</td>
            <td class="nowrap"><span class={`aspect-name aspect-name--${aspectKind(a.aspect)}`} style={{ color: `var(--t-aspect-${a.aspect})` }}>{aspectName(a.aspect)}</span></td>
            <td class="nowrap"><span class="glyph">{textGlyph(glyphs[a.b] ?? '')}</span> {joiner ? `${joiner[1]} ` : ''}{label(a.b)}</td>
            <td class="num">{a.orb.toFixed(2)}°</td>
            <td class="muted small hide-sm">{a.applying === null ? '' : a.applying ? 'applying' : 'separating'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const aspectName = (key: string) => ASPECT_INFO[key]?.name ?? key;
const aspectKind = (key: string) => ASPECT_INFO[key]?.kind ?? 'neutral';

/**
 * A chart that isn't in the list (a composite, Davison or return): wheel, positions,
 * aspects and houses. `outer` adds another chart around it, such as the natal chart.
 */
export function SimpleChart({ data, aspects, outer, title, top }: {
  data: ChartData & { aspects?: FoundAspect[] }; aspects?: FoundAspect[]; outer?: { points: Record<string, Point>; label: string } | null;
  title: string;
  /** What sits above the tables in the panel: the page's own controls. */
  top?: preact.ComponentChildren;
}) {
  const [tab, setTab] = useState<'positions' | 'aspects' | 'houses'>('positions');
  const [focus, setFocus] = useState<string | null>(null);
  const keys = useShownKeys(data.points);
  const glyphs = useGlyphs();
  const shown = new Set(keys);
  const found = (aspects ?? data.aspects ?? []).filter((a) => shown.has(a.a) && shown.has(a.b));
  const box = useRef<HTMLDivElement>(null);
  const rings: WheelRing[] = [{ points: data.points, keys }];
  if (outer) rings.push({ points: outer.points, keys: keys.filter((k) => outer.points[k]) });
  return (
    <Workspace panel={
      <>
        {top}
        <nav class="tabs">
          {(['positions', 'aspects', 'houses'] as const).filter((t) => t !== 'houses' || data.houses).map((t) => (
            <button key={t} type="button" class={`tabs__tab${tab === t ? ' is-active' : ''}`} onClick={() => setTab(t)}>
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
        {tab === 'positions' && <PositionsTable points={data.points} keys={keys} houses={data.houses} focus={focus} onFocus={setFocus} />}
        {tab === 'aspects' && <AspectsPanel keys={keys} aspects={found} glyphs={glyphs} focus={focus} onFocus={setFocus} />}
        {tab === 'houses' && data.houses && <HouseCusps houses={data.houses} system={data.house_system} />}
      </>
    } stageFooter={
      <div class="wheel-actions">
        {outer && <span class="muted small"><span class="layer-key layer-key--1" />Outer ring: {outer.label}</span>}
        <ExportButtons target={box} name={title} />
      </div>
    }>
      <div class="stage-chart" ref={box}>
        <Wheel rings={rings} houses={data.houses} aspects={found} glyphs={glyphs} focus={focus} onFocus={setFocus} title={title} />
      </div>
    </Workspace>
  );
}

/** The panel's top when a page has no chart to show yet: the controls, and the stage stays empty. */
export function EmptyWorkspace({ top, message }: { top: preact.ComponentChildren; message: string }) {
  return (
    <Workspace panel={<>{top}<p class="muted small">{message}</p></>}>
      <div class="stage-empty">{message}</div>
    </Workspace>
  );
}

function HouseCusps({ houses, system }: { houses: number[]; system: string | null }) {
  return (
    <>
      <p class="muted small">{HOUSE_SYSTEM_NAMES[system ?? ''] ?? system} houses</p>
      <table class="table table--compact data-table">
        <thead><tr><th>House</th><th>Cusp</th></tr></thead>
        <tbody>{houses.map((c, i) => <tr key={i}><td>{i + 1}</td><td class="nowrap">{zodiacLong(c)}</td></tr>)}</tbody>
      </table>
    </>
  );
}

// ---------------------------------------------------------------------------
// Reports: the tabs across the top of the chart screen, other than the chart itself.

/** A report's heading: which chart it's about, and what it is. */
function ReportHead({ name, line, what, tools, children }: {
  name: string; line: string; what: string; tools?: preact.ComponentChildren; children: preact.ComponentChildren;
}) {
  return (
    <div class="report">
      <header class="report__head">
        <div>
          <h2 class="report__name">{name}</h2>
          <p class="report__line">{line}</p>
          <p class="report__what">{what}</p>
        </div>
        {tools && <div class="report__tools">{tools}</div>}
      </header>
      {children}
    </div>
  );
}

/** The aspectarian and the list of aspects: a chart's own, or (with two charts) those between them. */
function AspectsReport({ base, partner, selected, between, onChoose, ownKeys, ownAspects, baseKeys, partnerKeys, crossAspects,
  glyphs, focus, onFocus, bySign }: {
  base: SlotChart; partner: SlotChart | null; selected: number; between: boolean;
  onChoose: (which: number | 'between') => void;
  ownKeys: string[]; ownAspects: FoundAspect[]; baseKeys: string[]; partnerKeys: string[]; crossAspects: FoundAspect[];
  glyphs: Record<string, string>; focus: string | null; onFocus: (k: string | null) => void; bySign: boolean;
}) {
  const { catalog } = useView();
  const labels = Object.fromEntries(catalog.bodies.map((b) => [b.key, b.label]));
  const label = (k: string) => labels[k] ?? k;
  const chart = selected === 1 && partner ? partner : base;
  const choice = partner && (
    <div class="segmented" role="group" aria-label="Which aspects">
      {[0, 1].map((i) => (
        <button key={i} type="button" class={!between && selected === i ? 'is-active' : ''} aria-pressed={!between && selected === i}
                onClick={() => onChoose(i)}>Chart {i + 1}</button>
      ))}
      <button type="button" class={between ? 'is-active' : ''} aria-pressed={between} onClick={() => onChoose('between')}>Between 1 and 2</button>
    </div>
  );
  return between && partner ? (
    <ReportHead name={`${base.name} and ${partner.name}`} line="Aspects between charts 1 and 2"
                what={`Chart 1 (${base.name}) down the side, chart 2 (${partner.name}) along the top`} tools={choice}>
      <div class="report__columns report__columns--halves">
        <div class="report__card report__grid" style={{ '--n': partnerKeys.length + 1 }}>
          <AspectGrid rows={baseKeys} columns={partnerKeys} aspects={crossAspects} glyphs={glyphs} focus={focus} onFocus={onFocus} labels={labels} />
        </div>
        <div class="report__card report__list">
          <p class="muted small report__note">Chart 2's body first, then chart 1's.</p>
          <AspectList aspects={crossAspects} glyphs={glyphs} label={label} />
        </div>
      </div>
    </ReportHead>
  ) : (
    <ReportHead name={chart.name} line={chart.line} what={bySign ? 'Aspects by whole sign' : 'Aspects'} tools={choice}>
      <div class="report__columns report__columns--halves">
        <div class="report__card report__grid" style={{ '--n': ownKeys.length }}>
          <AspectGrid rows={ownKeys} aspects={ownAspects} glyphs={glyphs} focus={focus} onFocus={onFocus} diagonal bySign={bySign} labels={labels} />
        </div>
        <div class="report__card report__list">
          <AspectList aspects={ownAspects} glyphs={glyphs} label={label} />
        </div>
      </div>
    </ReportHead>
  );
}

/** Midpoints for the selected chart: on the pointer, sorted round the dial, search, and the trees. */
function MidpointsReport({ chart, index, count, lons, glyphs, modulus, orb, half, onOrb, onHalf, pointer, onPointer, focus, onFocus, onPick }: {
  chart: SlotChart; index: number; count: number; lons: Record<string, number>; glyphs: Record<string, string>;
  modulus: number; orb: number; half: boolean; onOrb: (v: number) => void; onHalf: (v: boolean) => void;
  pointer: number; onPointer: (v: number) => void; focus: string | null; onFocus: (k: string | null) => void; onPick: (k: string) => void;
}) {
  const trees = midpointTrees(lons, orb, modulus, half);
  const glyph = (k: string) => <span class="glyph">{textGlyph(glyphs[k] ?? k.slice(0, 2))}</span>;
  const tools = (
    <div class="panel-row dial-options">
      <label class="inline-select"><span>Orb</span>
        <input type="number" class="orb-input" min={0.1} max={5} step={0.1} value={orb} aria-label="Midpoint orb"
               onChange={(e) => onOrb(Math.min(5, Math.max(0.1, Number(e.currentTarget.value) || 1.5)))} />°
      </label>
      <label class="check"><input type="checkbox" checked={half} onChange={(e) => onHalf(e.currentTarget.checked)} />
        <span>Include {modulus / 2}°{modulus === 90 ? ' (semi-square)' : ''}</span></label>
    </div>
  );
  return (
    <ReportHead name={chart.name} line={chart.line} tools={tools}
                what={`${count > 1 ? `Chart ${index + 1}: ` : ''}midpoints on the ${sizeLabel(modulus)} dial`}>
      <div class="report__columns report__columns--midpoints">
        <div class="report__card midpoint-panel-card">
          <MidpointPanel lons={lons} glyphs={glyphs} modulus={modulus} orb={orb} half={half} pointer={pointer} onPointer={onPointer} />
        </div>
        <div class="report__card">
          <h3 class="report__section">Midpoint trees</h3>
          <div class="mp-trees mp-trees--report">
            {!trees.length ? <p class="mp-trees__none">No midpoints within orb.</p> : (
              <div class="mp-trees__columns">
                {trees.map((t) => (
                  <div key={t.factor} class={`mp-tree${focus === t.factor ? ' is-focus' : ''}`}
                       onMouseEnter={() => onFocus(t.factor)} onMouseLeave={() => onFocus(null)}>
                    <button type="button" class="mp-tree__root" onClick={() => onPick(t.factor)} title={`Put the pointer on ${t.factor}`}>
                      {glyph(t.factor)}<span class="mp-tree__at">{dm(t.dial)}</span>
                    </button>
                    <ul class="mp-tree__items">
                      {t.items.map((m) => (
                        <li key={`${m.a}-${m.b}`}>{glyph(m.a)}/{glyph(m.b!)}<span class="mp-tree__orb">{dm(m.orb)}</span></li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </ReportHead>
  );
}

/** Chart 1 the Hellenistic way: sect, the lords and dignities of each body's place, whole-sign
 * houses, and timing (profections, zodiacal releasing). The signs timing picks out are marked on
 * the Hellenistic chart. */
function HellenisticReport({ slot, chartId, name, line, glyphs, keysFor, profileTick, focus, onFocus, modernBodies, onModernBodies, onMark }: {
  slot: SlotRef; chartId: string; name: string; line: string; glyphs: Record<string, string>;
  keysFor: (points: Record<string, Point>) => string[]; profileTick: number;
  focus: string | null; onFocus: (k: string | null) => void; modernBodies: boolean; onModernBodies: (v: boolean) => void;
  onMark: (marks: Record<number, string>, focus: string | null) => void;
}) {
  const [chart] = useLoad(() => loadSlot(slot, true), [slot.id, profileTick]);
  return (
    <ReportHead name={name} line={line} what="Hellenistic: sect, lords and dignities, whole-sign houses, and timing"
                tools={<Checkbox label="Modern bodies" checked={modernBodies} onChecked={onModernBodies} />}>
      <div class="report__columns report__columns--halves">
        <div class="report__card">
          <h3 class="report__section">Sect and dignities</h3>
          {chart.state === 'loading' && <p class="muted small">Calculating…</p>}
          {chart.state === 'error' && <p class="small slot__error">{chart.error}</p>}
          {chart.state === 'ready' && chart.data && (
            <>
              {chart.data.hellenistic && <SectLine block={chart.data.hellenistic} glyphs={glyphs} />}
              <SlotPositions points={chart.data.points} keys={keysFor(chart.data.points)} houses={chart.data.houses}
                             focus={focus} onFocus={onFocus} hellenistic={chart.data.hellenistic} detail />
            </>
          )}
        </div>
        <div class="report__card timing-card">
          <h3 class="report__section">Timing</h3>
          <TimingControls />
          <TimingPane id={chartId} glyphs={glyphs} onMark={onMark} />
        </div>
      </div>
    </ReportHead>
  );
}
