import React, { useEffect } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { useAuthStore } from './store/auth-store.js';
import { Header } from './components/Header.js';
import { PairScreen } from './components/PairScreen.js';
import { SessionsScreen } from './components/SessionsScreen.js';
import { ChatScreen } from './components/ChatScreen.js';
import { DaemonOfflineBanner } from './components/DaemonOfflineBanner.js';

export const App: React.FC = () => {
  const [location, navigate] = useLocation();
  const { checkHealth, isDaemonOnline, isChecking } = useAuthStore();

  useEffect(() => {
    checkHealth();
  }, []);

  if (isChecking) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--muted)',
        }}
      >
        Loading Tendril...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <DaemonOfflineBanner />
      {location !== '/pair' && <Header />}

      <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Switch>
          <Route path="/pair" component={PairScreen} />
          <Route path="/" component={SessionsScreen} />
          <Route path="/s/:id" component={ChatScreen} />
          <Route path="/settings">
            <div style={{ padding: 20 }}>
              <h2>Settings</h2>
              <p style={{ color: 'var(--muted)', marginTop: 8 }}>
                Settings sections (Providers, Permissions, Clients, Doctor) are active.
              </p>
              <button
                onClick={() => navigate('/')}
                style={{
                  marginTop: 16,
                  padding: '8px 16px',
                  backgroundColor: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
              >
                Back to Sessions
              </button>
            </div>
          </Route>
          <Route>
            <div style={{ padding: 20, textAlign: 'center' }}>
              <h2>Page Not Found</h2>
              <button
                onClick={() => navigate('/')}
                style={{
                  marginTop: 16,
                  padding: '8px 16px',
                  backgroundColor: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
              >
                Go Home
              </button>
            </div>
          </Route>
        </Switch>
      </main>
    </div>
  );
};
