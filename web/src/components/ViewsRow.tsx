/**
 * AstrologyStudio ·
 * web/src/components/ViewsRow.tsx
 *
 * A chart's views (1.11): the row above the report tabs when a chart has more than one, and the
 * ＋ View menu that adds one. Click a view to switch to it, or its × to close it; right-click it to
 * rename, duplicate, move or close it, or drag it to a new place in the row.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { useView } from '../view';
import { useAppearance } from '../appearance';
import { useApplyPreset } from '../presets';
import { describe } from '../ui';
import { MAX_VIEWS, newViewId, viewLabel, type ChartViewsHandle, type View } from '../views';
import { derivedNow, NOW_ROLE, type NowKind } from '../derivedNow';

/** The row of views, shown when a chart has two or more. */
export function ViewsRow({ handle, name, children }: {
  handle: ChartViewsHandle; name: string; children?: preact.ComponentChildren;
}) {
  const [menu, setMenu] = useState<{ view: View; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const views = handle.views;
  return (
    <div class="views-row" role="tablist" aria-label={`Views of ${name}`}>
      <span class="views-row__label">Views</span>
      {views.map((v, i) => (
        <span key={v.id} role="presentation" draggable
              class={`view-chip${v.id === handle.active?.id ? ' is-active' : ''}${dragging === v.id ? ' is-dragging' : ''}`}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ view: v, x: e.clientX, y: e.clientY }); }}
              onDragStart={(e) => { setDragging(v.id); e.dataTransfer?.setData('text/plain', v.id); }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => { if (dragging && dragging !== v.id) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragging) handle.move(dragging, i); setDragging(null); }}>
          <button type="button" role="tab" class="view-chip__name" aria-selected={v.id === handle.active?.id}
                  title="Right-click for more; Delete closes it"
                  onClick={() => handle.setActive(v.id)}
                  onKeyDown={(e) => { if (e.key === 'Delete') { e.preventDefault(); handle.remove(v.id); } }}>
            {viewLabel(v)}
          </button>
          <button type="button" class="view-chip__close" aria-label={`Close view ${viewLabel(v)}`} title="Close this view"
                  onClick={() => handle.remove(v.id)}>
            <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </button>
        </span>
      ))}
      {children}
      {menu && (
        <ViewMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          ['Rename…', () => {
            const label = prompt('Name for this view (leave empty to name it from its settings)', menu.view.name ?? viewLabel(menu.view));
            if (label === null) return;
            handle.setActive(menu.view.id);
            // The view on screen is the one renamed: switch to it first.
            setTimeout(() => handle.update({ name: label.trim() ? label.trim().slice(0, 60) : null }));
          }],
          ['Duplicate', () => handle.add({ ...menu.view, id: newViewId(), name: menu.view.name ? `${menu.view.name} copy` : null }), views.length >= MAX_VIEWS],
          ['Move left', () => handle.move(menu.view.id, views.indexOf(menu.view) - 1), views.indexOf(menu.view) === 0],
          ['Move right', () => handle.move(menu.view.id, views.indexOf(menu.view) + 1), views.indexOf(menu.view) === views.length - 1],
          ['Close view', () => handle.remove(menu.view.id), views.length < 2],
        ]} />
      )}
    </div>
  );
}

/** ＋ View: add a view of this chart. */
export function AddView({ handle, view, parent, onWithChart, onListChanged, onError }: {
  handle: ChartViewsHandle; view: View; parent: string;
  /** "With another chart…": the chart screen opens its chart dialog for the new view. */
  onWithChart: () => void;
  onListChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const { feature } = useView();
  const presets = useAppearance().view.presets;
  const apply = useApplyPreset();
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const full = handle.views.length >= MAX_VIEWS;
  const copy = (patch: Partial<View>): View => ({ ...view, id: newViewId(), name: null, pointer: null, ...patch });
  const withNow = (kind: NowKind) => async () => {
    setBusy(true);
    onError(null);
    try {
      const { name, ...partner } = await derivedNow(parent, kind);
      onListChanged();
      handle.add(copy({ partner, partner_name: name, partner_role: NOW_ROLE[kind], ask: false, selected: 1, between: false }));
    } catch (e) {
      onError(describe(e));
    } finally {
      setBusy(false);
    }
  };
  const items: Item[] = [
    ['Copy of this view', () => handle.add(copy({ name: view.name ? `${view.name} copy` : null, pointer: view.pointer }))],
    ...(view.display !== 'wheel' ? [['As a chart wheel', () => handle.add(copy({ display: 'wheel', layout: null }))] as Item] : []),
    ...(feature('dials') && view.display !== 'dial' ? [['As a dial', () => handle.add(copy({ display: 'dial', layout: null, report: view.report === 'hellenistic' ? 'chart' : view.report }))] as Item] : []),
    ...(feature('hellenistic') && view.display !== 'hellenistic' ? [['As a Hellenistic chart', () => handle.add(copy({ display: 'hellenistic', layout: null }))] as Item] : []),
    'separator',
    ['With another chart…', onWithChart],
    ...(feature('transits') ? [['With transits now', withNow('transits')] as Item] : []),
    ...(feature('progressions') ? [['With progressions to today', withNow('progressed')] as Item] : []),
    ...(feature('solar_arc') ? [['With solar arc to today', withNow('solar_arc')] as Item] : []),
    ...(feature('returns') ? [['With this year\'s solar return', withNow('solar_return')] as Item] : []),
    ...(presets.length ? ['separator' as const, 'From a preset' as const, ...presets.map((p): Item => [
      `${p.name} (${p.views.length === 1 ? '1 view' : `${p.views.length} views`})`, () => void apply(p, 'add').catch((e: unknown) => onError(describe(e))),
      handle.views.length + p.views.length > MAX_VIEWS,
    ])] : []),
  ];
  return (
    <>
      <button type="button" class="view-add" disabled={full || busy} aria-haspopup="menu" aria-label="Add a view"
              title={full ? `A chart can have up to ${MAX_VIEWS} views` : 'Add a view of this chart'}
              onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setOpen(open ? null : { x: r.left, y: r.bottom + 4 }); }}>
        {busy ? 'Working…' : '＋ View'}
      </button>
      {open && <ViewMenu x={open.x} y={open.y} onClose={() => setOpen(null)} title="New view" items={items} />}
    </>
  );
}

type Item = [string, () => void, boolean?] | 'separator' | 'From a preset';

function ViewMenu({ x, y, items, title, onClose }: { x: number; y: number; items: Item[]; title?: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x, y });
  useEffect(() => {
    const el = box.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setAt({ x: Math.max(6, Math.min(x, window.innerWidth - r.width - 6)), y: Math.min(y, window.innerHeight - r.height - 6) });
      el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const all = [...(box.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const i = all.indexOf(document.activeElement as HTMLButtonElement);
      all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, []);
  return (
    <div class="menu__list context-menu" role="menu" aria-label={title ?? 'View'} ref={box} style={{ left: `${at.x}px`, top: `${at.y}px` }}>
      {title && <div class="menu__title">{title}</div>}
      {items.map((item, i) => item === 'separator' ? <div key={`s${i}`} class="menu__sep" role="separator" />
        : item === 'From a preset' ? <div key={`h${i}`} class="menu__title">{item}</div> : (
        <button key={item[0]} type="button" role="menuitem" class="menu__item" disabled={item[2]} onClick={() => { onClose(); item[1](); }}>
          <span class="menu__tick" aria-hidden="true" /><span class="menu__label">{item[0]}</span>
        </button>
      ))}
    </div>
  );
}
