/**
 * AstrologyStudio ·
 * web/src/pages/GettingStarted.tsx
 *
 * Two steps before the first chart:
 *
 * where ephemeralREST is, and your own API key.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'preact/hooks';
import { loadReadiness } from '../readiness';
import { Link } from '../router';
import { useSession } from '../session';
import { Loading, PageHeader, useLoad } from '../ui';
import { ApiKeyForm } from './Account';
import { ConnectionForm } from './Settings';

export function GettingStarted() {
  const { session } = useSession();
  const [status, reload] = useLoad(loadReadiness);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Getting started" intro="AstrologyStudio uses ephemeralREST for every calculation and to keep your charts." />
      <Loading result={status}>
        {() => {
          if (status.state !== 'ready') return null;
          const { connection, key, ready } = status.data;
          const steps = [
            {
              id: 'connection',
              title: 'Connect to ephemeralREST',
              hint: connection.reachable ? connection.url : 'The address of the ephemeralREST server',
              done: connection.reachable,
              body: session.user.is_owner
                ? <ConnectionForm current={connection} onSaved={reload} />
                : <p class="muted">Ask the owner of this install to enter the ephemeralREST address in Settings.</p>,
            },
            {
              id: 'key',
              title: 'Add your API key',
              hint: key.configured ? `Key ${key.prefix}… works` : 'Each person uses their own ephemeralREST key',
              done: key.configured,
              body: <ApiKeyForm status={key} onSaved={reload} disabled={!connection.reachable} />,
            },
          ];
          const done = steps.filter((s) => s.done).length;
          return (
            <>
              <div class="setup-progress"><div class="setup-progress__bar" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
              <p class="setup-count muted">{done} of {steps.length} done</p>
              {ready && (
                <div class="notice notice--success">
                  All set. <Link href="/charts">Go to your charts</Link>
                </div>
              )}
              <ol class="steps">
                {steps.map((step, index) => {
                  const isOpen = open === step.id || (open === null && !step.done && steps.findIndex((s) => !s.done) === index);
                  return (
                    <li key={step.id} class={`step${step.done ? ' is-done' : ''}${isOpen ? ' is-open' : ''}`}>
                      <button type="button" class="step__head" onClick={() => setOpen(isOpen ? '' : step.id)} aria-expanded={isOpen}>
                        <span class="step__mark">{step.done ? '✓' : index + 1}</span>
                        <span><strong>{step.title}</strong><small>{step.hint}</small></span>
                      </button>
                      {isOpen && <div class="step__body">{step.body}</div>}
                    </li>
                  );
                })}
              </ol>
            </>
          );
        }}
      </Loading>
    </>
  );
}
