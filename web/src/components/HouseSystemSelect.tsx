/**
 * AstrologyStudio ·
 * web/src/components/HouseSystemSelect.tsx
 *
 * A chart's house system:
 *
 * "Default" (whatever is in use: the calculation profile's own house system, or your default from
 * Settings) or a particular one.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { api, type Calculation } from '../api';
import { Select, useLoad } from '../ui';
import { useDefaults } from '../defaults';

export function HouseSystemSelect({ value, onValue, id }: { value: string; onValue: (v: string) => void; id?: string }) {
  const [calc] = useLoad(() => api<Calculation>('/preferences/calculation'));
  const defaults = useDefaults();
  const systems = calc.state === 'ready' ? calc.data.house_systems : [];
  const active = calc.state === 'ready' ? calc.data.profiles.find((p) => p.id === calc.data.active) : undefined;
  const inUse = active?.house_system || defaults?.house_system || '';
  const name = systems.find((h) => h.key === inUse)?.label;
  return (
    <Select label="House system" value={value} onValue={onValue} id={id}
            options={[['', name ? `Default (${name})` : 'Default'], ...systems.map((h): [string, string] => [h.key, h.label])]}
            hint={value ? 'This chart always uses it, whatever the profile.' : 'Follows your calculation profile, or your default in Settings.'} />
  );
}
