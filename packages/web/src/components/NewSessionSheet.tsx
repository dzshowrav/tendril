import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { useSessionStore } from '../store/session-store.js';

interface NewSessionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (sessionId: string) => void;
}

export const NewSessionSheet: React.FC<NewSessionSheetProps> = ({ isOpen, onClose, onCreated }) => {
  const [workspace, setWorkspace] = useState('');
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState('ask');
  const [dirs, setDirs] = useState<string[]>([]);
  const [currentFsDir, setCurrentFsDir] = useState<string>('');
  const [showFsBrowser, setShowFsBrowser] = useState(false);
  const [loading, setLoading] = useState(false);

  const { createSession } = useSessionStore();

  useEffect(() => {
    if (isOpen) {
      loadFsDirs();
    }
  }, [isOpen]);

  const loadFsDirs = async (path?: string) => {
    try {
      const res = await ApiClient.listFsDirs(path);
      setCurrentFsDir(res.current);
      setDirs(res.dirs || []);
      if (!workspace) {
        setWorkspace(res.current);
      }
    } catch {
      // ignore
    }
  };

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const session = await createSession({
        workspace,
        title: title.trim() || undefined,
        mode,
      });
      onCreated(session.id);
      onClose();
    } catch (err: any) {
      alert(`Failed to create session: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'var(--overlay-scrim)',
        zIndex: 500,
        display: 'flex',
        alignItems: 'flex-end',
      }}
      onClick={onClose}
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
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>New Session</h2>
          <button onClick={onClose} style={{ color: 'var(--muted)', fontSize: 18 }}>
            ✕
          </button>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
            Workspace Directory
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              placeholder="/data/data/com.termux/files/home/my-project"
              style={{ flex: 1, fontSize: 13 }}
            />
            <button
              onClick={() => setShowFsBrowser(!showFsBrowser)}
              style={{
                padding: '6px 12px',
                backgroundColor: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                fontSize: 12,
              }}
            >
              {showFsBrowser ? 'Close' : 'Browse'}
            </button>
          </div>

          {showFsBrowser && (
            <div
              style={{
                marginTop: 8,
                padding: 10,
                backgroundColor: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                maxHeight: 140,
                overflowY: 'auto',
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                Current: {currentFsDir}
              </div>
              <div
                onClick={() => loadFsDirs(currentFsDir + '/..')}
                style={{ cursor: 'pointer', padding: '3px 0', color: 'var(--secondary)', fontSize: 12 }}
              >
                📁 .. (Parent directory)
              </div>
              {dirs.map((d) => (
                <div
                  key={d}
                  onClick={() => {
                    const full = currentFsDir === '/' ? `/${d}` : `${currentFsDir}/${d}`;
                    setWorkspace(full);
                    loadFsDirs(full);
                  }}
                  style={{ cursor: 'pointer', padding: '3px 0', color: 'var(--text)', fontSize: 12 }}
                >
                  📁 {d}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
            Session Title (optional)
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Refactor API module"
            style={{ width: '100%', fontSize: 13 }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
            Mode
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {['plan', 'ask', 'auto-edit', 'yolo'].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  padding: '8px 4px',
                  fontSize: 12,
                  fontWeight: mode === m ? 700 : 500,
                  backgroundColor: mode === m ? 'var(--primary)' : 'var(--surface-2)',
                  color: mode === m ? 'var(--on-primary)' : 'var(--text)',
                  border: '1px solid',
                  borderColor: mode === m ? 'var(--primary)' : 'var(--border)',
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleCreate}
          disabled={loading || !workspace}
          style={{
            width: '100%',
            padding: 12,
            backgroundColor: 'var(--primary)',
            color: 'var(--on-primary)',
            fontWeight: 700,
            marginTop: 8,
          }}
        >
          {loading ? 'Creating...' : 'Start Session'}
        </button>
      </div>
    </div>
  );
};
