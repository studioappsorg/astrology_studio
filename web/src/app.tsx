/**
 * AstrologyStudio ·
 * web/src/app.tsx
 *
 * Top level:
 *
 * asks the server whether this install needs setting up and who is logged in, then shows the setup
 * screen, the login screen, or the app.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { api, onSessionEnded, setCsrfToken, type AuthStatus, type Session } from './api';
import { Login } from './pages/Login';
import { forgetRemembered, loadRemembered } from './prefs';
import { Setup } from './pages/Setup';
import { Shell } from './pages/Shell';
import { navigate } from './router';
import { SessionContext } from './session';
import { describe, Notice } from './ui';
import { AppearanceProvider } from './appearance';
import { ViewProvider } from './view';
import { setHosted, setOwner } from './hosted';
import { resetCharts } from './frame/store';
import { resetViews } from './views';
import { resetDefaults } from './defaults';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'setup' }
  | { kind: 'login'; registrationOpen: boolean }
  | { kind: 'app'; session: Session };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  /** The account's details changed (name, key...); same person, same choices. */
  const updated = useCallback((session: Session) => {
    setCsrfToken(session.csrf_token);
    setOwner(session.user.is_owner);
    setState({ kind: 'app', session });
  }, []);

  /** Someone has just logged in: bring their remembered choices before showing the app. */
  const signedIn = useCallback((session: Session) => {
    setCsrfToken(session.csrf_token);
    setOwner(session.user.is_owner);
    void loadRemembered().then(() => setState({ kind: 'app', session }));
  }, []);

  const signedOut = useCallback(() => {
    void forgetRemembered();
    resetCharts();
    resetViews();
    resetDefaults();
    setCsrfToken(null);
    // Ask again whether new accounts are allowed; the owner may have changed it.
    api<AuthStatus>('/auth/status')
      .then((status) => { setHosted(status.hosted ?? false); setState({ kind: 'login', registrationOpen: status.registration_open }); })
      .catch(() => setState({ kind: 'login', registrationOpen: false }));
  }, []);

  useEffect(() => {
    onSessionEnded(signedOut);
    api<AuthStatus>('/auth/status')
      .then((status) => {
        setHosted(status.hosted ?? false);
        if (status.setup_required) setState({ kind: 'setup' });
        else if (status.user) signedIn(status.user);
        else setState({ kind: 'login', registrationOpen: status.registration_open });
      })
      .catch((error: unknown) => setState({ kind: 'error', message: describe(error) }));
  }, [signedIn, signedOut]);

  switch (state.kind) {
    case 'loading':
      return null;
    case 'error':
      return (
        <main class="auth">
          <Notice tone="error">{state.message}</Notice>
        </main>
      );
    case 'setup':
      // Straight into getting started: connect ephemeralREST and add a key.
      return <Setup onDone={(session) => { navigate('/start', { replace: true }); signedIn(session); }} />;
    case 'login':
      return <Login onDone={signedIn} registrationOpen={state.registrationOpen} />;
    case 'app': {
      const signOut = async () => {
        await forgetRemembered();
        await api('/auth/logout', 'POST').catch(() => undefined);
        signedOut();
      };
      return (
        <SessionContext.Provider value={{ session: state.session, signOut, updateUser: updated }}>
          <ViewProvider>
            <AppearanceProvider>
              <Shell />
            </AppearanceProvider>
          </ViewProvider>
        </SessionContext.Provider>
      );
    }
  }
}
