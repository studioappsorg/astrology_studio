/**
 * AstrologyStudio ·
 * web/src/components/TagInput.tsx
 *
 * Tags as badges:
 *
 * each tag is a badge with × to take it off, and typing in the box adds one (Enter, comma or Tab;
 * Backspace in an empty box takes off the last). Tags you've used on other charts are suggested as
 * you type. Tags are lower case, as the server keeps them.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';

const MAX_TAGS = 30;
const clean = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);

export function TagInput({ label = 'Tags', value, onValue, suggestions = [], id = 'field-tags' }: {
  label?: string; value: string[]; onValue: (tags: string[]) => void; suggestions?: string[]; id?: string;
}) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const next = [...value];
    for (const part of raw.split(',')) {
      const t = clean(part);
      if (t && !next.includes(t) && next.length < MAX_TAGS) next.push(t);
    }
    if (next.length !== value.length) onValue(next);
    setText('');
  };
  const remove = (t: string) => onValue(value.filter((x) => x !== t));
  const offered = suggestions.filter((s) => !value.includes(s));
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <div class="tag-input" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
        {value.map((t) => (
          <span key={t} class="badge badge--tag">
            {t}
            <button type="button" class="badge__remove" aria-label={`Remove tag ${t}`} title="Remove"
                    onClick={(e) => { e.stopPropagation(); remove(t); }}>×</button>
          </span>
        ))}
        <input id={id} list={`${id}-options`} value={text} autoComplete="off"
               placeholder={value.length ? '' : 'family, clients'}
               onInput={(e) => {
                 const v = e.currentTarget.value;
                 // A comma, or picking a suggestion from the list, adds the tag straight away.
                 if (v.includes(',') || offered.includes(clean(v)) && (e as InputEvent).inputType !== 'insertText') add(v);
                 else setText(v);
               }}
               onKeyDown={(e) => {
                 if ((e.key === 'Enter' || e.key === 'Tab') && text.trim()) { e.preventDefault(); add(text); }
                 else if (e.key === 'Backspace' && !text && value.length) remove(value[value.length - 1]!);
               }}
               onBlur={() => { if (text.trim()) add(text); }} />
        <datalist id={`${id}-options`}>{offered.map((s) => <option key={s} value={s} />)}</datalist>
      </div>
      <small class="muted">Type a tag and press Enter (or a comma). Up to {MAX_TAGS}.</small>
    </div>
  );
}
