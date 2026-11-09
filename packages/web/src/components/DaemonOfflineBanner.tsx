import React from 'react';
import { useAuthStore } from '../store/auth-store.js';

export const DaemonOfflineBanner: React.FC = () => {
  const { isDaemonOnline, checkHealth } = useAuthStore();

  if (isDaemonOnline) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'var(--bg)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 50,
          height: 50,
          borderRadius: '50%',
          backgroundColor: 'rgba(247, 118, 142, 0.15)',
          color: 'var(--error)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          marginBottom: 16,
        }}
      >
        !
      </div>
      <h2 style={{ fontSize: 20, marginBottom: 8 }}>Daemon Offline</h2>
      <p style={{ color: 'var(--muted)', maxWidth: 360, marginBottom: 24, lineHeight: 1.5 }}>
        Tendril daemon is unreachable at 127.0.0.1. Start the daemon in Termux by running{' '}
        <code style={{ color: 'var(--text)', backgroundColor: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4 }}>
          tendril serve
        </code>
      </p>
      <button
        onClick={() => checkHealth()}
        style={{
          padding: '10px 24px',
          backgroundColor: 'var(--primary)',
          color: 'var(--on-primary)',
          fontWeight: 600,
        }}
      >
        Retry Connection
      </button>
    </div>
  );
};
