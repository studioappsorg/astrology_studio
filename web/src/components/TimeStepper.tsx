/**
 * AstrologyStudio ·
 * web/src/components/TimeStepper.tsx
 *
 * A date and time with buttons to step backwards and forwards by a chosen amount.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { oneOf, usePref } from '../prefs';

export type Step = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
const STEPS: Array<[Step, string]> = [['minute', 'Minute'], ['hour', 'Hour'], ['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']];

/** A Date as the value of a datetime-local input, in the browser's own time zone. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function stepDate(date: Date, step: Step, by: number): Date {
  const next = new Date(date);
  if (step === 'minute') next.setMinutes(next.getMinutes() + by);
  else if (step === 'hour') next.setHours(next.getHours() + by);
  else if (step === 'day') next.setDate(next.getDate() + by);
  else if (step === 'week') next.setDate(next.getDate() + 7 * by);
  else if (step === 'month') next.setMonth(next.getMonth() + by);
  else next.setFullYear(next.getFullYear() + by);
  return next;
}

export function TimeStepper({ value, onValue, label = 'Date' }: { value: Date; onValue: (d: Date) => void; label?: string }) {
  const [step, setStep] = usePref<Step>('time-step', 'day', oneOf<Step>('minute', 'hour', 'day', 'week', 'month', 'year'));
  return (
    <div class="stepper">
      <label class="inline-select">
        <span>{label}</span>
        <input type="datetime-local" value={toLocalInput(value)}
               onChange={(e) => { const d = new Date(e.currentTarget.value); if (!Number.isNaN(d.getTime())) onValue(d); }} />
      </label>
      <div class="segmented">
        <button type="button" onClick={() => onValue(stepDate(value, step, -1))} aria-label={`Back one ${step}`}>◀</button>
        <select value={step} onChange={(e) => setStep(e.currentTarget.value as Step)} aria-label="Step by">
          {STEPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button type="button" onClick={() => onValue(stepDate(value, step, 1))} aria-label={`Forward one ${step}`}>▶</button>
      </div>
      <button type="button" class="btn btn--small" onClick={() => onValue(new Date())}>Now</button>
    </div>
  );
}
