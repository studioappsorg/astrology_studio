/**
 * AstrologyStudio ·
 * web/src/frame/Tabs.tsx
 *
 * The open tabs across the top of the work area, like documents in a desktop program. The chart
 * library is always the first tab and can't be closed; the others can be dragged to a new place,
 * as in a browser.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { navigate } from '../router';
import { chartOf, closeTab, LIBRARY, moveTab, tabTitle, useCharts, useTabs } from './store';

export function TabBar({ activeKey }: { activeKey: string | null }) {
  const [tabs] = useTabs();
  const list = useCharts();
  const strip = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  useEffect(() => {
    strip.current?.querySelector('.doc-tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeKey, tabs.length]);

  const close = (key: string) => {
    const next = closeTab(key, activeKey);
    if (next !== undefined) navigate(next ?? LIBRARY);
  };
  /** While dragging, the tab moves as soon as it passes the middle of another (as browsers do). */
  const over = (e: DragEvent, index: number) => {
    if (!dragging || index === 0) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const from = tabs.findIndex((t) => t.key === dragging);
    if (from < 0 || from === index) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const past = e.clientX > box.left + box.width / 2;
    if ((from < index && past) || (from > index && !past)) moveTab(dragging, index);
  };
  return (
    <div class="doc-tabs" role="tablist" aria-label="Open tabs" ref={strip}
         onWheel={(e) => { if (e.deltaY && strip.current) strip.current.scrollLeft += e.deltaY; }}>
      {tabs.map((t, i) => {
        const title = tabTitle(t.key, list);
        const active = t.key === activeKey;
        const pinned = t.key === LIBRARY;
        return (
          <div key={t.key}
               class={`doc-tab${active ? ' is-active' : ''}${chartOf(t.key) ? ' doc-tab--chart' : ''}${pinned ? ' doc-tab--pinned' : ''}${dragging === t.key ? ' is-dragging' : ''}`}
               draggable={!pinned}
               onDragStart={(e) => { setDragging(t.key); e.dataTransfer?.setData('text/plain', t.path); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; }}
               onDragEnd={() => setDragging(null)}
               onDragOver={(e) => over(e, i)}
               onDrop={(e) => { e.preventDefault(); setDragging(null); }}
               onMouseDown={(e) => { if (e.button === 1 && !pinned) { e.preventDefault(); close(t.key); } }}>
            <button type="button" role="tab" aria-selected={active} class="doc-tab__name" title={title}
                    onClick={() => navigate(t.path)}>
              {chartOf(t.key) && <span class="doc-tab__glyph glyph" aria-hidden="true">☉</span>}
              <span class="doc-tab__label">{title}</span>
            </button>
            {!pinned && (
              <button type="button" class="doc-tab__close" aria-label={`Close ${title}`} title="Close (Alt+W)"
                      onClick={() => close(t.key)}>×</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
