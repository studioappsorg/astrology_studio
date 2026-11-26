/**
 * AstrologyStudio ·
 * web/src/components/KeyActions.tsx
 *
 * Show my key and Replace my key. Both ask the person to confirm it's them first (their password
 * here, or their ephemeralREST password and the emailed code); a check is good for 5 minutes.
 * A shown key is hidden again after 60 seconds or when the window closes, and isn't kept.
 * Put it outside any form: the window has a form of its own.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { useSession } from '../session';
import { plainWording } from '../hosted';
import { Button, CopyText, Field, Notice, useSubmit } from '../ui';
import { Modal, ModalBody, ModalFooter } from './Modal';

type Action = 'show' | 'replace';
type Step = { kind: 'warn' } | { kind: 'confirm'; code: boolean } | { kind: 'shown'; key: string; replaced: boolean };

const SHOWN_FOR = 60_000;

export function KeyActions({ onReplaced }: { onReplaced: () => void }) {
  const [action, setAction] = useState<Action | null>(null);
  return (
    <>
      <div class="actions">
        <Button onClick={() => setAction('show')}>Show my key</Button>
        <Button onClick={() => setAction('replace')}>Replace my key</Button>
      </div>
      {action && <KeyWindow action={action} onClose={() => setAction(null)} onReplaced={onReplaced} />}
    </>
  );
}

function KeyWindow({ action, onClose, onReplaced }: { action: Action; onClose: () => void; onReplaced: () => void }) {
  const { session } = useSession();
  const ephemeral = session.user.signs_in_with === 'ephemeral';
  const [step, setStep] = useState<Step>(action === 'replace' ? { kind: 'warn' } : { kind: 'confirm', code: false });
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const keyWord = plainWording() ? 'access key' : 'key';

  const act = async () => {
    if (action === 'show') {
      const shown = await api<{ api_key: string }>('/account/ephemeral-key/reveal', 'POST');
      setStep({ kind: 'shown', key: shown.api_key, replaced: false });
    } else {
      const replaced = await api<{ api_key: string }>('/account/ephemeral-key/replace', 'POST');
      setStep({ kind: 'shown', key: replaced.api_key, replaced: true });
      onReplaced();
    }
  };
  // Already confirmed in the last 5 minutes: straight on.
  const proceed = () => {
    setError(null);
    api<{ confirmed: boolean }>('/account/reauth')
      .then((state) => (state.confirmed ? act() : setStep({ kind: 'confirm', code: false })))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(() => { if (action === 'show') proceed(); }, []);
  useEffect(() => {
    if (step.kind !== 'shown') return;
    const timer = setTimeout(onClose, SHOWN_FOR);
    return () => clearTimeout(timer);
  }, [step.kind]);

  const { busy, error: submitError, onSubmit } = useSubmit(async () => {
    if (step.kind !== 'confirm') return;
    if (!step.code) {
      const result = await api<{ two_factor?: boolean; confirmed: boolean }>('/account/reauth', 'POST', { password });
      setPassword('');
      if (result.two_factor) { setStep({ kind: 'confirm', code: true }); return; }
    } else {
      await api('/account/reauth/code', 'POST', { code });
      setCode('');
    }
    await act();
  });

  return (
    <Modal title={action === 'show' ? `Your ${keyWord}` : `Replace your ${keyWord}`} onClose={onClose}>
      <ModalBody>
        {(error || submitError) && <Notice tone="error">{error ?? submitError}</Notice>}
        {step.kind === 'warn' && (
          <p>Your current {keyWord} will stop working everywhere it's used: other AstrologyStudio sites, MindForce, or
            anything else. You'll need to give those the new {keyWord}. Your charts aren't affected.</p>
        )}
        {step.kind === 'confirm' && (
          <form id="reauth-form" class="form" onSubmit={onSubmit}>
            <p class="muted">First, confirm it's you.</p>
            {!step.code ? (
              <Field label={ephemeral && !plainWording() ? 'Your ephemeralREST password' : 'Your password'} type="password"
                     value={password} onValue={setPassword} autoComplete="current-password" required id="reauth-password" />
            ) : (
              <Field label="Code" value={code} onValue={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} id="reauth-code"
                     inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required
                     hint={`We've emailed a 6-digit code to ${session.user.email}.`} />
            )}
          </form>
        )}
        {step.kind === 'shown' && (
          <>
            {step.replaced && <Notice tone="success">Your {keyWord} has been replaced. The old one no longer works.</Notice>}
            <p class="muted">{plainWording()
              ? 'You only need this to use your charts on another site or in another app.'
              : 'Paste it into other sites or apps that use your ephemeralREST account.'} It's hidden again in a minute.</p>
            <div class="key-shown"><CopyText text={step.key} /></div>
          </>
        )}
      </ModalBody>
      <ModalFooter>
        {step.kind === 'warn' && <Button variant="danger" onClick={proceed}>Replace my {keyWord}</Button>}
        {step.kind === 'confirm' && (
          <Button type="submit" variant="primary" busy={busy} form="reauth-form">{step.code ? 'Confirm' : 'Continue'}</Button>
        )}
        <Button onClick={onClose}>{step.kind === 'shown' ? 'Done' : 'Cancel'}</Button>
      </ModalFooter>
    </Modal>
  );
}
