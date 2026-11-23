/**
 * AstrologyStudio ·
 * web/src/components/Modal.tsx
 *
 * A modal dialog:
 *
 * title bar with a close button, a body that scrolls, and a footer for the buttons. Escape, the
 * close button or a click outside closes it; focus goes back to where it was. Put a ModalBody and
 * a ModalFooter inside (or a form holding both).
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: ComponentChildren; wide?: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = dialog.current?.querySelector<HTMLElement>('input, select, textarea, [data-autofocus]');
    (first ?? dialog.current)?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('has-modal');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('has-modal');
      before?.focus?.();
    };
  }, []);
  return (
    <div class="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class={`modal${wide ? ' modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={dialog} tabIndex={-1}>
        <div class="modal__header">
          <h2 class="modal__title">{title}</h2>
          <button type="button" class="modal__close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ModalBody({ children }: { children: ComponentChildren }) {
  return <div class="modal__body">{children}</div>;
}

export function ModalFooter({ children }: { children: ComponentChildren }) {
  return <div class="modal__footer">{children}</div>;
}
