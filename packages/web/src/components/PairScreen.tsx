import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuthStore } from '../store/auth-store.js';

export const PairScreen: React.FC = () => {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [, navigate] = useLocation();
  const { pairWithCode } = useAuthStore();

  useEffect(() => {
    // Check URL fragment for #code=... auto-pairing
    const hash = window.location.hash;
    if (hash && hash.includes('code=')) {
      const match = hash.match(/code=([^&]+)/);
      if (match && match[1]) {
        const autoCode = match[1].trim();
        // Clear fragment from history immediately for security
        window.history.replaceState(null, '', window.location.pathname);
        submitPair(autoCode);
      }
    }
  }, []);

  const submitPair = async (pairCode: string) => {
    if (!pairCode || pairCode.length !== 6) {
      setError('Please enter a 6-digit pairing code.');
      return;
    }

    setLoading(true);
    setError(null);

    const success = await pairWithCode(pairCode);
    setLoading(false);

    if (success) {
      navigate('/');
    } else {
      setError('Invalid or expired code. Run `tendril pair` in Termux to generate a new code.');
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 360, width: '100%' }}>
        <h1 style={{ fontSize: 24, marginBottom: 8, color: 'var(--primary)' }}>Pair with Tendril</h1>
        <p style={{ color: 'var(--muted)', marginBottom: 24, fontSize: 13, lineHeight: 1.5 }}>
          Enter the 6-digit pairing code generated in Termux using{' '}
          <code style={{ color: 'var(--text)', backgroundColor: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4 }}>
            tendril pair
          </code>
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitPair(code);
          }}
        >
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            style={{
              width: '100%',
              fontSize: 24,
              textAlign: 'center',
              letterSpacing: 6,
              fontWeight: 700,
              padding: '12px',
              marginBottom: 16,
              backgroundColor: 'var(--surface)',
            }}
            disabled={loading}
          />

          {error && (
            <div style={{ color: 'var(--error)', fontSize: 13, marginBottom: 16, lineHeight: 1.4 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: 'var(--primary)',
              color: 'var(--on-primary)',
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            {loading ? 'Pairing...' : 'Pair Device'}
          </button>
        </form>
      </div>
    </div>
  );
};
