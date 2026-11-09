import React, { useState } from 'react';
import { useSessionStore } from '../store/session-store.js';

export const PermissionSheet: React.FC = () => {
  const { pendingPermission, resolvePermission } = useSessionStore();
  const [showDenyNote, setShowDenyNote] = useState(false);
  const [denyNote, setDenyNote] = useState('');
  const [loading, setLoading] = useState(false);

  if (!pendingPermission) return null;

  const handleDecision = async (decision: 'allow_once' | 'allow_always' | 'deny') => {
    setLoading(true);
    try {
      await resolvePermission(decision, decision === 'deny' ? denyNote.trim() || undefined : undefined);
      setShowDenyNote(false);
      setDenyNote('');
    } catch (err: any) {
      alert(`Permission resolution failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const tool = pendingPermission.tool;
  const params = pendingPermission.parameters || {};
  let summary = '';

  if (tool === 'bash') {
    summary = String(params.command || '');
  } else if (tool === 'write_file' || tool === 'edit_file') {
    summary = String(params.path || '');
  } else {
    summary = JSON.stringify(params);
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'var(--overlay-scrim)',
        zIndex: 600,
        display: 'flex',
        alignItems: 'flex-end',
      }}
    >
      <div
        style={{
          width: '100%',
          backgroundColor: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          padding: 20,
          paddingBottom: 'calc(20px + var(--safe-bottom))',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              backgroundColor: 'var(--warning)',
              color: 'var(--on-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            !
          </span>
          <h2 style={{ fontSize: 17, fontWeight: 700 }}>Permission Required</h2>
        </div>

        <div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Tool</div>
          <div style={{ fontWeight: 600, color: 'var(--secondary)' }}>{tool}</div>
        </div>

        <div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Action</div>
          <div
            style={{
              padding: 10,
              backgroundColor: 'var(--code-bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              wordBreak: 'break-all',
              maxHeight: 120,
              overflowY: 'auto',
            }}
          >
            {summary}
          </div>
          {pendingPermission.canAllowAlways === false && (
            <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 6, fontStyle: 'italic' }}>
              ⚠ {pendingPermission.disallowReason || 'Cannot save permanent rule for compound command.'}
            </div>
          )}
        </div>

        {showDenyNote && (
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
              Denial reason (optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Do not run this command"
              value={denyNote}
              onChange={(e) => setDenyNote(e.target.value)}
              style={{ width: '100%', fontSize: 13 }}
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {showDenyNote ? (
            <>
              <button
                onClick={() => setShowDenyNote(false)}
                style={{
                  flex: 1,
                  padding: 12,
                  backgroundColor: 'var(--surface-2)',
                  color: 'var(--text)',
                }}
              >
                Back
              </button>
              <button
                onClick={() => handleDecision('deny')}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: 12,
                  backgroundColor: 'var(--error)',
                  color: '#fff',
                  fontWeight: 600,
                }}
              >
                Confirm Deny
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => handleDecision('allow_once')}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: 12,
                  backgroundColor: 'var(--primary)',
                  color: 'var(--on-primary)',
                  fontWeight: 600,
                }}
              >
                Allow Once
              </button>
              {pendingPermission.canAllowAlways !== false && (
                <button
                  onClick={() => handleDecision('allow_always')}
                  disabled={loading}
                  style={{
                    flex: 1,
                    padding: 12,
                    backgroundColor: 'var(--secondary)',
                    color: '#fff',
                    fontWeight: 600,
                  }}
                >
                  Always
                </button>
              )}
              <button
                onClick={() => setShowDenyNote(true)}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: 12,
                  backgroundColor: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--error)',
                  fontWeight: 600,
                }}
              >
                Deny
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
