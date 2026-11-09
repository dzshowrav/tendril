import React, { useEffect } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { useAuthStore } from './store/auth-store.js';
import { Header } from './components/Header.js';
import { PairScreen } from './components/PairScreen.js';
import { SessionsScreen } from './components/SessionsScreen.js';
import { ChatScreen } from './components/ChatScreen.js';
import { ChangesScreen } from './components/ChangesScreen.js';
import { FilesScreen } from './components/FilesScreen.js';
import { SettingsScreen } from './components/SettingsScreen.js';
import { DaemonOfflineBanner } from './components/DaemonOfflineBanner.js';

export const App: React.FC = () => {
  const [location, navigate] = useLocation();
  const { checkHealth, isDaemonOnline, isChecking } = useAuthStore();

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

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
          <Route path="/s/:id/changes" component={ChangesScreen} />
          <Route path="/s/:id/files" component={FilesScreen} />
          <Route path="/s/:id" component={ChatScreen} />
          <Route path="/settings" component={SettingsScreen} />
          <Route>
            {() => {
              navigate('/');
              return null;
            }}
          </Route>
        </Switch>
      </main>
    </div>
  );
};
