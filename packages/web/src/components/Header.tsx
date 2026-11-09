import React from 'react';
import { useLocation } from 'wouter';
import { useSessionStore } from '../store/session-store.js';

export const Header: React.FC = () => {
  const [location, navigate] = useLocation();
  const { activeSession, isStreamConnected } = useSessionStore();

  const isSessionPage = location.startsWith('/s/');

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        backgroundColor: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        paddingTop: 'calc(12px + var(--safe-top))',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {isSessionPage ? (
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '6px 10px',
              backgroundColor: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
            }}
          >
            ← Back
          </button>
        ) : (
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--primary)', letterSpacing: '0.5px' }}>
            Tendril
          </span>
        )}

        {activeSession && isSessionPage && (
          <span
            style={{
              fontWeight: 600,
              maxWidth: 180,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {activeSession.title}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {isSessionPage && (
          <div
            title={isStreamConnected ? 'Live stream connected' : 'Connecting stream...'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'var(--muted)',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: isStreamConnected ? 'var(--primary)' : 'var(--warning)',
              }}
            />
          </div>
        )}

        <button
          onClick={() => navigate('/settings')}
          style={{
            padding: '6px 10px',
            backgroundColor: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--muted)',
            fontSize: 12,
          }}
        >
          Settings
        </button>
      </div>
    </header>
  );
};
