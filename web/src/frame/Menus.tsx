/**
 * AstrologyStudio ·
 * web/src/frame/Menus.tsx
 *
 * Desktop-style menus:
 *
 * a row of names (File, View, ...) that drop down lists of commands. Click a name to open it;
 * while one is open, pointing at another opens that one instead. Arrow keys move through the
 * commands and across the menus, Enter runs one, Escape closes.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

export type MenuItem =
  | { separator: true }
  | {
      label: string;
      run: () => void;
      shortcut?: string;
      /** A tick beside it: on/off (checkbox) or one-of (radio). */
      checked?: boolean;
      kind?: 'checkbox' | 'radio';
      disabled?: boolean;
    };

export interface Menu {
  label: string;
  /** What shows on the button, when it isn't just the label (an icon, say). */
  face?: ComponentChildren;
  items: MenuItem[];
  disabled?: boolean;
  /** Line the list up with the button's right edge (for menus at the right of the bar). */
  alignEnd?: boolean;
}

const isCommand = (item: MenuItem): item is Exclude<MenuItem, { separator: true }> => !('separator' in item);

export function Menus({ menus, label, class: cls = '' }: { menus: Menu[]; label: string; class?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const away = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) setOpen(null); };
    const blur = () => setOpen(null);
    document.addEventListener('mousedown', away);
    window.addEventListener('blur', blur);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('blur', blur); };
  }, [open]);

  // Opening a menu from the keyboard puts focus on its first command.
  const focusItem = (menu: number, which: 'first' | 'last' | 'next' | 'prev') => {
    requestAnimationFrame(() => {
      const items = [...(bar.current?.querySelectorAll<HTMLButtonElement>(`[data-menu="${menu}"] [role^="menuitem"]:not(:disabled)`) ?? [])];
      if (!items.length) return;
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const to = which === 'first' ? 0 : which === 'last' ? items.length - 1
        : which === 'next' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[to]!.focus();
    });
  };
  const enabled = menus.map((m, i) => (m.disabled ? -1 : i)).filter((i) => i >= 0);
  const step = (from: number, by: 1 | -1) => {
    const at = enabled.indexOf(from);
    return enabled[(at + by + enabled.length) % enabled.length]!;
  };
  const toTrigger = (i: number) => bar.current?.querySelectorAll<HTMLButtonElement>('.menu__trigger')[i]?.focus();

  const onKey = (e: KeyboardEvent) => {
    if (open === null) return;
    const keys: Record<string, () => void> = {
      Escape: () => { const at = open; setOpen(null); toTrigger(at); },
      ArrowDown: () => focusItem(open, 'next'),
      ArrowUp: () => focusItem(open, 'prev'),
      Home: () => focusItem(open, 'first'),
      End: () => focusItem(open, 'last'),
      ArrowRight: () => { const to = step(open, 1); setOpen(to); toTrigger(to); focusItem(to, 'first'); },
      ArrowLeft: () => { const to = step(open, -1); setOpen(to); toTrigger(to); focusItem(to, 'first'); },
    };
    const act = keys[e.key];
    if (!act) return;
    e.preventDefault();
    act();
  };

  return (
    <div class={`menus ${cls}`} role="menubar" aria-label={label} ref={bar} onKeyDown={onKey}>
      {menus.map((menu, i) => (
        <div key={menu.label} class={`menu${open === i ? ' is-open' : ''}`} data-menu={i}>
          <button type="button" class="menu__trigger" aria-haspopup="menu" aria-expanded={open === i}
                  disabled={menu.disabled} aria-label={menu.face ? menu.label : undefined}
                  title={menu.face ? menu.label : undefined}
                  onMouseDown={(e) => { e.preventDefault(); setOpen(open === i ? null : i); }}
                  onClick={(e) => { if (e.detail === 0) { setOpen(open === i ? null : i); focusItem(i, 'first'); } }}
                  onMouseEnter={() => { if (open !== null && open !== i && !menu.disabled) setOpen(i); }}
                  onKeyDown={(e) => { if (e.key === 'ArrowDown' && open === null) { e.preventDefault(); e.stopPropagation(); setOpen(i); focusItem(i, 'first'); } }}>
            {menu.face ?? menu.label}
          </button>
          {open === i && (
            <div class={`menu__list${menu.alignEnd ? ' menu__list--end' : ''}`} role="menu" aria-label={menu.label}>
              {menu.items.map((item, n) => isCommand(item) ? (
                <button key={item.label} type="button" class="menu__item" disabled={item.disabled}
                        role={item.kind === 'checkbox' ? 'menuitemcheckbox' : item.kind === 'radio' ? 'menuitemradio' : 'menuitem'}
                        aria-checked={item.kind ? !!item.checked : undefined}
                        onClick={() => { setOpen(null); item.run(); }}>
                  <span class="menu__tick" aria-hidden="true">{item.checked ? (item.kind === 'radio' ? '•' : '✓') : ''}</span>
                  <span class="menu__label">{item.label}</span>
                  {item.shortcut && <kbd class="menu__key">{item.shortcut}</kbd>}
                </button>
              ) : <div key={`sep-${n}`} class="menu__sep" role="separator" />)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
