/**
 * AstrologyStudio ·
 * web/src/nav.tsx
 *
 * The title bar across the top of the app:
 *
 * the logo, the menus (File, View, Chart, Tools, Help), the chart screen's pickers, the light/dark
 * switch and your account. It also owns the keyboard shortcuts, so each one does exactly what its
 * menu command does.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import { useLayouts } from './appearance';
import { Modal, ModalBody, ModalFooter } from './components/Modal';
import { NewChartPresets, PresetNotice, PresetPicker } from './presets';
import { isChartScreen, sizeLabel, useDialModulus, useDialSizes, useDisplay, useLayout, type DialModulus, type DisplayKey } from './display';
import { closeTab, chartOf, LIBRARY, useTabs } from './frame/store';
import { findChart } from './frame/layout';
import { Menus, type Menu, type MenuItem } from './frame/Menus';
import { appVersion } from './frame/StatusBar';
import { plainWording } from './hosted';
import { Link, navigate, usePath } from './router';
import { useSession } from './session';
import { useTheme } from './theme';
import { useView } from './view';
import { useActiveView } from './views';

/** The logo. As a link it goes to the chart library. */
export function Brand({ link = false }: { link?: boolean }) {
  const mark = (
    <>
      <span class="brand__glyph" aria-hidden="true">✶</span> <span class="brand__name"><span class="brand__accent">Astrology</span>Studio</span>
    </>
  );
  return link
    ? <Link href="/charts" class="brand brand--link" aria-label="AstrologyStudio: chart library">{mark}</Link>
    : <div class="brand">{mark}</div>;
}

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = mac ? '⌘' : 'Ctrl+';
const ALT = mac ? '⌥' : 'Alt+';

const SHORTCUTS: Array<[string, string]> = [
  [`${MOD}K`, 'Find and open a chart'],
  [`${ALT}N`, 'New chart'],
  [`${ALT}W`, 'Close the tab'],
  [`${ALT}]`, 'Next tab'],
  [`${ALT}[`, 'Previous tab'],
  [`${MOD},`, 'Settings'],
  ['?', 'These shortcuts'],
];

export function AppBar({ activeKey }: { activeKey: string | null }) {
  const path = usePath();
  const { session, signOut } = useSession();
  const { feature } = useView();
  const [theme, setTheme] = useTheme();
  const [tabs] = useTabs();
  const [dialog, setDialog] = useState<'keys' | 'about' | null>(null);
  const onChart = isChartScreen(path);
  const chartId = activeKey ? chartOf(activeKey) : null;
  const owner = session.user.is_owner;

  const closeCurrent = () => {
    if (!activeKey || activeKey === LIBRARY) return;
    const next = closeTab(activeKey, activeKey);
    if (next !== undefined) navigate(next ?? LIBRARY);
  };
  const cycle = (by: 1 | -1) => {
    if (!tabs.length) return;
    const at = tabs.findIndex((t) => t.key === activeKey);
    navigate(tabs[(at + by + tabs.length) % tabs.length]!.path);
  };
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  // Keyboard shortcuts. e.code, so they work whatever the keyboard layout or Option-key characters.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.body.classList.contains('has-modal')) return;
      const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName) || (e.target as HTMLElement).isContentEditable;
      let act: (() => void) | null = null;
      if (mod && !e.altKey && !e.shiftKey) {
        act = ({ KeyK: findChart, Comma: () => navigate('/settings') } as Record<string, () => void>)[e.code] ?? null;
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        act = ({
          KeyN: () => navigate('/charts/new'),
          KeyW: closeCurrent,
          BracketRight: () => cycle(1),
          BracketLeft: () => cycle(-1),
        } as Record<string, () => void>)[e.code] ?? null;
      } else if (e.key === '?' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        act = () => setDialog('keys');
      }
      if (!act) return;
      e.preventDefault();
      act();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const go = (to: string) => () => navigate(to);
  const sep: MenuItem = { separator: true };

  // Only what can't be reached in a click elsewhere: chart types are in the title bar's picker,
  // dark mode is its ☾ button, the chart library is the first tab, and Account and Log out are
  // in the account menu.
  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'New chart', shortcut: `${ALT}N`, run: go('/charts/new') },
        { label: 'Open chart…', shortcut: `${MOD}K`, run: findChart },
        { label: 'Add a shared chart…', run: go('/charts?add=shared') },
        sep,
        { label: 'Close tab', shortcut: `${ALT}W`, run: closeCurrent, disabled: !activeKey || activeKey === LIBRARY },
      ],
    },
    {
      label: 'Chart',
      disabled: !chartId,
      items: chartId ? [
        { label: 'Edit details…', run: go(`/charts/${chartId}/edit`) },
        ...(feature('returns') ? [{ label: 'Returns', run: go(`/charts/${chartId}/returns`), kind: 'radio', checked: path.endsWith('/returns') } as MenuItem] : []),
        { label: 'Client sheet', run: go(`/charts/${chartId}/sheet`), kind: 'radio', checked: path.endsWith('/sheet') },
      ] : [],
    },
    {
      label: 'Tools',
      items: [
        ...(feature('ephemeris') ? [{ label: 'Ephemeris', run: go('/ephemeris') } as MenuItem] : []),
        { label: 'Settings', shortcut: `${MOD},`, run: go('/settings') },
        ...(owner ? [{ label: 'Users', run: go('/users') } as MenuItem] : []),
      ],
    },
    // Not a list: straight to the page.
    { label: 'My View', run: go('/view'), current: path === '/view', items: [] },
    {
      label: 'Help',
      items: [
        { label: 'Keyboard shortcuts', shortcut: '?', run: () => setDialog('keys') },
        ...(plainWording() ? [] : [{ label: 'Getting started', run: go('/start') } as MenuItem]),
        { label: 'About AstrologyStudio', run: () => setDialog('about') },
      ],
    },
  ];

  const who = session.user.name || session.user.email;
  const initial = (who.trim()[0] ?? '?').toUpperCase();
  const account: Menu = {
    label: 'Your account',
    alignEnd: true,
    face: <><span class="avatar" aria-hidden="true">{initial}</span><span class="title-bar__who">{who}</span></>,
    items: [
      { label: 'Account', run: go('/account') },
      sep,
      { label: 'Log out', run: () => void signOut() },
    ],
  };

  return (
    <header class="app-bar title-bar">
      <Brand link />
      <Menus menus={menus} label="Menu" class="title-bar__menus" />
      <div class="title-bar__end">
        {onChart && <PresetPicker />}
        {onChart && <DisplayPicker />}
        {onChart && <LayoutPicker />}
        <button type="button" class="icon-button title-bar__theme" onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <Menus menus={[account]} label="Account" class="title-bar__account" />
      </div>
      <PresetNotice />
      <NewChartPresets />
      {dialog === 'keys' && (
        <Modal title="Keyboard shortcuts" onClose={() => setDialog(null)}>
          <ModalBody>
            <table class="table table--compact table--plain shortcuts">
              <tbody>
                {SHORTCUTS.map(([keys, what]) => <tr key={keys}><td><kbd>{keys}</kbd></td><td>{what}</td></tr>)}
              </tbody>
            </table>
            <p class="hint">Middle-click a tab to close it.</p>
          </ModalBody>
          <ModalFooter><button type="button" class="btn" onClick={() => setDialog(null)} data-autofocus>Close</button></ModalFooter>
        </Modal>
      )}
      {dialog === 'about' && (
        <Modal title="About AstrologyStudio" onClose={() => setDialog(null)}>
          <ModalBody>
            <div class="about">
              <Brand />
              <p>Version {appVersion() ?? '…'}</p>
              <p class="muted">Modern Western, Hellenistic and cosmobiology charts, worked out by ephemeralREST from the Swiss Ephemeris. Part of the Studio Apps family. MIT licence.</p>
              <p class="muted small">Astrology symbols: Astronomicon by Roberto Corona (SIL Open Font License).</p>
            </div>
          </ModalBody>
          <ModalFooter><button type="button" class="btn" onClick={() => setDialog(null)} data-autofocus>Close</button></ModalFooter>
        </Modal>
      )}
    </header>
  );
}

/** The chart type of the view on screen (and the default for new views). */
function useViewDisplay(): [DisplayKey, (key: DisplayKey) => void] {
  const onScreen = useActiveView();
  const [fallback, setDefault] = useDisplay();
  return [onScreen?.view.display ?? fallback, (key) => { onScreen?.update({ display: key }); setDefault(key); }];
}

/** The dial size of the view on screen (and the default for new views). */
function useViewDialSize(): [number, (m: number) => void] {
  const onScreen = useActiveView();
  const [fallback, setDefault] = useDialModulus();
  return [onScreen?.view.dial_size ?? fallback, (m) => { onScreen?.update({ dial_size: m }); setDefault(m as DialModulus); }];
}

/** The chart screen's chart type: the chart wheel, the Hellenistic chart or the dial, and the
 * dial's size when more than one size is switched on in My View. Only on the chart screen. */
function DisplayPicker() {
  const { feature } = useView();
  const [display, setDisplay] = useViewDisplay();
  const [modulus, setModulus] = useViewDialSize();
  const [sizes] = useDialSizes();
  const options: Array<[DisplayKey, string]> = [
    ['wheel', 'Chart wheel'],
    ...(feature('hellenistic') ? [['hellenistic', 'Hellenistic chart'] as [DisplayKey, string]] : []),
    ...(feature('dials') ? [['dial', 'Dial'] as [DisplayKey, string]] : []),
  ];
  const value = options.some(([k]) => k === display) ? display : 'wheel';
  if (options.length < 2) return null;
  return (
    <>
      <label class="display-picker">
        <span class="visually-hidden">Chart type</span>
        <select value={value} onChange={(e) => setDisplay(e.currentTarget.value as DisplayKey)} aria-label="Chart type">
          {options.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </label>
      {value === 'dial' && sizes.length > 1 && (
        <label class="display-picker display-picker--size">
          <span class="visually-hidden">Dial size</span>
          <select value={modulus} onChange={(e) => setModulus(Number(e.currentTarget.value))} aria-label="Dial size">
            {sizes.map((m) => <option key={m} value={m}>{sizeLabel(m)}</option>)}
          </select>
        </label>
      )}
    </>
  );
}

/** The layout the chart screen's canvas is drawn with, for the display in use. */
function LayoutPicker() {
  const { feature } = useView();
  const [chosen] = useViewDisplay();
  const display: DisplayKey = chosen === 'dial' && feature('dials') ? 'dial' : chosen === 'hellenistic' && feature('hellenistic') ? 'hellenistic' : 'wheel';
  const [layoutDefault, setLayoutDefault] = useLayout(display);
  const layouts = useLayouts(display);
  const onScreen = useActiveView();
  const layout = layouts.find((l) => l.id === onScreen?.view.layout) ?? layoutDefault;
  const setLayout = (id: string) => { onScreen?.update({ layout: id }); setLayoutDefault(id); };
  return (
    <label class="display-picker">
      <span class="visually-hidden">Layout</span>
      <select value={layout.id} onChange={(e) => setLayout(e.currentTarget.value)}
              aria-label={`Layout for the ${display === 'dial' ? 'dial' : display === 'hellenistic' ? 'Hellenistic chart' : 'chart wheel'}`}>
        {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </label>
  );
}
